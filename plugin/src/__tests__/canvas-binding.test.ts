import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  CANVAS_BINDING_ORIGIN,
  CanvasBinding,
  type CanvasModelBridge,
  type CanvasRecord,
  type LocalChange,
} from "../canvas/canvas-binding";

// ===========================================================================
// WP2 — Fake in-memory CanvasModelBridge + two-peer harness + instrumentation.
// ===========================================================================

/**
 * Adversarial fake model. It deliberately re-emits `onLocalChange` on EVERY
 * state-changing mutation — including the remote→model appliers — modelling
 * Obsidian's real "can't-tell-who-moved-it" hazard, so the binding's echo
 * guards (I2 sync, I3 async) actually carry correctness.
 */
class FakeCanvasModel implements CanvasModelBridge {
  readonly nodes = new Map<string, CanvasRecord>();
  readonly edges = new Map<string, CanvasRecord>();
  private readonly listeners = new Set<(c: LocalChange) => void>();

  getNodeIds(): Iterable<string> {
    return [...this.nodes.keys()];
  }
  getEdgeIds(): Iterable<string> {
    return [...this.edges.keys()];
  }
  getNode(id: string): CanvasRecord | null {
    const r = this.nodes.get(id);
    return r ? { ...r } : null;
  }
  getEdge(id: string): CanvasRecord | null {
    const r = this.edges.get(id);
    return r ? { ...r } : null;
  }

  // Remote → model. Adversarially re-emits (the hazard).
  applyNodeUpsert(id: string, record: CanvasRecord): void {
    this.nodes.set(id, { ...record });
    this.emit({ kind: "node", id, record: { ...record } });
  }
  applyNodeRemove(id: string): void {
    if (this.nodes.delete(id)) this.emit({ kind: "node", id, record: null });
  }
  applyEdgeUpsert(id: string, record: CanvasRecord): void {
    this.edges.set(id, { ...record });
    this.emit({ kind: "edge", id, record: { ...record } });
  }
  applyEdgeRemove(id: string): void {
    if (this.edges.delete(id)) this.emit({ kind: "edge", id, record: null });
  }

  onLocalChange(cb: (change: LocalChange) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  // --- test-driven local mutation helpers (also adversarially re-emit) ---
  userSetNode(id: string, record: CanvasRecord): void {
    this.nodes.set(id, { ...record });
    this.emit({ kind: "node", id, record: { ...record } });
  }
  userRemoveNode(id: string): void {
    this.nodes.delete(id);
    this.emit({ kind: "node", id, record: null });
  }
  userSetEdge(id: string, record: CanvasRecord): void {
    this.edges.set(id, { ...record });
    this.emit({ kind: "edge", id, record: { ...record } });
  }
  userRemoveEdge(id: string): void {
    this.edges.delete(id);
    this.emit({ kind: "edge", id, record: null });
  }

  /** Fire a raw local change WITHOUT mutating state — models an async echo signal. */
  emitLocal(change: LocalChange): void {
    this.emit(change);
  }

  private emit(change: LocalChange): void {
    for (const l of [...this.listeners]) l(change);
  }
}

/**
 * Two-peer harness mirroring `canvas-sync.test.ts::applyRemoteCanvasDelta`
 * (RepoMap §2, L62-74). `remote` is synced from `doc` first, so a delete
 * references the SAME item (actually removes it on `doc`) and the integrating
 * transaction is non-local (`tr.local === false`).
 */
function applyRemoteCanvasDelta(
  doc: Y.Doc,
  build: (nodes: Y.Map<Y.Map<unknown>>, edges: Y.Map<Y.Map<unknown>>) => void,
): void {
  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  build(remote.getMap<Y.Map<unknown>>("nodes"), remote.getMap<Y.Map<unknown>>("edges"));
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote));
  remote.destroy();
}

/** Build a node/edge `Y.Map` from a plain record (mirrors `remoteNode` L76-80). */
function remoteNode(fields: CanvasRecord): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(fields)) m.set(k, v);
  return m;
}

/** Seed a doc's nodes/edges maps directly (a local, tr.local===true transaction). */
function seedDoc(
  doc: Y.Doc,
  nodes: Record<string, CanvasRecord>,
  edges: Record<string, CanvasRecord> = {},
): void {
  doc.transact(() => {
    const nm = doc.getMap<Y.Map<unknown>>("nodes");
    const em = doc.getMap<Y.Map<unknown>>("edges");
    for (const [id, rec] of Object.entries(nodes)) nm.set(id, remoteNode(rec));
    for (const [id, rec] of Object.entries(edges)) em.set(id, remoteNode(rec));
  });
}

/**
 * Count Yjs updates on `doc`, filtered to `CANVAS_BINDING_ORIGIN` — i.e. "local
 * pushes only". Remote-integration updates (`origin !== CANVAS_BINDING_ORIGIN`)
 * are NOT counted, so a nonzero count is always an echo bug.
 */
function countOriginUpdates(doc: Y.Doc): { count: () => number; stop: () => void } {
  let n = 0;
  const handler = (_update: Uint8Array, origin: unknown): void => {
    if (origin === CANVAS_BINDING_ORIGIN) n++;
  };
  doc.on("update", handler);
  return { count: () => n, stop: () => doc.off("update", handler) };
}

function nodeRecord(doc: Y.Doc, id: string): CanvasRecord | null {
  const ym = doc.getMap<Y.Map<unknown>>("nodes").get(id);
  if (!ym) return null;
  const obj: CanvasRecord = {};
  for (const [k, v] of ym) obj[k] = v;
  return obj;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ===========================================================================
// WP2 smoke — the scaffolding itself behaves as required.
// ===========================================================================

describe("CanvasBinding harness + fake (WP2)", () => {
  it("fake implements all 9 members; getNode/getEdge return copies or null (US2 AC1)", () => {
    const model = new FakeCanvasModel();
    model.userSetNode("n1", { id: "n1", x: 1 });
    const a = model.getNode("n1");
    const b = model.getNode("n1");
    expect(a).toEqual({ id: "n1", x: 1 });
    expect(a).not.toBe(b); // distinct copies
    expect(model.getNode("missing")).toBeNull();
    expect(model.getEdge("missing")).toBeNull();
    expect([...model.getNodeIds()]).toEqual(["n1"]);
  });

  it("onLocalChange returns a working unsubscribe (US2 AC3)", () => {
    const model = new FakeCanvasModel();
    const seen: LocalChange[] = [];
    const off = model.onLocalChange((c) => seen.push(c));
    model.userSetNode("n1", { id: "n1", x: 1 });
    off();
    model.userSetNode("n1", { id: "n1", x: 2 });
    expect(seen).toHaveLength(1);
  });

  it("harness integrates as a non-local transaction (US2 AC4)", () => {
    const doc = new Y.Doc();
    seedDoc(doc, { n1: { id: "n1", x: 0 } });
    let sawLocal: boolean | null = null;
    doc.on("afterTransaction", (tr) => {
      sawLocal = tr.local;
    });
    applyRemoteCanvasDelta(doc, (nodes) => {
      nodes.get("n1")?.set("x", 9);
    });
    expect(sawLocal).toBe(false);
    expect(nodeRecord(doc, "n1")).toMatchObject({ x: 9 });
  });
});

// ===========================================================================
// WP3 — Test contract T1–T10 (SPEC_01 §10).
// ===========================================================================

describe("CanvasBinding contract T1–T10 (WP3)", () => {
  it("T1 seed — construct brings an empty model up to a populated doc", () => {
    const doc = new Y.Doc();
    seedDoc(
      doc,
      {
        n1: { id: "n1", type: "text", x: 0, y: 0, width: 100, height: 50, text: "a" },
        n2: { id: "n2", type: "text", x: 200, y: 0, width: 100, height: 50, text: "b" },
      },
      { e1: { id: "e1", fromNode: "n1", toNode: "n2" } },
    );
    const model = new FakeCanvasModel();
    const binding = new CanvasBinding(doc, model);

    expect(new Set(model.getNodeIds())).toEqual(new Set(["n1", "n2"]));
    expect(new Set(model.getEdgeIds())).toEqual(new Set(["e1"]));
    expect(model.getNode("n1")).toEqual(nodeRecord(doc, "n1"));
    expect(model.getNode("n2")).toEqual(nodeRecord(doc, "n2"));
    expect(model.getEdge("e1")).toEqual({ id: "e1", fromNode: "n1", toNode: "n2" });

    binding.destroy();
  });

  it("T2 capture — one user node move emits exactly one origin update with only the diff", () => {
    const doc = new Y.Doc();
    seedDoc(doc, { n1: { id: "n1", x: 0, y: 0, width: 100, height: 50 } });
    const model = new FakeCanvasModel();
    const binding = new CanvasBinding(doc, model);

    const changedKeys: string[] = [];
    doc.getMap<Y.Map<unknown>>("nodes").observeDeep((events) => {
      for (const ev of events) {
        const keys = (ev as Y.YMapEvent<unknown>).keysChanged;
        if (keys) changedKeys.push(...keys);
      }
    });
    const counter = countOriginUpdates(doc);

    model.userSetNode("n1", { id: "n1", x: 20, y: 0, width: 100, height: 50 });

    expect(counter.count()).toBe(1); // exactly one origin update
    expect(changedKeys).toEqual(["x"]); // carrying only the changed key
    expect(nodeRecord(doc, "n1")).toMatchObject({ x: 20, y: 0 });

    counter.stop();
    binding.destroy();
  });

  it("T3 apply — a remote node move updates the follower model via applyNodeUpsert", () => {
    const doc = new Y.Doc();
    seedDoc(doc, { n1: { id: "n1", x: 0, y: 0 } });
    const model = new FakeCanvasModel();
    const binding = new CanvasBinding(doc, model);

    const spy = vi.spyOn(model, "applyNodeUpsert");
    applyRemoteCanvasDelta(doc, (nodes) => {
      nodes.get("n1")?.set("x", 50);
    });

    expect(spy).toHaveBeenCalledWith("n1", expect.objectContaining({ x: 50 }));
    expect(model.getNode("n1")).toMatchObject({ x: 50 });

    binding.destroy();
  });

  it("T4 no-echo (sync) — synchronous re-emit during applyRemote produces zero origin updates", () => {
    const doc = new Y.Doc();
    seedDoc(doc, { n1: { id: "n1", x: 0, y: 0 } });
    const model = new FakeCanvasModel();
    const binding = new CanvasBinding(doc, model);
    const counter = countOriginUpdates(doc);

    applyRemoteCanvasDelta(doc, (nodes) => {
      nodes.get("n1")?.set("x", 99);
    });

    expect(counter.count()).toBe(0); // I2
    expect(model.getNode("n1")).toMatchObject({ x: 99 });

    counter.stop();
    binding.destroy();
  });

  it("T5 no-echo (async) — timer-fired re-emit after apply yields zero origin updates (empty diff)", () => {
    vi.useFakeTimers();
    const doc = new Y.Doc();
    seedDoc(doc, { n1: { id: "n1", x: 0, y: 0 } });
    const model = new FakeCanvasModel();
    const binding = new CanvasBinding(doc, model);

    applyRemoteCanvasDelta(doc, (nodes) => {
      nodes.get("n1")?.set("x", 42);
    });
    // applyingRemote is now false. Schedule the async echo carrying the
    // already-applied value (Obsidian's debounced requestSave hazard).
    const counter = countOriginUpdates(doc);
    setTimeout(() => {
      const cur = model.getNode("n1");
      if (cur) model.emitLocal({ kind: "node", id: "n1", record: cur });
    }, 200);
    vi.advanceTimersByTime(300);

    expect(counter.count()).toBe(0); // I3 — empty diff dropped

    counter.stop();
    binding.destroy();
  });

  it("T6 streamed drag — 50 sequential geometry deltas converge with zero re-push", () => {
    const doc = new Y.Doc();
    seedDoc(doc, { n1: { id: "n1", x: 0, y: 0, width: 100, height: 50 } });
    const model = new FakeCanvasModel();
    const binding = new CanvasBinding(doc, model);
    const counter = countOriginUpdates(doc);

    let finalX = 0;
    for (let i = 1; i <= 50; i++) {
      finalX = i * 3;
      applyRemoteCanvasDelta(doc, (nodes) => {
        nodes.get("n1")?.set("x", finalX);
      });
    }

    expect(model.getNode("n1")).toMatchObject({ x: finalX }); // follower converged
    expect(counter.count()).toBe(0); // zero re-push across the whole stream

    counter.stop();
    binding.destroy();
  });

  it("T7 concurrent different nodes — both movers' values survive a two-way merge", () => {
    const seed = { n1: { id: "n1", x: 0, y: 0 }, n2: { id: "n2", x: 0, y: 0 } };
    const docA = new Y.Doc();
    seedDoc(docA, seed);
    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    const modelA = new FakeCanvasModel();
    const bindingA = new CanvasBinding(docA, modelA);
    const modelB = new FakeCanvasModel();
    const bindingB = new CanvasBinding(docB, modelB);

    modelA.userSetNode("n1", { id: "n1", x: 10, y: 0 });
    modelB.userSetNode("n2", { id: "n2", x: 20, y: 0 });

    // Encode both BEFORE applying either — true concurrency.
    const ua = Y.encodeStateAsUpdate(docA);
    const ub = Y.encodeStateAsUpdate(docB);
    Y.applyUpdate(docB, ua);
    Y.applyUpdate(docA, ub);

    // Docs converge.
    expect(nodeRecord(docA, "n1")).toMatchObject({ x: 10 });
    expect(nodeRecord(docA, "n2")).toMatchObject({ x: 20 });
    expect(nodeRecord(docB, "n1")).toMatchObject({ x: 10 });
    expect(nodeRecord(docB, "n2")).toMatchObject({ x: 20 });
    // Models reconcile to the docs — neither mover's value reverts.
    expect(modelA.getNode("n1")).toMatchObject({ x: 10 });
    expect(modelA.getNode("n2")).toMatchObject({ x: 20 });
    expect(modelB.getNode("n1")).toMatchObject({ x: 10 });
    expect(modelB.getNode("n2")).toMatchObject({ x: 20 });

    bindingA.destroy();
    bindingB.destroy();
  });

  it("T8 same-node lock — canWriteNode=false drops B's capture; B reconciles to A", () => {
    const docA = new Y.Doc();
    seedDoc(docA, { n1: { id: "n1", x: 0, y: 0 } });
    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    const modelA = new FakeCanvasModel();
    const bindingA = new CanvasBinding(docA, modelA);
    const modelB = new FakeCanvasModel();
    const bindingB = new CanvasBinding(docB, modelB, {
      canWriteNode: (_path, id) => id !== "n1", // n1 is locked by A on B
    });

    const counterB = countOriginUpdates(docB);
    modelB.userSetNode("n1", { id: "n1", x: 77, y: 0 }); // dropped

    expect(counterB.count()).toBe(0); // no origin update for the locked node
    expect(nodeRecord(docB, "n1")).toMatchObject({ x: 0 }); // doc unchanged

    // A moves n1 and propagates → B reconciles to A's value.
    modelA.userSetNode("n1", { id: "n1", x: 55, y: 0 });
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    expect(modelB.getNode("n1")).toMatchObject({ x: 55 });

    counterB.stop();
    bindingA.destroy();
    bindingB.destroy();
  });

  it("T9 add/remove — remote add/delete reflect; local delete removes; no-resurrect", () => {
    const doc = new Y.Doc();
    seedDoc(doc, { n1: { id: "n1", x: 0, y: 0 } });
    const model = new FakeCanvasModel();
    // canWriteNode reports n1 as remotely-deleted (the lock signal, SPEC_01 §7)
    // once the flag flips — this enforces GAP-2 no-resurrect.
    let n1RemoteDeleted = false;
    const binding = new CanvasBinding(doc, model, {
      canWriteNode: (_path, id) => !(id === "n1" && n1RemoteDeleted),
    });

    // Remote add n2 → reflected in follower.
    applyRemoteCanvasDelta(doc, (nodes) => {
      nodes.set("n2", remoteNode({ id: "n2", x: 5, y: 5 }));
    });
    expect(model.getNode("n2")).toMatchObject({ x: 5, y: 5 });

    // Remote delete n1 → reflected in follower.
    applyRemoteCanvasDelta(doc, (nodes) => {
      nodes.delete("n1");
    });
    expect(model.getNode("n1")).toBeNull();
    n1RemoteDeleted = true;

    // Local delete of n2 removes it from the doc.
    model.userRemoveNode("n2");
    expect(doc.getMap<Y.Map<unknown>>("nodes").has("n2")).toBe(false);

    // No-resurrect: a local upsert for the remotely-deleted n1 does not re-add it.
    model.userSetNode("n1", { id: "n1", x: 1, y: 1 });
    expect(doc.getMap<Y.Map<unknown>>("nodes").has("n1")).toBe(false);

    binding.destroy();
  });

  it("T10 minimal diff — capturing a record identical to the doc produces zero origin updates", () => {
    const doc = new Y.Doc();
    seedDoc(doc, { n1: { id: "n1", x: 3, y: 4, width: 100, height: 50 } });
    const model = new FakeCanvasModel();
    const binding = new CanvasBinding(doc, model);
    const counter = countOriginUpdates(doc);

    // Capture the EXACT current record — no key differs.
    model.userSetNode("n1", { id: "n1", x: 3, y: 4, width: 100, height: 50 });

    expect(counter.count()).toBe(0); // I3 at the capture boundary

    counter.stop();
    binding.destroy();
  });
});
