// WP19 AC1 blind2, EDGE branch — the degenerate case: EVERY arrow at once.
//
// Emptying a whole id space is where a "clean up while we are here" shortcut
// lives. `edges.size === 0` after the pass is indistinguishable from a correct
// result if you only look at the file, and it is the state a `clear()`, a
// rebuild-from-save, or a loop that deletes keys while iterating would produce.
// Under V2 the edges map must still hold all three keys and all three records
// afterwards; only the tombstones changed.
//
// The arrows are deliberately heterogeneous — one fully specified, one with no
// sides at all, one carrying a colour and a label — so a restore path that
// normalises records is visible as a field that came back different.
//
// The nodes are the control: no node is deleted, so no node may acquire a
// tombstone. An implementation that tombstoned "everything the save no longer
// mentions" without separating the two id spaces fails there.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { isTombstoneSuppressed, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import { CanvasSync, buildCanvasData } from "../../../files/canvas-sync";

const PATH = "topology.canvas";

const P = { id: "p", type: "text", x: 0, y: 0, width: 160, height: 80, text: "p" };
const Q = { id: "q", type: "text", x: 400, y: 0, width: 160, height: 80, text: "q" };
const R = { id: "r", type: "text", x: 200, y: 400, width: 160, height: 80, text: "r" };

const EDGES = [
  { id: "pq", fromNode: "p", fromSide: "right", toNode: "q", toSide: "left" },
  { id: "qr", fromNode: "q", toNode: "r" },
  { id: "rp", fromNode: "r", fromSide: "left", toNode: "p", toSide: "bottom", label: "back", color: "5" },
];

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

describe("WP19 AC1 blind2 — deleting every arrow empties the drawing, not the container", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("all three arrows are tombstoned and all three records are still there, whole; no node is touched", async () => {
    const vault = createVault({ [PATH]: canvasJson([P, Q, R], EDGES) });
    const syncManager = createSyncManager();
    const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
    const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
    cs.setLogger({ debug: () => {}, warn: () => {} });
    cs.setSurfaceStateProvider(
      (): SurfaceState => ({
        viewOpen: true,
        handedToView: {
          node: new Set(["p", "q", "r"]),
          edge: new Set(["pq", "qr", "rp"]),
        },
      }),
    );
    await cs.subscribe(PATH, "host");

    const doc = syncManager.getDoc(`__canvas__:${PATH}`).doc;
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    const edges = doc.getMap<Y.Map<unknown>>("edges");
    const deleted = doc.getMap<unknown>("deleted");

    const before = new Map<string, Record<string, unknown>>();
    for (const id of ["pq", "qr", "rp"]) {
      const record = edges.get(id);
      expect(record, `the host seed never created arrow ${id}`).toBeDefined();
      before.set(id, record?.toJSON() ?? {});
    }

    // The user selects every arrow and deletes the lot.
    vault.files.set(PATH, canvasJson([P, Q, R], []));
    await cs.handleLocalModify(PATH);

    expect(
      [...edges.keys()].sort(),
      "the edge id space was emptied — the records are gone, not suppressed",
    ).toEqual(["pq", "qr", "rp"]);

    for (const id of ["pq", "qr", "rp"]) {
      expect(
        isTombstoneSuppressed(readTombstoneEntry(deleted, id)),
        `arrow ${id} was removed without a tombstone`,
      ).toBe(true);
      const after = edges.get(id)?.toJSON() ?? {};
      for (const [key, value] of Object.entries(before.get(id) ?? {})) {
        expect(after[key], `arrow ${id} lost field \`${key}\``).toEqual(value);
      }
      expect(
        Object.keys(after).sort(),
        `arrow ${id} gained or lost keys across the delete`,
      ).toEqual(Object.keys(before.get(id) ?? {}).sort());
    }

    // No card was deleted, so no card may be suppressed.
    for (const id of ["p", "q", "r"]) {
      expect(
        isTombstoneSuppressed(readTombstoneEntry(deleted, id)),
        `card ${id} was tombstoned by an edge-only delete`,
      ).toBe(false);
    }

    const view = buildCanvasData(nodes, edges, deleted);
    expect(view.edges, "an arrow is still drawn").toEqual([]);
    expect(view.nodes.map((node) => node.id).sort()).toEqual(["p", "q", "r"]);

    cs.destroy();
  });
});
