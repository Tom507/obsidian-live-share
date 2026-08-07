// WP5 — the reconcile receipt supplies the capture path's surface state.
//
// Angle: the CLOSE / RE-OPEN cycle. V1 dropped its record snapshot when the view
// closed, which re-opened the exact window the cascade starts in. Here the shared
// shadow must survive the close while the hand-over receipt must not, and the
// re-open's forced `initial` pass must re-establish the hand-over from scratch —
// `noteHandover` REPLACES the previous receipt, it never accumulates.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  advanceFromReceipt,
  buildApplyReceipt,
  createSurfaceStateStore,
  getField,
  getRecordState,
  shadowToCanvasRecords,
} from "../../../canvas/canvas-shadow";
import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "cycle/open-close.canvas";

const NODES = [
  { id: "m", type: "text", x: 0, y: 0, width: 70, height: 70, text: "m" },
  { id: "n", type: "text", x: 100, y: 0, width: 70, height: 70, text: "n" },
  { id: "o", type: "text", x: 200, y: 0, width: 70, height: 70, text: "o" },
];

function canvasJson(nodes: Record<string, unknown>[]): string {
  return JSON.stringify({ nodes, edges: [] });
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
  const out: Record<string, unknown>[] = [];
  for (const [, record] of doc.getMap<Y.Map<unknown>>("nodes")) {
    out.push(Object.fromEntries(record.entries()));
  }
  return { nodes: out, edges: [] as Record<string, unknown>[] };
}

function fingerprint(doc: Y.Doc): string {
  return Array.from(Y.encodeStateVector(doc)).join(",");
}

async function makeClient() {
  const vault = createVault({ [PATH]: canvasJson(NODES) });
  const syncManager = createSyncManager();
  const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
  const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
  cs.setLogger({ debug: () => {}, warn: () => {} });
  const open = new Set<string>([PATH]);
  const store = createSurfaceStateStore((path: string) => open.has(path));
  cs.setSurfaceStateProvider((path: string) => store.stateFor(path));
  await cs.subscribe(PATH, "host");
  return { vault, cs, store, open, doc: syncManager.getDoc(`__canvas__:${PATH}`).doc };
}

function confirmReload(client: Awaited<ReturnType<typeof makeClient>>) {
  const summary = advanceFromReceipt(
    client.cs.getSurfaceShadow(),
    buildApplyReceipt({
      path: PATH,
      desired: docRecords(client.doc),
      plan: "structural",
      reloaded: true,
    }),
  );
  client.store.noteHandover(PATH, summary.handed);
  return summary;
}

describe("WP5 (blind2) — the close / re-open cycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("the shared basis survives a close and the hand-over does not", async () => {
    const c = await makeClient();
    confirmReload(c);

    c.open.delete(PATH);
    c.store.clearPath(PATH);

    expect(c.store.stateFor(PATH).handedToView.node.size).toBe(0);
    expect(shadowToCanvasRecords(c.cs.getSurfaceShadow(), PATH)?.nodes).toHaveLength(3);
    expect(getField(c.cs.getSurfaceShadow(), PATH, "node", "o", "text")).toBe("o");
  });

  it("a save right after the close is intent-free and deletes nothing", async () => {
    const c = await makeClient();
    confirmReload(c);
    c.open.delete(PATH);
    c.store.clearPath(PATH);

    const before = fingerprint(c.doc);
    // Different bytes, same values, and one record omitted for good measure.
    c.vault.files.set(
      PATH,
      canvasJson([
        { text: "o", height: 70, width: 70, y: 0, x: 200, type: "text", id: "o" },
        { text: "m", height: 70, width: 70, y: 0, x: 0, type: "text", id: "m" },
      ]),
    );
    await c.cs.handleLocalModify(PATH);

    expect(fingerprint(c.doc), "closing the canvas reopened the cascade window").toBe(before);
    expect(
      c.doc.getMap<Y.Map<unknown>>("nodes").has("n"),
      "a closed view has no hand-over receipt, so an omission is ignorance",
    ).toBe(true);
    expect(getRecordState(c.cs.getSurfaceShadow(), PATH, "node", "n")).toBe("present");
  });

  it("re-opening re-establishes the hand-over through a fresh receipt", async () => {
    const c = await makeClient();
    confirmReload(c);
    c.open.delete(PATH);
    c.store.clearPath(PATH);

    // Re-open: the mount forces an `initial` structural pass.
    c.open.add(PATH);
    expect(c.store.stateFor(PATH).viewOpen).toBe(true);
    expect(c.store.stateFor(PATH).handedToView.node.size).toBe(0);

    confirmReload(c);
    expect([...c.store.stateFor(PATH).handedToView.node].sort()).toEqual(["m", "n", "o"]);
  });

  it("noteHandover replaces the previous receipt instead of accumulating", async () => {
    const c = await makeClient();
    c.store.noteHandover(PATH, { node: new Set(["m", "n", "o"]), edge: new Set(["e"]) });
    c.store.noteHandover(PATH, { node: new Set(["m"]), edge: new Set<string>() });

    const handed = c.store.stateFor(PATH).handedToView;
    expect([...handed.node]).toEqual(["m"]);
    expect(handed.edge.size).toBe(0);

    // …and the capture path sees exactly that: only `m` may be deleted.
    c.vault.files.set(PATH, canvasJson([{ ...NODES[1] }]));
    await c.cs.handleLocalModify(PATH);
    const nodes = c.doc.getMap<Y.Map<unknown>>("nodes");
    expect(nodes.has("m")).toBe(false);
    expect(nodes.has("o")).toBe(true);
  });
});
