// WP2 — Two-peer headless canvas convergence harness (US2).
//
// Wires TWO independent peers, each composed of:
//   * one WP1 `CanvasDouble` (the live "canvas model"),
//   * a `CanvasModelBridge` glue implemented over that double (this file — see
//     `CanvasDoubleBridge`), and
//   * a real `CanvasBinding` (`plugin/src/canvas/canvas-binding.ts`) bound to that
//     peer's OWN `Y.Doc`.
//
// Cross-peer propagation exchanges Yjs updates via `Y.encodeStateAsUpdate` /
// `Y.applyUpdate` exactly like `canvas-sync.test.ts::applyRemoteCanvasDelta`
// (L62-74). A delta authored on A is integrated on B as a genuine REMOTE
// transaction (`tr.local === false`, `origin !== CANVAS_BINDING_ORIGIN`), so the
// binding's observer demux (§6.3) and the zero-re-push invariant (US2 AC6) are
// actually exercised — not bypassed.
//
// INTERFACE-IMPEDANCE NOTE (BUILD_SPEC §5 risk): `CanvasBinding` consumes a
// `CanvasModelBridge`, a DIFFERENT surface from `CanvasAdapter`, and `main.ts`
// wires NEITHER of them to the binding. There is no production CanvasDouble→bridge
// wiring to reuse, so this WP supplies the glue itself (`CanvasDoubleBridge`).
//
// LOCAL ORIGINATION FIDELITY (BUILD_SPEC §8 / §3 dec.1): a local edit is NEVER
// originated by calling `moveAndResize` / a doc mutator directly (that is a
// false-green trap on the capture path). Instead the glue monkey-patches the same
// `setDragging` / `updateSelection` signals the WP1 `InteractionDriver` fires, and
// on each signal DIFFS the double against its last-synced snapshot to emit
// `onLocalChange` — so `captureLocal` runs only for genuine driver-issued intent.

import * as Y from "yjs";

import {
  type CanvasBindingOpts,
  CanvasBinding,
  type CanvasModelBridge,
  type CanvasRecord,
  type LocalChange,
  setCanvasBindingInstrument,
} from "../../canvas/canvas-binding";
import {
  CanvasDouble,
  type CanvasDoubleData,
  type DoubleEdgeRecord,
  type DoubleNodeRecord,
} from "./canvas-double";
import { InteractionDriver } from "./interaction-driver";

// ---------------------------------------------------------------------------
// Per-peer instrumentation counters (BUILD_SPEC §4 / US2 AC4).
// ---------------------------------------------------------------------------

export interface PeerCounters {
  /** `CanvasBinding.applyRemote()` invocations (CRDT → model reconciles). */
  applyRemote: number;
  /** `CanvasBinding.captureLocal()` invocations (local intent surfaced). */
  captureLocal: number;
  /** Captures that PRODUCED a Yjs update (a genuine re-push into the doc). */
  rePush: number;
  /** Updates observed carrying `CANVAS_BINDING_ORIGIN` (== produced captures). */
  originUpdates: number;
}

function zeroCounters(): PeerCounters {
  return { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 };
}

// ---------------------------------------------------------------------------
// Instrument routing.
//
// `setCanvasBindingInstrument` installs a MODULE-LEVEL (singleton) hook inside
// canvas-binding.ts, so per-peer attribution is done by routing every callback to
// whichever peer's counters are "active" for the current synchronous span. All
// binding-triggering actions in this harness are synchronous and harness-owned
// (construction seed, driver-signal capture, `waitQuiescent` update-apply), so
// `runAs(...)` wraps each and attributes the callbacks deterministically.
// ---------------------------------------------------------------------------

let activeCounters: PeerCounters | null = null;
let instrumentInstalled = false;

function ensureInstrument(): void {
  if (instrumentInstalled) return;
  instrumentInstalled = true;
  setCanvasBindingInstrument((counter) => {
    const c = activeCounters;
    if (!c) return;
    switch (counter) {
      case "applyRemote":
        c.applyRemote++;
        break;
      case "captureLocal":
        c.captureLocal++;
        break;
      case "rePush":
        c.rePush++;
        break;
      case "originUpdate":
        c.originUpdates++;
        break;
    }
  });
}

function runAs<T>(counters: PeerCounters, fn: () => T): T {
  const prev = activeCounters;
  activeCounters = counters;
  try {
    return fn();
  } finally {
    activeCounters = prev;
  }
}

// ---------------------------------------------------------------------------
// Record helpers — equality semantics MUST match `recordsEqual` in
// canvas-binding.ts (L100-107): order-independent shallow primitive equality.
// ---------------------------------------------------------------------------

type AnyFn = (...args: unknown[]) => unknown;

function recordsEqual(a: CanvasRecord, b: CanvasRecord): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const k of aKeys) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

function ymapToRecord(ymap: Y.Map<unknown>): CanvasRecord {
  const obj: CanvasRecord = {};
  for (const [k, v] of ymap) obj[k] = v;
  return obj;
}

/** Seed a doc's nodes/edges maps directly — a local (`tr.local === true`) tx. */
function seedDoc(doc: Y.Doc, nodes: DoubleNodeRecord[], edges: DoubleEdgeRecord[]): void {
  doc.transact(() => {
    const nm = doc.getMap<Y.Map<unknown>>("nodes");
    const em = doc.getMap<Y.Map<unknown>>("edges");
    for (const rec of nodes) {
      const m = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(rec)) m.set(k, v);
      nm.set(rec.id, m);
    }
    for (const rec of edges) {
      const m = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(rec)) m.set(k, v);
      em.set(rec.id, m);
    }
  });
}

// ---------------------------------------------------------------------------
// CanvasDoubleBridge — the CanvasDouble → CanvasModelBridge glue (US2 AC1).
// ---------------------------------------------------------------------------

/**
 * Implements the exact `CanvasModelBridge` surface `CanvasBinding` consumes
 * (`getNodeIds`/`getEdgeIds`/`getNode`/`getEdge`/`applyNode*`/`applyEdge*`/
 * `onLocalChange`) over a WP1 `CanvasDouble`.
 *
 * Reads project the double's live records. Remote appliers mutate the double and
 * MUST NOT surface back through `onLocalChange` (I5) — they update the synced
 * snapshot so the next signal-diff does not mistake them for local intent. Local
 * intent is captured by monkey-patching `setDragging`/`updateSelection` (the same
 * signals the interaction driver fires) and diffing the double against the synced
 * snapshot on every signal.
 */
export class CanvasDoubleBridge implements CanvasModelBridge {
  private readonly listeners = new Set<(c: LocalChange) => void>();
  // The glue's belief of what nodes/edges are already agreed with the doc, so a
  // signal-diff only emits genuinely NEW local intent (never a remote apply).
  private readonly syncedNodes = new Map<string, CanvasRecord>();
  private readonly syncedEdges = new Map<string, CanvasRecord>();
  private readonly restore: Array<() => void> = [];
  // True only across a remote applier so a stray signal cannot be misread as local.
  private applyingRemote = false;

  constructor(
    private readonly double: CanvasDouble,
    private readonly counters: PeerCounters,
  ) {
    this.patchSignals();
  }

  // ---- CanvasModelBridge reads ----------------------------------------------

  getNodeIds(): Iterable<string> {
    return [...this.double.canvas.nodes.keys()];
  }

  getEdgeIds(): Iterable<string> {
    return [...this.double.canvas.edges.keys()];
  }

  getNode(id: string): CanvasRecord | null {
    const n = this.double.getNode(id);
    return n ? (n.toRecord() as CanvasRecord) : null;
  }

  getEdge(id: string): CanvasRecord | null {
    const e = this.double.getEdge(id);
    return e ? (e.toRecord() as CanvasRecord) : null;
  }

  // ---- Remote → model (I5: must NOT emit onLocalChange) ---------------------

  applyNodeUpsert(id: string, record: CanvasRecord): void {
    this.applyingRemote = true;
    try {
      // Replace (not merge) so a key removed on the doc cannot linger and drift.
      this.double.removeNode(id);
      this.double.upsertNode({ ...(record as unknown as DoubleNodeRecord) });
      this.syncedNodes.set(id, { ...record });
    } finally {
      this.applyingRemote = false;
    }
  }

  applyNodeRemove(id: string): void {
    this.applyingRemote = true;
    try {
      this.double.removeNode(id);
      this.syncedNodes.delete(id);
    } finally {
      this.applyingRemote = false;
    }
  }

  applyEdgeUpsert(id: string, record: CanvasRecord): void {
    this.applyingRemote = true;
    try {
      this.double.removeEdge(id);
      this.double.upsertEdge({ ...(record as unknown as DoubleEdgeRecord) });
      this.syncedEdges.set(id, { ...record });
    } finally {
      this.applyingRemote = false;
    }
  }

  applyEdgeRemove(id: string): void {
    this.applyingRemote = true;
    try {
      this.double.removeEdge(id);
      this.syncedEdges.delete(id);
    } finally {
      this.applyingRemote = false;
    }
  }

  onLocalChange(cb: (change: LocalChange) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Restore the patched canvas methods and drop listeners. */
  destroy(): void {
    for (const undo of this.restore.splice(0)) {
      try {
        undo();
      } catch {
        /* ignore */
      }
    }
    this.listeners.clear();
  }

  // ---- Local-intent capture (signal-injection fidelity) ---------------------

  private patchSignals(): void {
    const canvas = this.double.canvas as unknown as Record<string, AnyFn>;
    for (const name of ["setDragging", "updateSelection"] as const) {
      const original = canvas[name];
      if (typeof original !== "function") continue;
      const wrapper: AnyFn = (...args: unknown[]) => {
        const result = original.apply(canvas, args);
        try {
          this.captureFromSignals();
        } catch {
          /* diagnostics must never break the interaction */
        }
        return result;
      };
      canvas[name] = wrapper;
      this.restore.push(() => {
        if (canvas[name] === wrapper) canvas[name] = original;
      });
    }
  }

  /**
   * Diff the live double against the synced snapshot and emit one `LocalChange`
   * per genuinely-changed node/edge. Called on every driver-issued signal.
   */
  private captureFromSignals(): void {
    if (this.applyingRemote) return; // never mistake a remote apply for local intent
    const changes: LocalChange[] = [];

    const liveNodes = this.double.canvas.nodes;
    for (const [id, node] of liveNodes) {
      const rec = node.toRecord() as CanvasRecord;
      const prev = this.syncedNodes.get(id);
      if (!prev || !recordsEqual(prev, rec)) {
        changes.push({ kind: "node", id, record: rec });
        this.syncedNodes.set(id, { ...rec });
      }
    }
    for (const id of [...this.syncedNodes.keys()]) {
      if (!liveNodes.has(id)) {
        changes.push({ kind: "node", id, record: null });
        this.syncedNodes.delete(id);
      }
    }

    const liveEdges = this.double.canvas.edges;
    for (const [id, edge] of liveEdges) {
      const rec = edge.toRecord() as CanvasRecord;
      const prev = this.syncedEdges.get(id);
      if (!prev || !recordsEqual(prev, rec)) {
        changes.push({ kind: "edge", id, record: rec });
        this.syncedEdges.set(id, { ...rec });
      }
    }
    for (const id of [...this.syncedEdges.keys()]) {
      if (!liveEdges.has(id)) {
        changes.push({ kind: "edge", id, record: null });
        this.syncedEdges.delete(id);
      }
    }

    if (changes.length === 0) return;
    // Attribute the binding's captureLocal/rePush/originUpdate to THIS peer.
    runAs(this.counters, () => {
      for (const change of changes) {
        for (const l of [...this.listeners]) l(change);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Peers + harness.
// ---------------------------------------------------------------------------

export interface Peer {
  readonly double: CanvasDouble;
  readonly bridge: CanvasDoubleBridge;
  readonly binding: CanvasBinding;
  readonly driver: InteractionDriver;
  readonly doc: Y.Doc;
  readonly counters: PeerCounters;
}

export interface TwoPeerOptions {
  /** Initial node records seeded into BOTH peers so they start converged. */
  nodes?: DoubleNodeRecord[];
  /** Initial edge records seeded into BOTH peers. */
  edges?: DoubleEdgeRecord[];
  /** Extra binding options for peer A (e.g. lock gates for the WP3 matrix). */
  aOpts?: Omit<CanvasBindingOpts, "seedModelFromDoc">;
  /** Extra binding options for peer B. */
  bOpts?: Omit<CanvasBindingOpts, "seedModelFromDoc">;
}

export interface TwoPeer {
  readonly a: Peer;
  readonly b: Peer;
  /** Deterministically exchange Yjs updates both ways until both docs converge. */
  waitQuiescent(): void;
  /** Assert model(A)==model(B) AND model==doc per peer; throws on drift. */
  assertConverged(): void;
  /** Zero both peers' counters (e.g. before measuring a single action). */
  resetCounters(): void;
  /** Destroy both bindings, unpatch both bridges. */
  destroy(): void;
}

/** Origin for harness-applied remote updates — distinct from CANVAS_BINDING_ORIGIN. */
const HARNESS_REMOTE_ORIGIN: unique symbol = Symbol("harness-remote-origin");

function resetPeerCounters(peer: Peer): void {
  peer.counters.applyRemote = 0;
  peer.counters.captureLocal = 0;
  peer.counters.rePush = 0;
  peer.counters.originUpdates = 0;
}

/**
 * Build two peers seeded to the SAME initial state (so they start converged), each
 * with its own `CanvasDouble` + `CanvasDoubleBridge` + `CanvasBinding` + driver.
 */
export function makeTwoPeer(opts: TwoPeerOptions = {}): TwoPeer {
  ensureInstrument();
  const nodes = opts.nodes ?? [];
  const edges = opts.edges ?? [];

  const buildPeer = (doc: Y.Doc, bindingOpts?: TwoPeerOptions["aOpts"]): Peer => {
    const counters = zeroCounters();
    const double = new CanvasDouble();
    const bridge = new CanvasDoubleBridge(double, counters);
    // Seed applyRemote runs on construct → attribute it to this peer.
    const binding = runAs(counters, () => new CanvasBinding(doc, bridge, { ...(bindingOpts ?? {}) }));
    const driver = new InteractionDriver(double);
    return { double, bridge, binding, driver, doc, counters };
  };

  // Peer A: seed its doc first, then build (seed applyRemote populates its double).
  const docA = new Y.Doc();
  seedDoc(docA, nodes, edges);
  const a = buildPeer(docA, opts.aOpts);

  // Peer B: replicate A's seeded doc state, then build (starts converged with A).
  const docB = new Y.Doc();
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
  const b = buildPeer(docB, opts.bOpts);

  // Counters start clean so they reflect only post-setup activity.
  resetPeerCounters(a);
  resetPeerCounters(b);

  return {
    a,
    b,
    waitQuiescent(): void {
      waitQuiescent(a, b);
    },
    assertConverged(): void {
      assertConverged(a, b);
    },
    resetCounters(): void {
      resetPeerCounters(a);
      resetPeerCounters(b);
    },
    destroy(): void {
      a.binding.destroy();
      b.binding.destroy();
      a.bridge.destroy();
      b.bridge.destroy();
      activeCounters = null;
    },
  };
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Deterministic settle (US2 AC5 — no wall-clock sleep). Exchanges the missing ops
 * both directions via `Y.encodeStateAsUpdate(doc, targetSV)` / `Y.applyUpdate(...,
 * HARNESS_REMOTE_ORIGIN)`. Each apply is a genuine REMOTE transaction on the target
 * (`tr.local === false`, `origin !== CANVAS_BINDING_ORIGIN`), so the receiver's
 * binding runs `applyRemote` and MUST NOT re-push (US2 AC6). Loops until both docs
 * hold identical state; a correct binding converges in one round.
 */
export function waitQuiescent(a: Peer, b: Peer, maxRounds = 100): void {
  for (let round = 0; round < maxRounds; round++) {
    // Snapshot both state vectors BEFORE applying either (models true concurrency).
    const svA = Y.encodeStateVector(a.doc);
    const svB = Y.encodeStateVector(b.doc);
    const missingForB = Y.encodeStateAsUpdate(a.doc, svB);
    const missingForA = Y.encodeStateAsUpdate(b.doc, svA);
    runAs(b.counters, () => Y.applyUpdate(b.doc, missingForB, HARNESS_REMOTE_ORIGIN));
    runAs(a.counters, () => Y.applyUpdate(a.doc, missingForA, HARNESS_REMOTE_ORIGIN));
    if (equalBytes(Y.encodeStateVector(a.doc), Y.encodeStateVector(b.doc))) return;
  }
}

// ---------------------------------------------------------------------------
// Convergence assertion (US2 AC3).
// ---------------------------------------------------------------------------

function toRecordMaps(data: CanvasDoubleData): {
  nodes: Map<string, CanvasRecord>;
  edges: Map<string, CanvasRecord>;
} {
  const nodes = new Map<string, CanvasRecord>();
  for (const n of data.nodes) nodes.set(n.id, n as CanvasRecord);
  const edges = new Map<string, CanvasRecord>();
  for (const e of data.edges) edges.set(e.id, e as CanvasRecord);
  return { nodes, edges };
}

function docRecordMaps(doc: Y.Doc): {
  nodes: Map<string, CanvasRecord>;
  edges: Map<string, CanvasRecord>;
} {
  const nodes = new Map<string, CanvasRecord>();
  for (const [id, ym] of doc.getMap<Y.Map<unknown>>("nodes")) nodes.set(id, ymapToRecord(ym));
  const edges = new Map<string, CanvasRecord>();
  for (const [id, ym] of doc.getMap<Y.Map<unknown>>("edges")) edges.set(id, ymapToRecord(ym));
  return { nodes, edges };
}

function compareMaps(
  m1: Map<string, CanvasRecord>,
  m2: Map<string, CanvasRecord>,
  ctx: string,
): string | null {
  const ids1 = [...m1.keys()].sort();
  const ids2 = [...m2.keys()].sort();
  if (ids1.length !== ids2.length || !ids1.every((id, i) => id === ids2[i])) {
    return `${ctx}: id set mismatch [${ids1.join(",")}] vs [${ids2.join(",")}]`;
  }
  for (const id of ids1) {
    const r1 = m1.get(id) as CanvasRecord;
    const r2 = m2.get(id) as CanvasRecord;
    if (!recordsEqual(r1, r2)) {
      return `${ctx}: record "${id}" differs ${JSON.stringify(r1)} vs ${JSON.stringify(r2)}`;
    }
  }
  return null;
}

/**
 * Returns a human-readable diff string if the peers have NOT converged, else null.
 * Convergence requires: (a) each peer's model == its own doc projection (no
 * CRDT/model drift), and (b) model(A) == model(B) (same ids + records,
 * order-independent).
 */
export function convergenceDiff(a: Peer, b: Peer): string | null {
  const aModel = toRecordMaps(a.double.getData());
  const bModel = toRecordMaps(b.double.getData());
  const aDoc = docRecordMaps(a.doc);
  const bDoc = docRecordMaps(b.doc);

  return (
    compareMaps(aModel.nodes, aDoc.nodes, "peer A model↔doc nodes") ??
    compareMaps(aModel.edges, aDoc.edges, "peer A model↔doc edges") ??
    compareMaps(bModel.nodes, bDoc.nodes, "peer B model↔doc nodes") ??
    compareMaps(bModel.edges, bDoc.edges, "peer B model↔doc edges") ??
    compareMaps(aModel.nodes, bModel.nodes, "model(A)↔model(B) nodes") ??
    compareMaps(aModel.edges, bModel.edges, "model(A)↔model(B) edges")
  );
}

/** Hard assertion form of {@link convergenceDiff} — throws on any divergence. */
export function assertConverged(a: Peer, b: Peer): void {
  const diff = convergenceDiff(a, b);
  if (diff) throw new Error(`assertConverged failed: ${diff}`);
}
