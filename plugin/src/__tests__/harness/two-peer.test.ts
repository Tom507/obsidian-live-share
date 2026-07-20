import { afterEach, describe, expect, it } from "vitest";

import {
  type Peer,
  type TwoPeer,
  assertConverged,
  convergenceDiff,
  makeTwoPeer,
} from "./two-peer";

// WP2 self-test (US2). Proves the two-peer harness with the CanvasDouble →
// CanvasModelBridge glue over two Y.Docs. Local intent is ALWAYS originated via
// the WP1 interaction driver (real signal path) — never by calling moveAndResize
// or a doc mutator directly (BUILD_SPEC §8 false-green trap).

const N1 = { id: "n1", x: 0, y: 0, width: 100, height: 60 };
const N2 = { id: "n2", x: 500, y: 500, width: 100, height: 60 };

let harness: TwoPeer | null = null;

afterEach(() => {
  harness?.destroy();
  harness = null;
});

describe("CanvasDoubleBridge — CanvasModelBridge contract (US2 AC1)", () => {
  it("implements all 9 members; getNode/getEdge return fresh copies or null", () => {
    harness = makeTwoPeer({
      nodes: [N1],
      edges: [{ id: "e1", fromNode: "n1", toNode: "n1" }],
    });
    const bridge = harness.a.bridge;

    expect([...bridge.getNodeIds()]).toEqual(["n1"]);
    expect([...bridge.getEdgeIds()]).toEqual(["e1"]);

    const a = bridge.getNode("n1");
    const b = bridge.getNode("n1");
    expect(a).toMatchObject({ id: "n1", x: 0 });
    expect(a).not.toBe(b); // distinct copies, never a live reference
    expect(bridge.getNode("missing")).toBeNull();
    expect(bridge.getEdge("missing")).toBeNull();

    expect(typeof bridge.applyNodeUpsert).toBe("function");
    expect(typeof bridge.applyNodeRemove).toBe("function");
    expect(typeof bridge.applyEdgeUpsert).toBe("function");
    expect(typeof bridge.applyEdgeRemove).toBe("function");
    expect(typeof bridge.onLocalChange).toBe("function");
  });

  it("both peers start converged from the seeded initial state", () => {
    harness = makeTwoPeer({
      nodes: [N1, N2],
      edges: [{ id: "e1", fromNode: "n1", toNode: "n2" }],
    });
    expect(convergenceDiff(harness.a, harness.b)).toBeNull();
  });
});

describe("two-peer convergence (US2 AC2/AC3/AC5/AC6 + DoD)", () => {
  it("a single driver node move on A converges to B with B re-push == 0", () => {
    harness = makeTwoPeer({ nodes: [N1] });
    const { a, b } = harness;

    // Local origination via the WP1 driver (fires the real setDragging signal).
    a.driver.driveDrag("n1", { x: 300, y: 200 });

    harness.waitQuiescent();

    // Convergence: model(A)==model(B) AND model==doc per peer.
    assertConverged(a, b);
    expect(b.double.getNode("n1")).toMatchObject({ x: 300, y: 200 });

    // Zero-re-push invariant (US2 AC6): B only INTEGRATED A's delta.
    expect(b.counters.rePush).toBe(0);
    expect(b.counters.originUpdates).toBe(0);
    // A authored exactly one re-push; B integrated it via applyRemote.
    expect(a.counters.captureLocal).toBeGreaterThanOrEqual(1);
    expect(a.counters.rePush).toBe(1);
    expect(b.counters.applyRemote).toBeGreaterThanOrEqual(1);
    expect(b.counters.captureLocal).toBe(0);
  });

  it("integrates A's delta on B as a genuine REMOTE (non-local) transaction (US2 AC2)", () => {
    harness = makeTwoPeer({ nodes: [N1] });
    const { a, b } = harness;

    const localFlags: boolean[] = [];
    b.doc.on("afterTransaction", (tr) => localFlags.push(tr.local));

    a.driver.driveDrag("n1", { x: 42, y: 7 });
    harness.waitQuiescent();

    // B ran ≥1 transaction and EVERY one was non-local (tr.local === false):
    // B never authored a local capture for the integrated remote delta.
    expect(localFlags.length).toBeGreaterThan(0);
    expect(localFlags.every((l) => l === false)).toBe(true);
  });

  it("assertConverged throws before waitQuiescent (real assertion, not a no-op)", () => {
    harness = makeTwoPeer({ nodes: [N1] });
    const { a, b } = harness;

    a.driver.driveDrag("n1", { x: 999, y: 0 });
    // A changed; B has not yet integrated → they must NOT be converged.
    expect(() => assertConverged(a, b)).toThrow(/assertConverged failed/);

    harness.waitQuiescent();
    expect(() => assertConverged(a, b)).not.toThrow();
  });

  it("a 20-step streamed drag on A converges with B re-push staying 0", () => {
    harness = makeTwoPeer({ nodes: [N1] });
    const { a, b } = harness;

    let finalX = 0;
    for (let i = 1; i <= 20; i++) {
      finalX = i * 5;
      a.driver.driveDrag("n1", { x: finalX, y: 0 });
    }
    harness.waitQuiescent();

    assertConverged(a, b);
    expect(b.double.getNode("n1")).toMatchObject({ x: finalX });
    expect(b.counters.rePush).toBe(0); // zero re-push across the whole stream
  });

  it("add node + edge on A converges to B (non-dangling)", () => {
    harness = makeTwoPeer({ nodes: [N1] });
    const { a, b } = harness;

    a.driver.driveAddNode(N2);
    a.driver.driveEdge({ id: "e1", fromNode: "n1", toNode: "n2" });
    harness.waitQuiescent();

    assertConverged(a, b);
    expect([...b.bridge.getNodeIds()].sort()).toEqual(["n1", "n2"]);
    expect([...b.bridge.getEdgeIds()]).toEqual(["e1"]);
    expect(b.counters.rePush).toBe(0);
  });

  it("delete node on A prunes its incident edge and converges on B", () => {
    harness = makeTwoPeer({
      nodes: [N1, N2],
      edges: [{ id: "e1", fromNode: "n1", toNode: "n2" }],
    });
    const { a, b } = harness;

    const { removedEdges } = a.driver.driveDeleteNode("n2");
    expect(removedEdges).toEqual(["e1"]);
    harness.waitQuiescent();

    assertConverged(a, b);
    expect([...b.bridge.getNodeIds()]).toEqual(["n1"]);
    expect([...b.bridge.getEdgeIds()]).toEqual([]);
    expect(b.counters.rePush).toBe(0);
  });

  it("bidirectional concurrent moves survive on both peers (no lost update)", () => {
    harness = makeTwoPeer({ nodes: [N1, N2] });
    const { a, b } = harness;

    // A moves n1, B moves n2 — both originated locally, before any exchange.
    a.driver.driveDrag("n1", { x: 111, y: 0 });
    b.driver.driveDrag("n2", { x: 222, y: 0 });
    harness.waitQuiescent();

    assertConverged(a, b);
    expect(a.double.getNode("n1")).toMatchObject({ x: 111 });
    expect(a.double.getNode("n2")).toMatchObject({ x: 222 });
    // Each peer only re-pushed its OWN edit; integrating the peer's delta did not.
    expect(a.counters.rePush).toBe(1);
    expect(b.counters.rePush).toBe(1);
  });
});

describe("counters readable after waitQuiescent (US2 AC4)", () => {
  it("resetCounters zeros both peers", () => {
    harness = makeTwoPeer({ nodes: [N1] });
    harness.a.driver.driveDrag("n1", { x: 5, y: 5 });
    harness.waitQuiescent();
    harness.resetCounters();

    const counters: (keyof Peer["counters"])[] = [
      "applyRemote",
      "captureLocal",
      "rePush",
      "originUpdates",
    ];
    for (const k of counters) {
      expect(harness.a.counters[k]).toBe(0);
      expect(harness.b.counters[k]).toBe(0);
    }
  });
});
