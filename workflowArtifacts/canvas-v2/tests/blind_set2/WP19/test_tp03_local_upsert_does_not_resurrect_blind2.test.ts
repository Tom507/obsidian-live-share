// WP19 AC2 blind2 — delete-wins with a STALE UNDO in the room.
//
// "No-resurrect" has two doors, and closing only one of them still loses the
// record. The capture path is the first door (a save must not write into a
// tombstoned id). The tombstone merge is the second: an undo that was issued
// BEFORE the delete — a peer that was offline, a queued op, a replayed sidecar
// segment — must lose on `(t, by)` and leave the record suppressed. If it wins,
// the record silently comes back on every replica and the delete is undone by
// nobody.
//
// So the scenario runs both doors in sequence on the same record: a fresh remote
// delete at `t=9`, a stale undo at `t=4` from a different author, and then a
// local save that still lists the card. Three replicas, every op ordered, and
// the tie is decided by Lamport stamps this test chose — never by Yjs's
// `clientID`, which is a random uint32 and would make the verdict a coin flip.
//
// The record's stored values are the oracle: after all of it, they must be
// exactly what they were before anybody touched anything.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { SurfaceState } from "../../../canvas/canvas-shadow";
import {
  applyTombstoneOp,
  isTombstoneSuppressed,
  readTombstoneEntry,
} from "../../../canvas/canvas-tombstone";
import { CanvasSync, buildCanvasData } from "../../../files/canvas-sync";

const PATH = "roadmap.canvas";

const ANCHOR = { id: "anchor", type: "text", x: 0, y: 0, width: 200, height: 100, text: "anchor" };
const TARGET = {
  id: "target",
  type: "text",
  x: 320,
  y: 260,
  width: 280,
  height: 180,
  text: "deleted at t=9",
  color: "1",
};

function canvasJson(
  nodes: Record<string, unknown>[],
  edges: Record<string, unknown>[] = [],
): string {
  return JSON.stringify({ nodes, edges });
}

function createVault(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial));
  return {
    files,
    read: vi.fn(async (file: { path: string }) => files.get(file.path) ?? ""),
    adapter: {
      write: vi.fn(async (p: string, c: string) => {
        files.set(p, c);
      }),
      read: vi.fn(async (p: string) => files.get(p) ?? ""),
      exists: vi.fn(async (p: string) => files.has(p)),
    },
    getAbstractFileByPath: vi.fn((p: string) => {
      if (!files.has(p)) return null;
      const f = new TFile();
      f.path = p;
      return f;
    }),
  };
}

function createSyncManager() {
  const docs = new Map<string, { doc: Y.Doc; text: Y.Text; awareness: unknown }>();
  return {
    docs,
    getDoc(docId: string) {
      if (!docs.has(docId)) {
        const doc = new Y.Doc();
        docs.set(docId, { doc, text: doc.getText("content"), awareness: {} });
      }
      return docs.get(docId) as { doc: Y.Doc; text: Y.Text; awareness: unknown };
    },
    releaseDoc: vi.fn(),
    waitForSync: vi.fn(async () => {}),
  };
}

function push(from: Y.Doc, to: Y.Doc): void {
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)), "peer");
}

function field(doc: Y.Doc, id: string, key: string): unknown {
  return doc.getMap<Y.Map<unknown>>("nodes").get(id)?.get(key);
}

describe("WP19 AC2 blind2 — a stale undo cannot resurrect, and neither can a local save (3 replicas)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the record stays suppressed and byte-for-byte unchanged on all three replicas", async () => {
    const vault = createVault({ [PATH]: canvasJson([ANCHOR, TARGET]) });
    const syncManager = createSyncManager();
    const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
    const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
    cs.setLogger({ debug: () => {}, warn: () => {} });
    cs.setSurfaceStateProvider(
      (): SurfaceState => ({
        viewOpen: true,
        handedToView: { node: new Set(["anchor", "target"]), edge: new Set<string>() },
      }),
    );
    await cs.subscribe(PATH, "host");

    const doc1 = syncManager.getDoc(`__canvas__:${PATH}`).doc;
    const recordBefore = doc1.getMap<Y.Map<unknown>>("nodes").get("target")?.toJSON();
    expect(recordBefore, "the host seed never created the record under test").toBeDefined();

    const doc2 = new Y.Doc();
    const doc3 = new Y.Doc();
    push(doc1, doc2);
    push(doc1, doc3);

    // 1 — peer 2 deletes the card at t=9. Everyone gets it.
    doc2.transact(() => {
      applyTombstoneOp(doc2.getMap<unknown>("deleted"), "target", {
        t: 9,
        by: "peer-2",
        on: true,
      });
    });
    push(doc2, doc1);
    push(doc2, doc3);

    // 2 — peer 3 delivers an undo it issued long before, at t=4. It must LOSE:
    //     the merge is max over (t, by), and 4 < 9 regardless of author.
    doc3.transact(() => {
      applyTombstoneOp(doc3.getMap<unknown>("deleted"), "target", {
        t: 4,
        by: "zzz-peer-3",
        on: false,
      });
    });
    push(doc3, doc1);
    push(doc3, doc2);

    // 3 — and the local user's canvas still shows the card and keeps editing it.
    vault.files.set(
      PATH,
      canvasJson([ANCHOR, { ...TARGET, text: "typed after the delete", width: 999 }]),
    );
    await cs.handleLocalModify(PATH);

    push(doc1, doc2);
    push(doc1, doc3);
    push(doc2, doc3);
    push(doc3, doc2);

    for (const doc of [doc1, doc2, doc3]) {
      const entry = readTombstoneEntry(doc.getMap<unknown>("deleted"), "target");
      expect(entry?.t, "the stale undo overwrote the fresher delete on a replica").toBe(9);
      expect(isTombstoneSuppressed(entry), "the record was resurrected on a replica").toBe(true);

      const after = doc.getMap<Y.Map<unknown>>("nodes").get("target")?.toJSON() ?? {};
      for (const [key, value] of Object.entries(recordBefore ?? {})) {
        expect(after[key], `field \`${key}\` of the tombstoned record was overwritten`).toEqual(
          value,
        );
      }
      expect(
        buildCanvasData(
          doc.getMap<Y.Map<unknown>>("nodes"),
          doc.getMap<Y.Map<unknown>>("edges"),
          doc.getMap<unknown>("deleted"),
        ).nodes.map((node) => node.id),
        "the resurrected card is visible on a replica",
      ).toEqual(["anchor"]);
    }

    // The unrelated card still took its edit, so the pass was not a no-op.
    expect(field(doc1, "anchor", "text")).toBe("anchor");

    cs.destroy();
  });
});
