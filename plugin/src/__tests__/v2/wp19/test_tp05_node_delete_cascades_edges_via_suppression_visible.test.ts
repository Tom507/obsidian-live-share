// WP19 / AC3 — "Deleting a node still causes its edges to disappear from the
// view and the file (cascade preserved), expressed through tombstones or the
// suppression rule rather than key removal."
//
// This AC has a trap built into it. The OLD cascade
// (`pruneEdgesForDeletedNodes` → `edgesMap.delete(edgeId)`) already makes the
// edge disappear from both the view and the file, so an implementation that
// changes nothing at all passes the "disappear" half. The discriminating half is
// the second clause: the edge KEY must still be there afterwards.
//
// So the three assertions have to be made together, in one scenario:
//
//   ├── `nodes` and `edges` still hold every key they held before the delete
//   │      (nothing was destroyed — the record is recoverable), AND
//   ├── the deleted card and its edge are absent from what the view is handed,
//   │      AND
//   └── they are absent from the FILE — the bytes `CanvasPersistence` writes,
//          which is the only definition of "the file" this project has.
//
// The file half exercises a second wiring point: `CanvasPersistence` serialises
// with `serializeCanvas(nodes, edges)`, and a two-argument call suppresses
// nothing. A flush is forced explicitly rather than waited for, so the assertion
// is about the projection, never about a timer.
//
// The control pair (`c` → `d`, untouched) proves the suppression is scoped to
// the affected edge and not to "every edge in the canvas".

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { isTombstoneSuppressed, readTombstoneEntry } from "../../../canvas/canvas-tombstone";
import { CanvasPersistence, type PersistenceIO } from "../../../files/canvas-persistence";
import { CanvasSync, buildCanvasData } from "../../../files/canvas-sync";

const PATH = "map.canvas";

const HUB = { id: "hub", type: "text", x: 0, y: 0, width: 200, height: 100, text: "hub" };
const SPOKE = { id: "spoke", type: "text", x: 400, y: 0, width: 200, height: 100, text: "spoke" };
const C = { id: "c", type: "text", x: 0, y: 400, width: 200, height: 100, text: "c" };
const D = { id: "d", type: "text", x: 400, y: 400, width: 200, height: 100, text: "d" };
const E_HUB = {
  id: "e-hub",
  fromNode: "hub",
  fromSide: "right",
  toNode: "spoke",
  toSide: "left",
  label: "cascade victim",
};
const E_CTRL = { id: "e-ctrl", fromNode: "c", fromSide: "right", toNode: "d", toSide: "left" };

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

function createIO(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial));
  const io = {
    files,
    read: vi.fn(async (p: string) => files.get(p) ?? ""),
    write: vi.fn(async (p: string, c: string) => {
      files.set(p, c);
    }),
    exists: vi.fn(async (p: string) => files.has(p)),
    mutePathEvents: vi.fn((_p: string) => {}),
    unmutePathEvents: vi.fn((_p: string) => {}),
  };
  return io satisfies PersistenceIO & { files: Map<string, string> };
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

function fileIds(content: string): { nodes: unknown[]; edges: unknown[] } {
  const parsed = JSON.parse(content) as {
    nodes?: Record<string, unknown>[];
    edges?: Record<string, unknown>[];
  };
  return {
    nodes: (parsed.nodes ?? []).map((node) => node.id),
    edges: (parsed.edges ?? []).map((edge) => edge.id),
  };
}

describe("WP19 AC3 — the edge cascade is preserved, and expressed as suppression", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("deleting `hub` removes `e-hub` from the view and the file while both keys survive in the doc", async () => {
    const seedJson = canvasJson([HUB, SPOKE, C, D], [E_HUB, E_CTRL]);
    const vault = createVault({ [PATH]: seedJson });
    const syncManager = createSyncManager();
    const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
    const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
    cs.setLogger({ debug: () => {}, warn: () => {} });
    cs.setSurfaceStateProvider(
      (): SurfaceState => ({
        viewOpen: true,
        handedToView: {
          node: new Set(["hub", "spoke", "c", "d"]),
          edge: new Set(["e-hub", "e-ctrl"]),
        },
      }),
    );
    await cs.subscribe(PATH, "host");

    const doc = syncManager.getDoc(`__canvas__:${PATH}`).doc;
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    const edges = doc.getMap<Y.Map<unknown>>("edges");
    const deleted = doc.getMap<unknown>("deleted");

    const nodeKeysBefore = [...nodes.keys()].sort();
    const edgeKeysBefore = [...edges.keys()].sort();
    const cascadedEdgeBefore = edges.get("e-hub");
    const cascadedFieldsBefore = cascadedEdgeBefore?.toJSON();

    const io = createIO({ [PATH]: seedJson });
    const persistence = new CanvasPersistence(doc, io, PATH, {
      logger: { debug: () => {}, warn: () => {} },
    });

    // The user deletes the hub card. The save still LISTS `e-hub`, so the edge
    // gets no delete intent of its own — the only thing that can make it vanish
    // is the cascade, which is exactly what this AC is about.
    vault.files.set(PATH, canvasJson([SPOKE, C, D], [E_HUB, E_CTRL]));
    await cs.handleLocalModify(PATH);

    // 1 — nothing was destroyed.
    expect([...nodes.keys()].sort(), "a node key was removed by the delete").toEqual(
      nodeKeysBefore,
    );
    expect(
      [...edges.keys()].sort(),
      "the cascade removed an edge key instead of suppressing it",
    ).toEqual(edgeKeysBefore);
    expect(edges.get("e-hub"), "the cascaded edge's container was replaced").toBe(
      cascadedEdgeBefore,
    );
    expect(
      edges.get("e-hub")?.toJSON(),
      "the cascaded edge lost field values — it is no longer restorable",
    ).toEqual(cascadedFieldsBefore);

    // 2 — the deleted node is suppressed, so the cascade has a cause.
    expect(
      isTombstoneSuppressed(readTombstoneEntry(deleted, "hub")),
      "the node delete wrote no suppressing tombstone",
    ).toBe(true);

    // 3 — the VIEW no longer shows either of them.
    const view = buildCanvasData(nodes, edges, deleted);
    expect(view.nodes.map((node) => node.id).sort()).toEqual(["c", "d", "spoke"]);
    expect(
      view.edges.map((edge) => edge.id),
      "the cascade did not reach the view, or it took the control edge with it",
    ).toEqual(["e-ctrl"]);

    // 4 — and neither does the FILE.
    await persistence.flush();
    const written = io.files.get(PATH);
    expect(written, "the persistence writer never wrote the file").toBeDefined();
    const onDisk = fileIds(written ?? "{}");
    expect(onDisk.nodes.sort()).toEqual(["c", "d", "spoke"]);
    expect(onDisk.edges, "the cascaded edge is still in the file").toEqual(["e-ctrl"]);

    persistence.destroy();
    cs.destroy();
  });
});
