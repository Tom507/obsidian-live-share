// WP5 / AC1 + AC2 — the reconcile receipt is what supplies the capture path's
// surface state, and closing a view must not destroy the shared basis.
//
// AC1 ("no second, parallel shadow") has a second, easily-missed half: the C4
// delete rule is gated on `handedToView`, and WP4 left that seam at its honest
// P0 default ("closed, nothing handed"). WP5 owns the real value, and it must
// come from the SAME confirmed apply that advances the shadow — otherwise the
// hand-over receipt and the field receipt can drift apart, which is exactly the
// drift the Definition of Done forbids.
//
//   ├── T1 before any confirmed apply nothing is handed over, so an omission in
//   │      a save is ignorance, not a deletion (I7).
//   ├── T2 after a confirmed apply the same omission IS a deletion — the rule is
//   │      gated, not removed.
//   ├── T3 a record skipped as `"interacting"` is NOT handed over, so the card
//   │      the user is holding can never be deleted by the save it never saw.
//   ├── T4 closing the view drops the hand-over state ONLY. The shared shadow
//   │      keeps every field, so the first save after a close is still intent-
//   │      free — the cascade window V1 opened by dropping its record snapshot.
//   └── T5 `clearAll()` drops every surface's hand-over and nothing else.
//
// No wall-clock sleep, no `setTimeout` wait, no timing constant.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  type ApplyOutcome,
  advanceFromReceipt,
  buildApplyReceipt,
  createSurfaceStateStore,
  getField,
  getRecordState,
  shadowToCanvasRecords,
} from "../../../canvas/canvas-shadow";
import { CanvasSync } from "../../../files/canvas-sync";

const PATH = "wiki/map.canvas";
const OTHER = "wiki/other.canvas";

const N1 = { id: "n1", type: "text", x: 0, y: 0, width: 200, height: 100, text: "one" };
const N2 = { id: "n2", type: "text", x: 300, y: 0, width: 200, height: 100, text: "two" };
const N3 = { id: "n3", type: "text", x: 600, y: 0, width: 200, height: 100, text: "three" };

function canvasJson(nodes: Record<string, unknown>[], edges: Record<string, unknown>[] = []): string {
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

function docRecords(doc: Y.Doc): {
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
} {
  const read = (name: string): Record<string, unknown>[] => {
    const out: Record<string, unknown>[] = [];
    for (const [, record] of doc.getMap<Y.Map<unknown>>(name)) {
      out.push(Object.fromEntries(record.entries()));
    }
    return out;
  };
  return { nodes: read("nodes"), edges: read("edges") };
}

function fingerprint(doc: Y.Doc): string {
  return Array.from(Y.encodeStateVector(doc)).join(",");
}

async function makePeer(diskJson: string) {
  const vault = createVault({ [PATH]: diskJson });
  const syncManager = createSyncManager();
  const fileOps = { mutePathEvents: vi.fn(), unmutePathEvents: vi.fn() };
  const cs = new CanvasSync(vault as never, syncManager as never, fileOps as never);
  cs.setLogger({ debug: () => {}, warn: () => {} });

  // The whole surface-state seam, exactly as `main.ts` is specified to wire it.
  const openPaths = new Set<string>([PATH]);
  const store = createSurfaceStateStore((path: string) => openPaths.has(path));
  cs.setSurfaceStateProvider((path: string) => store.stateFor(path));

  await cs.subscribe(PATH, "host");
  const doc = syncManager.getDoc(`__canvas__:${PATH}`).doc;
  return { vault, cs, doc, store, openPaths };
}

/** One landed structural reload, reported through the receipt seam. */
function confirmReload(cs: CanvasSync, store: ReturnType<typeof createSurfaceStateStore>, path: string, data: ReturnType<typeof docRecords>) {
  const summary = advanceFromReceipt(
    cs.getSurfaceShadow(),
    buildApplyReceipt({ path, desired: data, plan: "structural", reloaded: true }),
  );
  store.noteHandover(path, summary.handed);
  return summary;
}

describe("WP5 — the reconcile receipt supplies the capture path's surface state", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("T1 nothing is handed over before a confirmed apply", async () => {
    const p = await makePeer(canvasJson([N1, N2, N3]));

    const state = p.store.stateFor(PATH);
    expect(state.viewOpen).toBe(true);
    expect(state.handedToView.node.size).toBe(0);
    expect(state.handedToView.edge.size).toBe(0);

    p.vault.files.set(PATH, canvasJson([N1, N3]));
    await p.cs.handleLocalModify(PATH);

    expect(
      p.doc.getMap<Y.Map<unknown>>("nodes").has("n2"),
      "an omission without a hand-over receipt deleted a record (I7)",
    ).toBe(true);
  });

  it("T2 after a confirmed apply the same omission is a deletion", async () => {
    const p = await makePeer(canvasJson([N1, N2, N3]));
    confirmReload(p.cs, p.store, PATH, docRecords(p.doc));

    expect([...p.store.stateFor(PATH).handedToView.node].sort()).toEqual(["n1", "n2", "n3"]);

    p.vault.files.set(PATH, canvasJson([N1, N3]));
    await p.cs.handleLocalModify(PATH);

    expect(p.doc.getMap<Y.Map<unknown>>("nodes").has("n2")).toBe(false);
    expect(getRecordState(p.cs.getSurfaceShadow(), PATH, "node", "n2")).toBe("absent");
  });

  it("T3 an interacting record is never handed over, so it cannot be deleted", async () => {
    const p = await makePeer(canvasJson([N1, N2, N3]));
    const data = docRecords(p.doc);

    const outcomes = new Map<string, ApplyOutcome>([
      ["n1", "applied"],
      ["n2", "interacting"],
      ["n3", "applied"],
    ]);
    const summary = advanceFromReceipt(
      p.cs.getSurfaceShadow(),
      buildApplyReceipt({ path: PATH, desired: data, plan: "geometry", nodeOutcomes: outcomes }),
    );
    p.store.noteHandover(PATH, summary.handed);

    // Obsidian saves a picture that has neither card. Only the handed one may go.
    p.vault.files.set(PATH, canvasJson([N3]));
    await p.cs.handleLocalModify(PATH);

    const nodes = p.doc.getMap<Y.Map<unknown>>("nodes");
    expect(nodes.has("n1"), "a handed-over record survived its proven deletion").toBe(false);
    expect(nodes.has("n2"), "the card the user was holding was deleted by a save it never saw").toBe(
      true,
    );
  });

  it("T4 closing the view drops the hand-over only, never the shared shadow", async () => {
    const p = await makePeer(canvasJson([N1, N2, N3]));
    confirmReload(p.cs, p.store, PATH, docRecords(p.doc));

    // The user closes the canvas: adapter gone, hand-over receipt void.
    p.openPaths.delete(PATH);
    p.store.clearPath(PATH);

    const state = p.store.stateFor(PATH);
    expect(state.viewOpen).toBe(false);
    expect(state.handedToView.node.size).toBe(0);

    // The basis itself survives — this is what makes it ONE structure.
    expect(shadowToCanvasRecords(p.cs.getSurfaceShadow(), PATH)).not.toBeNull();
    expect(getField(p.cs.getSurfaceShadow(), PATH, "node", "n2", "text")).toBe("two");

    // …so the first save after the close is still intent-free (different key
    // order → different bytes, so the byte echo breaker is not what silences it).
    const before = fingerprint(p.doc);
    p.vault.files.set(
      PATH,
      canvasJson([
        { text: "one", height: 100, width: 200, y: 0, x: 0, type: "text", id: "n1" },
        { text: "two", height: 100, width: 200, y: 0, x: 300, type: "text", id: "n2" },
        { text: "three", height: 100, width: 200, y: 0, x: 600, type: "text", id: "n3" },
      ]),
    );
    await p.cs.handleLocalModify(PATH);

    expect(fingerprint(p.doc), "closing a canvas reopened the cascade window").toBe(before);
  });

  it("T5 clearAll drops every surface's hand-over", async () => {
    const p = await makePeer(canvasJson([N1, N2]));
    p.openPaths.add(OTHER);
    confirmReload(p.cs, p.store, PATH, docRecords(p.doc));
    p.store.noteHandover(OTHER, { node: new Set(["x1"]), edge: new Set(["x2"]) });

    expect(p.store.stateFor(OTHER).handedToView.node.has("x1")).toBe(true);

    p.store.clearAll();

    expect(p.store.stateFor(PATH).handedToView.node.size).toBe(0);
    expect(p.store.stateFor(OTHER).handedToView.node.size).toBe(0);
    expect(p.store.stateFor(OTHER).handedToView.edge.size).toBe(0);
    // Still one structure: the shadow is untouched by hand-over bookkeeping.
    expect(getField(p.cs.getSurfaceShadow(), PATH, "node", "n1", "text")).toBe("one");
  });
});
