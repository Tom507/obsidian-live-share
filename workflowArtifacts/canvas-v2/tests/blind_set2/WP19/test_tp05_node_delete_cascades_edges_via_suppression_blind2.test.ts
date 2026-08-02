// WP19 AC3 blind2 — the cascade under three replicas, judged on FILE BYTES.
//
// A cascade expressed as suppression is a DERIVED fact: every replica has to
// recompute "this arrow's endpoint is gone" from the same tombstone, rather than
// receiving a key removal that already did the thinking for it. That is strictly
// harder than the old mechanism, and it fails in a specific way — one replica's
// file disagrees with another's while both docs hold the same state. Byte
// equality across three replicas is the only assertion that sees it; each
// replica's file read on its own would look perfectly reasonable.
//
// Three, not two: with two replicas an agreed-but-wrong projection and a
// genuinely converged one are the same picture.
//
// The deleted card is a HUB with an arrow INTO it and an arrow OUT of it, so the
// cascade has to consider `fromNode` and `toNode` on the same pass. The `far`
// arrow between two untouched cards is the control. The delete itself runs
// through the ordinary capture path, and the save still LISTS both hub arrows —
// so nothing but the cascade can make them vanish.

import { TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { buildCanvasData, serializeCanvas, CanvasSync } from "../../../files/canvas-sync";

const PATH = "wheel.canvas";

const HUB = { id: "hub", type: "text", x: 0, y: 0, width: 200, height: 100, text: "hub" };
const NORTH = { id: "north", type: "text", x: 0, y: -400, width: 200, height: 100, text: "north" };
const SOUTH = { id: "south", type: "text", x: 0, y: 400, width: 200, height: 100, text: "south" };
const ISLAND_A = {
  id: "island-a",
  type: "text",
  x: 900,
  y: 0,
  width: 200,
  height: 100,
  text: "island a",
};
const ISLAND_B = {
  id: "island-b",
  type: "text",
  x: 900,
  y: 400,
  width: 200,
  height: 100,
  text: "island b",
};

const IN = { id: "in", fromNode: "north", fromSide: "bottom", toNode: "hub", toSide: "top" };
const OUT = {
  id: "out",
  fromNode: "hub",
  fromSide: "bottom",
  toNode: "south",
  toSide: "top",
  label: "downstream",
};
const FAR = {
  id: "far",
  fromNode: "island-a",
  fromSide: "bottom",
  toNode: "island-b",
  toSide: "top",
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

function replicate(from: Y.Doc): Y.Doc {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(from), "peer");
  return copy;
}

function project(doc: Y.Doc): string {
  return serializeCanvas(
    doc.getMap<Y.Map<unknown>>("nodes"),
    doc.getMap<Y.Map<unknown>>("edges"),
    doc.getMap<unknown>("deleted"),
  );
}

describe("WP19 AC3 blind2 — three replicas derive the same cascaded file from one tombstone", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("every replica projects byte-identical bytes without the hub or either of its arrows, and keeps every key", async () => {
    const vault = createVault({
      [PATH]: canvasJson([HUB, NORTH, SOUTH, ISLAND_A, ISLAND_B], [IN, OUT, FAR]),
    });
    const syncManager = createSyncManager();
    const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
    const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
    cs.setLogger({ debug: () => {}, warn: () => {} });
    cs.setSurfaceStateProvider(
      (): SurfaceState => ({
        viewOpen: true,
        handedToView: {
          node: new Set(["hub", "north", "south", "island-a", "island-b"]),
          // The hub's arrows were never handed over, so rule 4 cannot produce a
          // delete intent for them: only the cascade can remove them.
          edge: new Set(["far"]),
        },
      }),
    );
    await cs.subscribe(PATH, "host");

    const doc1 = syncManager.getDoc(`__canvas__:${PATH}`).doc;
    const doc2 = replicate(doc1);
    const doc3 = replicate(doc1);

    const nodeKeysBefore = [...doc1.getMap<Y.Map<unknown>>("nodes").keys()].sort();
    const edgeKeysBefore = [...doc1.getMap<Y.Map<unknown>>("edges").keys()].sort();
    const outBefore = doc1.getMap<Y.Map<unknown>>("edges").get("out")?.toJSON();
    expect(outBefore, "the host seed never created the arrow under test").toBeDefined();

    // The user deletes the hub. The save still lists both of its arrows.
    vault.files.set(PATH, canvasJson([NORTH, SOUTH, ISLAND_A, ISLAND_B], [IN, OUT, FAR]));
    await cs.handleLocalModify(PATH);

    const delta = Y.encodeStateAsUpdate(doc1);
    Y.applyUpdate(doc2, delta, "peer");
    Y.applyUpdate(doc3, delta, "peer");

    const files = [project(doc1), project(doc2), project(doc3)];
    expect(files[1], "replica 2's file differs from replica 1's").toBe(files[0]);
    expect(files[2], "replica 3's file differs from replica 1's").toBe(files[0]);

    const parsed = JSON.parse(files[0]) as {
      nodes: Record<string, unknown>[];
      edges: Record<string, unknown>[];
    };
    expect(
      parsed.nodes.map((node) => String(node.id)).sort(),
      "the deleted hub is still in the file",
    ).toEqual(["island-a", "island-b", "north", "south"]);
    expect(
      parsed.edges.map((edge) => String(edge.id)).sort(),
      "the cascade missed an arrow, or it took the unrelated one with it",
    ).toEqual(["far"]);

    for (const doc of [doc1, doc2, doc3]) {
      expect(
        [...doc.getMap<Y.Map<unknown>>("nodes").keys()].sort(),
        "a replica lost a node key to achieve the cascade",
      ).toEqual(nodeKeysBefore);
      expect(
        [...doc.getMap<Y.Map<unknown>>("edges").keys()].sort(),
        "a replica lost an edge key to achieve the cascade",
      ).toEqual(edgeKeysBefore);
      expect(
        doc.getMap<Y.Map<unknown>>("edges").get("out")?.toJSON(),
        "a cascaded arrow lost fields — it is no longer restorable",
      ).toEqual(outBefore);
      expect(
        buildCanvasData(
          doc.getMap<Y.Map<unknown>>("nodes"),
          doc.getMap<Y.Map<unknown>>("edges"),
          doc.getMap<unknown>("deleted"),
        ).edges.map((edge) => edge.id),
        "a replica still draws a cascaded arrow in the live view",
      ).toEqual(["far"]);
    }

    cs.destroy();
  });
});
