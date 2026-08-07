// WP19 / AC1, the EDGE half — "no record's field container is destroyed by ANY
// delete path."
//
// `applyIntentPlan` has two delete branches, not one: a node delete (gated by
// `canDeleteNode`) and an EDGE delete (gated by the endpoint lock check). They
// are separate code, so "no field container is destroyed" has to be proven on
// both. This test point owns the edge branch; TP01 owns the node branch and TP05
// owns the cascade branch.
//
// The edge is the more dangerous of the two to get wrong, because an edge that
// vanishes from the file looks the same to a user whether it was tombstoned or
// key-removed — the difference only shows up later, when the delete has to merge
// against a peer's concurrent edit or be undone.
//
// Test data deliberately carries a control edge between the SAME pair of nodes,
// so a bug that suppressed "every edge touching n1" instead of "this edge" is
// visible as the control disappearing too.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { isTombstoneSuppressed, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import { CanvasSync, buildCanvasData } from "../../../files/canvas-sync";

const PATH = "wiring.canvas";

const A = { id: "a", type: "text", x: 0, y: 0, width: 180, height: 90, text: "a" };
const B = { id: "b", type: "text", x: 500, y: 0, width: 180, height: 90, text: "b" };
const E_CUT = {
  id: "cut",
  fromNode: "a",
  fromSide: "right",
  toNode: "b",
  toSide: "left",
  label: "the one the user removes",
  color: "2",
};
const E_KEEP = { id: "keeper", fromNode: "a", fromSide: "bottom", toNode: "b", toSide: "top" };

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

async function makeRoom(diskJson: string, handedNodes: string[], handedEdges: string[]) {
  const vault = createVault({ [PATH]: diskJson });
  const syncManager = createSyncManager();
  const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
  const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
  cs.setLogger({ debug: () => {}, warn: () => {} });
  cs.setSurfaceStateProvider(
    (): SurfaceState => ({
      viewOpen: true,
      handedToView: { node: new Set(handedNodes), edge: new Set(handedEdges) },
    }),
  );
  await cs.subscribe(PATH, "host");
  return { vault, cs, doc: syncManager.getDoc(`__canvas__:${PATH}`).doc };
}

describe("WP19 AC1 — the EDGE delete branch tombstones instead of removing the key", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("removing one arrow tombstones it, keeps its container and every field, and leaves the parallel arrow alone", async () => {
    const room = await makeRoom(canvasJson([A, B], [E_CUT, E_KEEP]), ["a", "b"], ["cut", "keeper"]);
    const nodes = room.doc.getMap<Y.Map<unknown>>("nodes");
    const edges = room.doc.getMap<Y.Map<unknown>>("edges");
    const deleted = room.doc.getMap<unknown>("deleted");

    const containerBefore = edges.get("cut");
    expect(containerBefore, "the host seed never created the edge under test").toBeDefined();
    const fieldsBefore = containerBefore?.toJSON();
    const edgeKeysBefore = [...edges.keys()].sort();

    room.vault.files.set(PATH, canvasJson([A, B], [E_KEEP]));
    await room.cs.handleLocalModify(PATH);

    const entry = readTombstoneEntry(deleted, "cut");
    expect(entry, "the edge delete wrote no well-formed tombstone entry").toBeDefined();
    expect(isTombstoneSuppressed(entry), "the edge tombstone does not suppress").toBe(true);

    expect(
      [...edges.keys()].sort(),
      "the edge delete removed a key from `edges` instead of writing a tombstone",
    ).toEqual(edgeKeysBefore);
    expect(edges.get("cut"), "the edge container was replaced rather than left alone").toBe(
      containerBefore,
    );
    expect(edges.get("cut")?.toJSON(), "the edge's field values were lost").toEqual(fieldsBefore);

    // The control edge must not have been caught by the suppression.
    expect(
      isTombstoneSuppressed(readTombstoneEntry(deleted, "keeper")),
      "the parallel edge between the same two cards was suppressed as well",
    ).toBe(false);

    const data = buildCanvasData(nodes, edges, deleted);
    expect(data.edges.map((edge) => edge.id)).toEqual(["keeper"]);
    expect(data.nodes.map((node) => node.id).sort()).toEqual(["a", "b"]);

    room.cs.destroy();
  });

  it("the edge delete emits no key removal on the edges map", async () => {
    const room = await makeRoom(canvasJson([A, B], [E_CUT, E_KEEP]), ["a", "b"], ["cut", "keeper"]);
    const edges = room.doc.getMap<Y.Map<unknown>>("edges");

    const removals: string[] = [];
    edges.observe((event: Y.YMapEvent<Y.Map<unknown>>) => {
      for (const [key, change] of event.changes.keys) {
        if (change.action === "delete") removals.push(key);
      }
    });

    room.vault.files.set(PATH, canvasJson([A, B], [E_KEEP]));
    await room.cs.handleLocalModify(PATH);

    expect(removals, "the edge delete path called `edgesMap.delete(...)`").toEqual([]);
    expect(
      readTombstoneEntry(room.doc.getMap<unknown>("deleted"), "cut")?.on,
      "nothing was removed and nothing was tombstoned — the edge delete was simply dropped",
    ).toBe(true);

    room.cs.destroy();
  });
});
