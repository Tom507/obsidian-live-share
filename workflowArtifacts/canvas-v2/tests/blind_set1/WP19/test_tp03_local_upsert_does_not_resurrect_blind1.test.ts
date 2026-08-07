// WP19 AC2 blind1 — no-resurrect when the tombstone came from SOMEONE ELSE.
//
// The visible-side scenario deletes locally first, which leaves the local shadow
// holding the id as `absent`. That state is doing part of the work. Here the
// delete is issued by a REMOTE peer, so the local shadow still holds the record
// as `present` with all of its observed fields, and the record's `Y.Map` is
// still in the doc. Under those conditions the capture path is perfectly happy:
// the changed field differs from the shadow, so it is intent; the record exists,
// so it is a plain merge write. Nothing stops it except the resurrect block
// reading a `deleted` container it can actually see.
//
// This is the realistic version of the bug — two people working at once, one
// deletes, the other keeps typing — and it is the one a shadow-only guard misses.
//
// Three replicas, every write ordered. The oracle is the STORED VALUE on each
// replica, not visibility: a suppressed record whose stored text was quietly
// overwritten looks fine right up until somebody undoes the delete.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { applyTombstoneOp, isTombstoneSuppressed, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "research-hub.canvas";

const STABLE = { id: "stable", type: "text", x: 0, y: 0, width: 200, height: 100, text: "stable" };
const CONTESTED = {
  id: "contested",
  type: "text",
  x: 260,
  y: 340,
  width: 300,
  height: 200,
  text: "peer 2 deleted this while I was typing",
  color: "2",
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

describe("WP19 AC2 blind1 — a REMOTE delete blocks the local user's next write (3 replicas)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the local save's edits to the remotely-deleted card never enter the doc and never reach the room", async () => {
    const vault = createVault({ [PATH]: canvasJson([STABLE, CONTESTED]) });
    const syncManager = createSyncManager();
    const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
    const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
    cs.setLogger({ debug: () => {}, warn: () => {} });
    cs.setSurfaceStateProvider(
      (): SurfaceState => ({
        viewOpen: true,
        handedToView: { node: new Set(["stable", "contested"]), edge: new Set<string>() },
      }),
    );
    await cs.subscribe(PATH, "host");

    const doc1 = syncManager.getDoc(`__canvas__:${PATH}`).doc;
    const doc2 = new Y.Doc();
    const doc3 = new Y.Doc();
    push(doc1, doc2);
    push(doc1, doc3);

    // Peer 2 deletes the card, and its delete reaches everybody first.
    doc2.transact(() => {
      applyTombstoneOp(doc2.getMap<unknown>("deleted"), "contested", {
        t: 7,
        by: "peer-2",
        on: true,
      });
    });
    push(doc2, doc1);
    push(doc2, doc3);
    expect(
      isTombstoneSuppressed(readTombstoneEntry(doc1.getMap<unknown>("deleted"), "contested")),
      "the remote delete never arrived, so this test proves nothing",
    ).toBe(true);

    // The local user, who has not noticed, keeps editing and Obsidian saves.
    const svBefore = Y.encodeStateVector(doc1);
    vault.files.set(
      PATH,
      canvasJson([
        { ...STABLE, text: "stable, edited" },
        { ...CONTESTED, text: "still typing", y: 999 },
      ]),
    );
    await cs.handleLocalModify(PATH);

    // The unrelated card's genuine edit MUST land — the block is per record.
    expect(
      field(doc1, "stable", "text"),
      "the resurrect block swallowed an edit to an unrelated card",
    ).toBe("stable, edited");

    // The deleted card keeps every stored value it had.
    expect(field(doc1, "contested", "text"), "the tombstoned card's text was overwritten").toBe(
      CONTESTED.text,
    );
    expect(field(doc1, "contested", "y"), "the tombstoned card's geometry was overwritten").toBe(
      CONTESTED.y,
    );

    // Nothing about it went on the wire either.
    const wire = new Y.Doc();
    Y.applyUpdate(wire, Y.encodeStateAsUpdate(doc3), "peer");
    Y.applyUpdate(wire, Y.encodeStateAsUpdate(doc1, svBefore), "peer");
    expect(field(wire, "contested", "text"), "the resurrect write was broadcast").toBe(
      CONTESTED.text,
    );
    expect(field(wire, "stable", "text")).toBe("stable, edited");

    push(doc1, doc2);
    push(doc1, doc3);
    for (const doc of [doc1, doc2, doc3]) {
      expect(field(doc, "contested", "text")).toBe(CONTESTED.text);
      expect(
        readTombstoneEntry(doc.getMap<unknown>("deleted"), "contested")?.t,
        "the local pass rewrote the peer's tombstone",
      ).toBe(7);
    }

    cs.destroy();
  });
});
