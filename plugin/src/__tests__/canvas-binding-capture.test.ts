import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";

import { type CanvasAdapter, createCanvasAdapter } from "../canvas/canvas-adapter";
import { CANVAS_BINDING_ORIGIN, CanvasBinding, type LocalChange } from "../canvas/canvas-binding";
import {
  type CanvasModelBridgeHandle,
  createCanvasModelBridge,
} from "../canvas/canvas-model-bridge";
import {
  CanvasDouble,
  type DoubleEdgeRecord,
  type DoubleNodeRecord,
} from "./harness/canvas-double";
import { InteractionDriver } from "./harness/interaction-driver";

// Phase 3 (SPEC_04 §4) — model-layer CAPTURE over the REAL production bridge.
//
// Unlike canvas-binding-apply.test.ts (which uses the harness's own
// `CanvasDoubleBridge` glue), these tests wire `createCanvasModelBridge` (the
// production bridge, SPEC_02) over a real `CanvasAdapter` built from a
// `CanvasDouble`, and drive REAL interaction signals with the WP1
// `InteractionDriver`. This exercises the ACTUAL capture path the plugin ships:
// interaction-signal + snapshot-diff, suppressed during apply — NEVER the
// programmatic apply path (`moveAndResize`), which is the whole point (§4).

const N1: DoubleNodeRecord = { id: "n1", type: "text", x: 0, y: 0, width: 100, height: 60 };
const N2: DoubleNodeRecord = { id: "n2", type: "text", x: 500, y: 500, width: 100, height: 60 };

// ---------------------------------------------------------------------------
// Production-bridge two-peer harness (built here — the shipped two-peer.ts uses a
// DIFFERENT bridge and must not be modified). Each peer = CanvasDouble + adapter +
// createCanvasModelBridge + CanvasBinding, wired to its own Y.Doc. Cross-peer
// propagation exchanges Yjs updates as genuine REMOTE transactions.
// ---------------------------------------------------------------------------

interface ProdPeer {
  double: CanvasDouble;
  adapter: CanvasAdapter;
  bridge: CanvasModelBridgeHandle;
  binding: CanvasBinding;
  driver: InteractionDriver;
  doc: Y.Doc;
  /** Binding-origin updates authored on THIS doc == captures that produced a write. */
  originUpdates: number;
}

const peers: ProdPeer[] = [];

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

function buildPeer(doc: Y.Doc): ProdPeer {
  const double = new CanvasDouble();
  const adapter = createCanvasAdapter(double.view);
  let binding: CanvasBinding | null = null;
  // isApplying back-references the binding so capture is suppressed for our own
  // applies (I2). binding is null only across its own constructor seed, when no
  // interaction signal fires.
  const bridge = createCanvasModelBridge(adapter, {
    isApplying: () => binding?.applyingRemote ?? false,
  });
  binding = new CanvasBinding(doc, bridge, {});
  const driver = new InteractionDriver(double);
  const peer: ProdPeer = { double, adapter, bridge, binding, driver, doc, originUpdates: 0 };
  // Attach AFTER the seed so the counter reflects only post-setup capture writes.
  doc.on("update", (_update: Uint8Array, origin: unknown) => {
    if (origin === CANVAS_BINDING_ORIGIN) peer.originUpdates++;
  });
  peers.push(peer);
  return peer;
}

function makeTwoPeer(opts: { nodes?: DoubleNodeRecord[]; edges?: DoubleEdgeRecord[] } = {}): {
  a: ProdPeer;
  b: ProdPeer;
} {
  const nodes = opts.nodes ?? [];
  const edges = opts.edges ?? [];
  const docA = new Y.Doc();
  seedDoc(docA, nodes, edges);
  const a = buildPeer(docA);
  const docB = new Y.Doc();
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
  const b = buildPeer(docB);
  return { a, b };
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Deterministically exchange Yjs updates both ways until both docs converge. */
function exchange(a: ProdPeer, b: ProdPeer, maxRounds = 50): void {
  for (let round = 0; round < maxRounds; round++) {
    const svA = Y.encodeStateVector(a.doc);
    const svB = Y.encodeStateVector(b.doc);
    const forB = Y.encodeStateAsUpdate(a.doc, svB);
    const forA = Y.encodeStateAsUpdate(b.doc, svA);
    Y.applyUpdate(b.doc, forB, "remote");
    Y.applyUpdate(a.doc, forA, "remote");
    if (equalBytes(Y.encodeStateVector(a.doc), Y.encodeStateVector(b.doc))) return;
  }
}

/** The node record as stored in a peer's Y.Doc (source of truth). */
function docNode(peer: ProdPeer, id: string): Record<string, unknown> | null {
  const ym = peer.doc.getMap<Y.Map<unknown>>("nodes").get(id);
  if (!ym) return null;
  const obj: Record<string, unknown> = {};
  for (const [k, v] of ym) obj[k] = v;
  return obj;
}

afterEach(() => {
  for (const p of peers.splice(0)) {
    try {
      p.binding.destroy();
    } catch {
      /* ignore */
    }
    try {
      p.bridge.destroy();
    } catch {
      /* ignore */
    }
  }
});

describe("Phase 3 capture — real interaction signals drive model→CRDT", () => {
  it("a real drag emits a MINIMAL diff into the Y.Doc; follower converges with zero re-push", () => {
    const { a, b } = makeTwoPeer({ nodes: [N1] });

    a.driver.driveDrag("n1", { x: 320, y: 180 });

    // Exactly one capture write, carrying only the changed geometry keys (I3).
    expect(a.originUpdates).toBe(1);
    expect(docNode(a, "n1")).toEqual({
      id: "n1",
      type: "text",
      x: 320,
      y: 180,
      width: 100,
      height: 60,
    });

    exchange(a, b);

    expect(b.double.getNode("n1")).toMatchObject({ x: 320, y: 180, type: "text" });
    // The follower only INTEGRATED A's delta via applyRemote — it never re-pushed.
    expect(b.originUpdates).toBe(0);
  });

  it("CRITICAL NEGATIVE: a programmatic geometry mutation WITHOUT a signal produces ZERO Y.Doc writes", () => {
    const { a } = makeTwoPeer({ nodes: [N1] });

    // The apply-path shape: mutate live geometry directly, NO interaction signal.
    // If capture were (wrongly) sourced from moveAndResize, this would write.
    a.double.getNode("n1")?.moveAndResize({ x: 999, y: 999, width: 100, height: 60 });

    expect(a.originUpdates).toBe(0); // capture is signal-driven, not apply-driven
    expect(docNode(a, "n1")).toMatchObject({ x: 0, y: 0 }); // doc untouched
  });

  it("suppresses capture while isApplying() is true (no echo — I2/I5)", () => {
    const double = new CanvasDouble({ nodes: [N1] });
    const adapter = createCanvasAdapter(double.view);
    let applying = false;
    const bridge = createCanvasModelBridge(adapter, { isApplying: () => applying });
    // Seed the bridge shadow so a subsequent move is a diff (not a membership add).
    bridge.applyNodeUpsert("n1", { ...N1 });
    const captured: LocalChange[] = [];
    bridge.onLocalChange((c) => captured.push(c));
    const driver = new InteractionDriver(double);

    // WHILE applying, a real drag bracket fires interaction START and END signals
    // (proving the signals reach the bridge) but capture must emit NOTHING (I2).
    applying = true;
    driver.driveDrag("n1", { x: 500, y: 500 });
    expect(captured).toHaveLength(0);
    // That move was really OUR apply, so the apply path advances the shadow (I5) —
    // this is what makes the post-apply diff empty (no async echo either).
    bridge.applyNodeUpsert("n1", { ...N1, x: 500, y: 500 });
    applying = false;

    // A genuine user drag AFTER apply captures normally (proves the guard is scoped).
    driver.driveDrag("n1", { x: 250, y: 250 });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({ kind: "node", id: "n1", record: { x: 250, y: 250 } });

    bridge.destroy();
  });

  it("minimal-diff no-op (I3): an interaction that changes nothing emits no CRDT write", () => {
    const { a } = makeTwoPeer({ nodes: [N1] });

    // A real drag bracket that lands on the SAME coordinates.
    a.driver.driveDrag("n1", { x: 0, y: 0 });
    // A bare selection signal with no geometry change.
    a.driver.select(["n1"]);

    expect(a.originUpdates).toBe(0);
  });

  it("bidirectional: both peers drive different nodes → converge, no oscillation, zero cross-echo", () => {
    const { a, b } = makeTwoPeer({ nodes: [N1, N2] });

    a.driver.driveDrag("n1", { x: 111, y: 222 });
    b.driver.driveDrag("n2", { x: 333, y: 444 });
    exchange(a, b);

    for (const p of [a, b]) {
      expect(p.double.getNode("n1")).toMatchObject({ x: 111, y: 222 });
      expect(p.double.getNode("n2")).toMatchObject({ x: 333, y: 444 });
    }
    // Each peer captured exactly its OWN one move; neither re-pushed the other's.
    expect(a.originUpdates).toBe(1);
    expect(b.originUpdates).toBe(1);
  });

  it("captures a local node DELETE via snapshot-diff → follower removes it", () => {
    const { a, b } = makeTwoPeer({ nodes: [N1, N2] });

    a.driver.select(["n1"]); // hold it (real selection), as a user does before delete
    a.driver.driveDeleteNode("n1"); // remove + collapse selection → interaction-end

    expect(a.originUpdates).toBe(1);
    exchange(a, b);

    expect(a.double.getNode("n1")).toBeUndefined();
    expect(b.double.getNode("n1")).toBeUndefined();
    expect(b.double.getNode("n2")).toBeDefined();
    expect(b.originUpdates).toBe(0);
  });

  it("captures a local node ADD (geometry membership) → follower gains the node", () => {
    const { a, b } = makeTwoPeer({ nodes: [N1] });

    // Geometry-only node: capture reconstructs a full record from adapter reads,
    // so this converges. (Content-bearing adds are spike-gated — see CAPTURE_TRIGGERS.)
    a.driver.driveAddNode({ id: "n3", x: 700, y: 700, width: 80, height: 40 });

    expect(a.originUpdates).toBe(1);
    exchange(a, b);

    expect(b.double.getNode("n3")).toMatchObject({ x: 700, y: 700, width: 80, height: 40 });
    expect(b.originUpdates).toBe(0);
  });

  it("composes with presence: a second interaction subscriber on the SAME hooks still fires", () => {
    const double = new CanvasDouble({ nodes: [N1] });
    const adapter = createCanvasAdapter(double.view);
    const bridge = createCanvasModelBridge(adapter, {});
    // Presence's lock layer subscribes to the very same adapter hooks (~canvas-
    // presence.ts:320). Capture must ADD a listener, never clobber this one.
    const starts: string[] = [];
    const ends: string[] = [];
    adapter.onNodeInteractionStart((id) => starts.push(id));
    adapter.onNodeInteractionEnd((id) => ends.push(id));
    const driver = new InteractionDriver(double);

    driver.driveDrag("n1", { x: 10, y: 20 });

    expect(starts).toContain("n1"); // presence-style subscriber still notified
    expect(ends).toContain("n1");

    bridge.destroy();
  });
});
