import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { createCanvasAdapter } from "../canvas/canvas-adapter";
import { CanvasBinding, type LocalChange } from "../canvas/canvas-binding";
import { createCanvasModelBridge } from "../canvas/canvas-model-bridge";
import { CanvasDouble, type DoubleNodeRecord } from "./harness/canvas-double";
import { type TwoPeer, makeTwoPeer } from "./harness/two-peer";

// Phase 2 (SPEC_04 §3) — the follower-apply path behind `useCanvasBinding`.
//
// Two proofs:
//   1. COMPOSITION (two-peer harness): a remote delta / streamed drag drives the
//      follower's model via the binding's apply path and re-pushes ZERO updates
//      (the echo is killed by SPEC_01 I2 + I4). This is the decisive "guest drags
//      → host stable" scenario, headless.
//   2. FLAG-ROUTING (partial bridge over a CanvasDouble): `applyRemote` drives the
//      adapter's EXISTING apply members (`reloadCanvasData` for structural,
//      `applyNodeGeometry` for geometry) and NEVER emits `onLocalChange` — capture
//      stays inert this phase.

const N1 = { id: "n1", x: 0, y: 0, width: 100, height: 60 };
const N2 = { id: "n2", x: 500, y: 500, width: 100, height: 60 };

let harness: TwoPeer | null = null;

afterEach(() => {
  harness?.destroy();
  harness = null;
});

describe("Phase 2 apply path — composition (two-peer, echo killed)", () => {
  it("a remote node move converges on the follower with ZERO re-push", () => {
    harness = makeTwoPeer({ nodes: [N1] });
    const { a, b } = harness;

    // A originates a real local move (fires the driver's setDragging signal).
    a.driver.driveDrag("n1", { x: 320, y: 180 });
    harness.waitQuiescent();

    harness.assertConverged();
    expect(b.double.getNode("n1")).toMatchObject({ x: 320, y: 180 });
    // B only INTEGRATED A's delta via applyRemote — it never captured/re-pushed.
    expect(b.counters.applyRemote).toBeGreaterThanOrEqual(1);
    expect(b.counters.captureLocal).toBe(0);
    expect(b.counters.rePush).toBe(0);
    expect(b.counters.originUpdates).toBe(0);
  });

  it("a 50-step streamed drag (SPEC_01 T6) converges with follower re-push == 0", () => {
    harness = makeTwoPeer({ nodes: [N1] });
    const { a, b } = harness;

    let finalX = 0;
    for (let i = 1; i <= 50; i++) {
      finalX = i * 3;
      a.driver.driveDrag("n1", { x: finalX, y: 0 });
    }
    harness.waitQuiescent();

    harness.assertConverged();
    expect(b.double.getNode("n1")).toMatchObject({ x: finalX });
    expect(b.counters.rePush).toBe(0); // no scatter: the follower never fights back
    expect(b.counters.originUpdates).toBe(0);
  });
});

describe("Phase 2 apply path — partial model bridge (flag routing)", () => {
  const seedDocWithNode = (rec: DoubleNodeRecord): Y.Doc => {
    const doc = new Y.Doc();
    doc.transact(() => {
      const nm = doc.getMap<Y.Map<unknown>>("nodes");
      const m = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(rec)) m.set(k, v);
      nm.set(rec.id, m);
    });
    return doc;
  };

  /** Apply a mutation to `doc` as a genuine REMOTE transaction (tr.local === false). */
  const applyRemoteMutation = (doc: Y.Doc, mutate: (peer: Y.Doc) => void): void => {
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    mutate(peer);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));
  };

  it("seed + structural add drive reloadCanvasData; geometry move drives applyNodeGeometry; onLocalChange never fires", () => {
    const node: DoubleNodeRecord = {
      id: "n1",
      type: "text",
      x: 0,
      y: 0,
      width: 100,
      height: 60,
      text: "hello",
    };
    const double = new CanvasDouble(); // starts empty
    const adapter = createCanvasAdapter(double.view);
    const reloadSpy = vi.spyOn(adapter, "reloadCanvasData");
    const geoSpy = vi.spyOn(adapter, "applyNodeGeometry");

    const bridge = createCanvasModelBridge(adapter);
    const local: LocalChange[] = [];
    bridge.onLocalChange((c) => local.push(c)); // capture must stay inert

    const doc = seedDocWithNode(node);
    // Construct → seeds the model from the doc (SPEC_01 §6.4). Structural add.
    const binding = new CanvasBinding(doc, bridge, { path: "board.canvas" });

    // Seed drove a structural reload; the live double now holds the node.
    expect(reloadSpy).toHaveBeenCalled();
    expect(double.getNode("n1")).toMatchObject({ x: 0, y: 0, text: "hello" });
    expect(local).toHaveLength(0);

    // A geometry-only remote delta → smooth per-node move (no setData churn).
    reloadSpy.mockClear();
    geoSpy.mockClear();
    applyRemoteMutation(doc, (peer) => {
      peer.getMap<Y.Map<unknown>>("nodes").get("n1")?.set("x", 999);
    });

    expect(geoSpy).toHaveBeenCalledWith("n1", { x: 999, y: 0, width: 100, height: 60 });
    expect(reloadSpy).not.toHaveBeenCalled(); // pure geometry did NOT reload
    expect(double.getNode("n1")).toMatchObject({ x: 999 });

    // A structural remote add of a second node → reloadCanvasData again.
    reloadSpy.mockClear();
    applyRemoteMutation(doc, (peer) => {
      const m = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(N2)) m.set(k, v);
      peer.getMap<Y.Map<unknown>>("nodes").set("n2", m);
    });
    expect(reloadSpy).toHaveBeenCalled();
    expect([...double.getData().nodes.map((n) => n.id)].sort()).toEqual(["n1", "n2"]);

    // Across the entire apply sequence, capture NEVER fired (Phase 2 invariant).
    expect(local).toHaveLength(0);

    binding.destroy();
  });

  it("a remote node removal drives a structural reload and drops the node from the view", () => {
    const double = new CanvasDouble();
    const adapter = createCanvasAdapter(double.view);
    const bridge = createCanvasModelBridge(adapter);
    const local: LocalChange[] = [];
    bridge.onLocalChange((c) => local.push(c));

    const doc = seedDocWithNode({ ...N1 });
    // Add a second node so removal is a real structural delta, not a full wipe.
    applyRemoteMutation(doc, (peer) => {
      const m = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(N2)) m.set(k, v);
      peer.getMap<Y.Map<unknown>>("nodes").set("n2", m);
    });
    const binding = new CanvasBinding(doc, bridge, { path: "board.canvas" });
    expect([...double.getData().nodes.map((n) => n.id)].sort()).toEqual(["n1", "n2"]);

    const reloadSpy = vi.spyOn(adapter, "reloadCanvasData");
    applyRemoteMutation(doc, (peer) => {
      peer.getMap<Y.Map<unknown>>("nodes").delete("n2");
    });

    expect(reloadSpy).toHaveBeenCalled();
    expect(double.getNode("n2")).toBeUndefined();
    expect(double.getNode("n1")).toBeDefined();
    expect(local).toHaveLength(0);

    binding.destroy();
  });
});
