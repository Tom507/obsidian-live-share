// WP19 AC1 blind1, EDGE branch — the container survives, proven by what a PEER
// can still do to it afterwards.
//
// "The field container is not destroyed" is not an aesthetic property; its whole
// value is that a peer's concurrent work on that record is still there when the
// delete is undone. So this test does not look at object identity at all. It
// deletes the arrow locally, lets the delete reach the room, and then has a peer
// re-label the very record that was just deleted. If the delete had removed the
// key, the peer has nothing to label and the write lands on a record that no
// longer exists on any replica.
//
// Every step is ORDERED — delete, replicate, peer edit, replicate back — so the
// converged value has a single author and a causal predecessor chain. Three
// replicas, because the question is what the room agrees on, and two peers
// cannot distinguish a merge from a revert.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { isTombstoneSuppressed, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import { CanvasSync, buildCanvasData } from "../../../files/canvas-sync";

const PATH = "flows.canvas";

const SRC = { id: "src", type: "text", x: 0, y: 0, width: 160, height: 80, text: "src" };
const DST = { id: "dst", type: "text", x: 600, y: 0, width: 160, height: 80, text: "dst" };
const ARROW = {
  id: "arrow",
  fromNode: "src",
  fromSide: "right",
  toNode: "dst",
  toSide: "left",
  color: "4",
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

describe("WP19 AC1 blind1 — a peer can still write to an arrow this client deleted", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the peer's later label survives on every replica, alongside the arrow's original fields and its tombstone", async () => {
    const vault = createVault({ [PATH]: canvasJson([SRC, DST], [ARROW]) });
    const syncManager = createSyncManager();
    const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
    const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
    cs.setLogger({ debug: () => {}, warn: () => {} });
    cs.setSurfaceStateProvider(
      (): SurfaceState => ({
        viewOpen: true,
        handedToView: { node: new Set(["src", "dst"]), edge: new Set(["arrow"]) },
      }),
    );
    await cs.subscribe(PATH, "host");

    const doc1 = syncManager.getDoc(`__canvas__:${PATH}`).doc;
    const fieldsBefore = doc1.getMap<Y.Map<unknown>>("edges").get("arrow")?.toJSON();
    expect(fieldsBefore, "the host seed never created the arrow").toBeDefined();

    // 1 — the local user deletes the arrow.
    vault.files.set(PATH, canvasJson([SRC, DST], []));
    await cs.handleLocalModify(PATH);

    // 2 — the delete reaches the room.
    const doc2 = new Y.Doc();
    const doc3 = new Y.Doc();
    push(doc1, doc2);
    push(doc1, doc3);

    // 3 — a peer that has seen the delete annotates the same arrow. This is only
    //     possible at all if the record is still there.
    const arrowOnPeer = doc2.getMap<Y.Map<unknown>>("edges").get("arrow");
    expect(
      arrowOnPeer,
      "the delete propagated as a key removal: the peer has no arrow left to annotate",
    ).toBeDefined();
    doc2.transact(() => {
      arrowOnPeer?.set("label", "kept by peer 2");
    });

    // 4 — everyone converges.
    push(doc2, doc1);
    push(doc2, doc3);

    for (const doc of [doc1, doc2, doc3]) {
      const edges = doc.getMap<Y.Map<unknown>>("edges");
      const record = edges.get("arrow")?.toJSON() ?? {};
      expect(record.label, "the peer's annotation is missing on a replica").toBe("kept by peer 2");
      for (const [field, value] of Object.entries(fieldsBefore ?? {})) {
        expect(record[field], `the arrow lost field \`${field}\` on a replica`).toEqual(value);
      }
      expect(
        isTombstoneSuppressed(readTombstoneEntry(doc.getMap<unknown>("deleted"), "arrow")),
        "the peer's write silently lifted the delete",
      ).toBe(true);
      expect(
        buildCanvasData(doc.getMap<Y.Map<unknown>>("nodes"), edges, doc.getMap<unknown>("deleted"))
          .edges,
        "a replica still draws the deleted arrow",
      ).toEqual([]);
    }

    cs.destroy();
  });
});
