// WP19 / AC2, first half — "a local upsert for a tombstoned id does not
// resurrect it."
//
// After a delete the record's `Y.Map` is still in the doc (AC1), and the shadow
// holds the id as `absent` with no fields. So the very next Obsidian save that
// still mentions that id classifies EVERY one of its fields as fresh intent, and
// the merge branch of `applyIntentPlan` finds an existing container to write
// them into. Nothing in that path stops on its own: the ONLY thing standing
// between a stale surface and a resurrected record is `planIntentDiff`'s rule 1,
// fed by a `TombstoneView` that actually reads the doc's `deleted` container.
//
// The oracle is therefore the FIELD VALUE in the doc, not visibility: a record
// can be suppressed and still have had its stored values silently overwritten,
// and that overwrite is unrecoverable data loss the moment the delete is undone.
//
// THREE replicas, and every write ORDERED (delete → replicate → local save), so
// no assertion depends on a Yjs concurrent-write tie-break. The outbound-delta
// replica is the strong form of the oracle: it evaluates what this client would
// actually PUT ON THE WIRE against a peer that never saw the local save, which a
// read of the local doc cannot distinguish from a write that simply lost.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { isTombstoneSuppressed, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import { CanvasSync, buildCanvasData } from "../../../files/canvas-sync";

const PATH = "plan.canvas";

const KEPT = { id: "kept", type: "text", x: 0, y: 0, width: 200, height: 100, text: "kept" };
const DOOMED = {
  id: "doomed",
  type: "text",
  x: 400,
  y: 120,
  width: 240,
  height: 160,
  text: "original body",
  color: "3",
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

/** One-way replication, as the relay would deliver it (a REMOTE transaction). */
function push(from: Y.Doc, to: Y.Doc): void {
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)), "peer");
}

function nodeField(doc: Y.Doc, id: string, key: string): unknown {
  return doc.getMap<Y.Map<unknown>>("nodes").get(id)?.get(key);
}

function visibleNodeIds(doc: Y.Doc): unknown[] {
  return buildCanvasData(
    doc.getMap<Y.Map<unknown>>("nodes"),
    doc.getMap<Y.Map<unknown>>("edges"),
    doc.getMap<unknown>("deleted"),
  ).nodes.map((node) => node.id);
}

describe("WP19 AC2 — a local upsert never resurrects a tombstoned id (3 replicas)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a save that still carries the deleted card writes none of its fields, on this replica or on the wire", async () => {
    const vault = createVault({ [PATH]: canvasJson([KEPT, DOOMED]) });
    const syncManager = createSyncManager();
    const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
    const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
    cs.setLogger({ debug: () => {}, warn: () => {} });
    cs.setSurfaceStateProvider(
      (): SurfaceState => ({
        viewOpen: true,
        handedToView: { node: new Set(["kept", "doomed"]), edge: new Set<string>() },
      }),
    );
    await cs.subscribe(PATH, "host");

    const doc1 = syncManager.getDoc(`__canvas__:${PATH}`).doc;

    // Step 1 — the user deletes the card. Ordered, single author.
    vault.files.set(PATH, canvasJson([KEPT]));
    await cs.handleLocalModify(PATH);
    expect(
      isTombstoneSuppressed(readTombstoneEntry(doc1.getMap<unknown>("deleted"), "doomed")),
      "nothing was tombstoned, so this test cannot say anything about resurrection",
    ).toBe(true);

    // Step 2 — the delete reaches both peers BEFORE anything else happens.
    const doc2 = new Y.Doc();
    const doc3 = new Y.Doc();
    push(doc1, doc2);
    push(doc1, doc3);

    // Step 3 — a stale/undone surface saves the card back, with an edit.
    const svBeforeSave = Y.encodeStateVector(doc1);
    vault.files.set(PATH, canvasJson([KEPT, { ...DOOMED, text: "resurrected body", x: 999 }]));
    await cs.handleLocalModify(PATH);

    expect(
      nodeField(doc1, "doomed", "text"),
      "the tombstoned record's stored text was overwritten by the stale save",
    ).toBe("original body");
    expect(
      nodeField(doc1, "doomed", "x"),
      "the tombstoned record's stored geometry was overwritten by the stale save",
    ).toBe(400);
    expect(
      isTombstoneSuppressed(readTombstoneEntry(doc1.getMap<unknown>("deleted"), "doomed")),
      "the local upsert lifted the tombstone",
    ).toBe(true);

    // What this client would actually send, evaluated on a peer replica.
    const wire = new Y.Doc();
    Y.applyUpdate(wire, Y.encodeStateAsUpdate(doc2), "peer");
    Y.applyUpdate(wire, Y.encodeStateAsUpdate(doc1, svBeforeSave), "peer");
    expect(
      nodeField(wire, "doomed", "text"),
      "the resurrect write went out on the wire and would overwrite every peer",
    ).toBe("original body");

    // Step 4 — the room converges, and all three agree.
    push(doc1, doc2);
    push(doc1, doc3);
    for (const doc of [doc1, doc2, doc3]) {
      expect(nodeField(doc, "doomed", "text")).toBe("original body");
      expect(
        isTombstoneSuppressed(readTombstoneEntry(doc.getMap<unknown>("deleted"), "doomed")),
        "a replica disagrees about the tombstone",
      ).toBe(true);
      expect(visibleNodeIds(doc), "the deleted card is visible on a replica").toEqual(["kept"]);
    }

    cs.destroy();
  });
});
