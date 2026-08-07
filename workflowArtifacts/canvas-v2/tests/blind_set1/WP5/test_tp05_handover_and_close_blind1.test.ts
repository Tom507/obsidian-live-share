// WP5 — the reconcile receipt supplies the capture path's surface state.
//
// Angle: TWO surfaces and the EDGE id space. A hand-over on one canvas must not
// unlock deletes on another, and a node hand-over must not unlock an edge delete.
// Both are the mistakes a single flat "handed" set would make.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  advanceFromReceipt,
  buildApplyReceipt,
  createSurfaceStateStore,
  getRecordState,
} from "../../../canvas/canvas-shadow";
import { CanvasSync } from "../../../files/canvas-sync";

const ONE = "rooms/one.canvas";
const TWO = "rooms/two.canvas";

const NODES = [
  { id: "x", type: "text", x: 0, y: 0, width: 60, height: 60, text: "x" },
  { id: "y", type: "text", x: 90, y: 0, width: 60, height: 60, text: "y" },
];
const EDGES = [{ id: "x-y", fromNode: "x", toNode: "y", fromSide: "right", toSide: "left" }];

function canvasJson(nodes: Record<string, unknown>[], edges: Record<string, unknown>[]): string {
  return JSON.stringify({ nodes, edges });
}

function createVault(initial: Record<string, string>) {
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

function docRecords(doc: Y.Doc) {
  const read = (name: string): Record<string, unknown>[] => {
    const out: Record<string, unknown>[] = [];
    for (const [, record] of doc.getMap<Y.Map<unknown>>(name)) {
      out.push(Object.fromEntries(record.entries()));
    }
    return out;
  };
  return { nodes: read("nodes"), edges: read("edges") };
}

async function makeClient() {
  const content = canvasJson(NODES, EDGES);
  const vault = createVault({ [ONE]: content, [TWO]: content });
  const syncManager = createSyncManager();
  const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
  const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
  cs.setLogger({ debug: () => {}, warn: () => {} });

  const open = new Set<string>([ONE, TWO]);
  const store = createSurfaceStateStore((path: string) => open.has(path));
  cs.setSurfaceStateProvider((path: string) => store.stateFor(path));

  await cs.subscribe(ONE, "host");
  await cs.subscribe(TWO, "host");
  return {
    vault,
    cs,
    store,
    open,
    docOne: syncManager.getDoc(`__canvas__:${ONE}`).doc,
    docTwo: syncManager.getDoc(`__canvas__:${TWO}`).doc,
  };
}

describe("WP5 (blind1) — hand-over is per surface and per id space", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("a hand-over on one canvas does not unlock deletes on the other", async () => {
    const c = await makeClient();
    const summary = advanceFromReceipt(
      c.cs.getSurfaceShadow(),
      buildApplyReceipt({
        path: ONE,
        desired: docRecords(c.docOne),
        plan: "structural",
        reloaded: true,
      }),
    );
    c.store.noteHandover(ONE, summary.handed);

    expect(c.store.stateFor(TWO).handedToView.node.size).toBe(0);

    // The same omission is saved on BOTH surfaces.
    c.vault.files.set(ONE, canvasJson([NODES[0]], EDGES));
    c.vault.files.set(TWO, canvasJson([NODES[0]], EDGES));
    await c.cs.handleLocalModify(ONE);
    await c.cs.handleLocalModify(TWO);

    expect(c.docOne.getMap<Y.Map<unknown>>("nodes").has("y")).toBe(false);
    expect(
      c.docTwo.getMap<Y.Map<unknown>>("nodes").has("y"),
      "a hand-over leaked across surfaces",
    ).toBe(true);
  });

  it("a node hand-over does not unlock an edge delete", async () => {
    const c = await makeClient();
    // Only the node id space was handed over this pass.
    c.store.noteHandover(ONE, { node: new Set(["x", "y"]), edge: new Set<string>() });

    c.vault.files.set(ONE, canvasJson(NODES, []));
    await c.cs.handleLocalModify(ONE);

    expect(
      c.docOne.getMap<Y.Map<unknown>>("edges").has("x-y"),
      "an edge was deleted on a node-only hand-over receipt",
    ).toBe(true);

    // With the edge handed over, the same observation does delete it. The record
    // order is flipped so the bytes differ and the echo breaker stays out of it.
    c.store.noteHandover(ONE, { node: new Set(["x", "y"]), edge: new Set(["x-y"]) });
    c.vault.files.set(ONE, canvasJson([NODES[1], NODES[0]], []));
    await c.cs.handleLocalModify(ONE);
    expect(c.docOne.getMap<Y.Map<unknown>>("edges").has("x-y")).toBe(false);
    expect(getRecordState(c.cs.getSurfaceShadow(), ONE, "edge", "x-y")).toBe("absent");
  });

  it("closing one surface leaves the other's hand-over intact", async () => {
    const c = await makeClient();
    c.store.noteHandover(ONE, { node: new Set(["x", "y"]), edge: new Set(["x-y"]) });
    c.store.noteHandover(TWO, { node: new Set(["x", "y"]), edge: new Set(["x-y"]) });

    c.open.delete(ONE);
    c.store.clearPath(ONE);

    expect(c.store.stateFor(ONE).viewOpen).toBe(false);
    expect(c.store.stateFor(ONE).handedToView.node.size).toBe(0);
    expect(c.store.stateFor(TWO).viewOpen).toBe(true);
    expect([...c.store.stateFor(TWO).handedToView.node].sort()).toEqual(["x", "y"]);
  });
});
