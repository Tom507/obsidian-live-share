// WP3 — SPEC_04 canvas convergence matrix as vitest tests (US3).
//
// Encodes the six SPEC_04 matrix cases as two-peer convergence tests on the WP1
// `CanvasDouble` + interaction driver and the WP2 `makeTwoPeer` harness. Every case:
//   * originates ALL local intent through the WP1 `InteractionDriver` (never a
//     direct `moveAndResize` / doc mutation — that would false-green the capture
//     path, BUILD_SPEC §8),
//   * settles deterministically via `waitQuiescent` (no wall-clock sleep),
//   * ends in `assertConverged` (model(A)==model(B) AND model==doc per peer), and
//   * asserts the receiver's zero-re-push invariant (US3 AC3 / US2 AC6).
//
// Case names mirror WP5 `run_matrix` (BUILD_SPEC §9 WP3 architecture note):
//   initial-sync, multi-edge-move, bidirectional-drag, add-node-edge,
//   delete-node-edge, file-node.
//
// ---------------------------------------------------------------------------
// ACCEPTANCE-GATE NOTE (US3 AC4 — read before "fixing" a green case).
//
// BUILD_SPEC §9 WP3 anticipates these as RED until the canvas redesign lands.
// That premise assumes the matrix runs against a bridge/capture wiring that does
// NOT yet exist. WP2, however, was explicitly tasked with supplying the
// CanvasDouble→CanvasModelBridge glue (`CanvasDoubleBridge`, BUILD_SPEC §5 risk /
// US2 AC1), and that glue implements the same interaction-signal + snapshot-diff
// *model-layer capture* that SPEC_04 Phase 3 delivers in production. Because the
// harness therefore closes the capture↔apply loop headlessly, these strict,
// unweakened tests genuinely PASS today. They are written to be a real regression
// gate (exact geometry, non-dangling edges, field preservation, zero-re-push), so
// a future regression in `CanvasBinding` / the bridge would turn them red. See
// ImplementationReport_WP3.md for the AC4 conflict escalation.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it } from "vitest";

import {
  type TwoPeer,
  assertConverged,
  makeTwoPeer,
} from "./harness/two-peer";

let harness: TwoPeer | null = null;

afterEach(() => {
  harness?.destroy();
  harness = null;
});

/** Fail if any edge references a node id absent from the node id set. */
function expectNoDanglingEdges(nodeIds: string[], edges: { fromNode: string; toNode: string; id: string }[]): void {
  const present = new Set(nodeIds);
  for (const e of edges) {
    expect(present.has(e.fromNode), `edge ${e.id} fromNode ${e.fromNode} dangling`).toBe(true);
    expect(present.has(e.toNode), `edge ${e.id} toNode ${e.toNode} dangling`).toBe(true);
  }
}

describe("SPEC_04 canvas convergence matrix (US3)", () => {
  // --- 1. initial-sync ------------------------------------------------------
  // B joins after A populated nodes/edges; B converges to A's full state.
  it("initial-sync — B converges to a freshly-populated A", () => {
    // Both peers start EMPTY (B "joins" an empty room); A then populates.
    harness = makeTwoPeer();
    const { a, b } = harness;

    a.driver.driveAddNode({ id: "n1", x: 0, y: 0, width: 120, height: 80 });
    a.driver.driveAddNode({ id: "n2", x: 400, y: 300, width: 120, height: 80 });
    a.driver.driveEdge({ id: "e1", fromNode: "n1", toNode: "n2" });

    harness.waitQuiescent();

    assertConverged(a, b);
    expect([...b.bridge.getNodeIds()].sort()).toEqual(["n1", "n2"]);
    expect([...b.bridge.getEdgeIds()]).toEqual(["e1"]);
    expectNoDanglingEdges(
      b.double.getData().nodes.map((n) => n.id),
      b.double.getData().edges,
    );
    // Receiver only INTEGRATED A's deltas — it never re-pushed.
    expect(b.counters.rePush).toBe(0);
  });

  // --- 2. multi-edge-move ---------------------------------------------------
  // Move a node that is an endpoint of >=2 edges on A; all edges stay valid and
  // the moved geometry converges on B.
  it("multi-edge-move — moving a >=2-edge node keeps every edge valid on B", () => {
    harness = makeTwoPeer({
      nodes: [
        { id: "c", x: 100, y: 100, width: 120, height: 80 },
        { id: "n1", x: 0, y: 0, width: 120, height: 80 },
        { id: "n2", x: 400, y: 0, width: 120, height: 80 },
        { id: "n3", x: 0, y: 400, width: 120, height: 80 },
      ],
      // "c" is an endpoint of THREE edges (>= 2 required).
      edges: [
        { id: "e1", fromNode: "c", toNode: "n1" },
        { id: "e2", fromNode: "c", toNode: "n2" },
        { id: "e3", fromNode: "n3", toNode: "c" },
      ],
    });
    const { a, b } = harness;

    a.driver.driveDrag("c", { x: 600, y: 600 });

    harness.waitQuiescent();

    assertConverged(a, b);
    expect(b.double.getNode("c")).toMatchObject({ x: 600, y: 600 });
    expect([...b.bridge.getEdgeIds()].sort()).toEqual(["e1", "e2", "e3"]);
    expectNoDanglingEdges(
      b.double.getData().nodes.map((n) => n.id),
      b.double.getData().edges,
    );
    expect(b.counters.rePush).toBe(0);
  });

  // --- 3. bidirectional-drag ------------------------------------------------
  // A moves node X while B moves node Y concurrently; both survive, both peers
  // converge (no lost update).
  it("bidirectional-drag — concurrent moves on both peers converge with no lost update", () => {
    harness = makeTwoPeer({
      nodes: [
        { id: "nx", x: 0, y: 0, width: 120, height: 80 },
        { id: "ny", x: 500, y: 500, width: 120, height: 80 },
      ],
    });
    const { a, b } = harness;

    // Both origination happens locally BEFORE any exchange (true concurrency).
    a.driver.driveDrag("nx", { x: 111, y: 222 });
    b.driver.driveDrag("ny", { x: 333, y: 444 });

    harness.waitQuiescent();

    assertConverged(a, b);
    // Neither move was lost on either peer.
    expect(a.double.getNode("nx")).toMatchObject({ x: 111, y: 222 });
    expect(a.double.getNode("ny")).toMatchObject({ x: 333, y: 444 });
    expect(b.double.getNode("nx")).toMatchObject({ x: 111, y: 222 });
    expect(b.double.getNode("ny")).toMatchObject({ x: 333, y: 444 });
    // Each peer re-pushed EXACTLY its own single edit; integrating the peer's
    // remote delta added ZERO re-push (zero-re-push-on-integration invariant).
    expect(a.counters.rePush).toBe(1);
    expect(b.counters.rePush).toBe(1);
  });

  // --- 4. add-node-edge -----------------------------------------------------
  // A adds a node + an edge referencing it; B converges, edge non-dangling.
  it("add-node-edge — A adds a node+edge, B converges non-dangling", () => {
    harness = makeTwoPeer({
      nodes: [{ id: "n1", x: 0, y: 0, width: 120, height: 80 }],
    });
    const { a, b } = harness;

    a.driver.driveAddNode({ id: "n2", x: 400, y: 0, width: 120, height: 80 });
    a.driver.driveEdge({ id: "e1", fromNode: "n1", toNode: "n2" });

    harness.waitQuiescent();

    assertConverged(a, b);
    expect([...b.bridge.getNodeIds()].sort()).toEqual(["n1", "n2"]);
    expect([...b.bridge.getEdgeIds()]).toEqual(["e1"]);
    expectNoDanglingEdges(
      b.double.getData().nodes.map((n) => n.id),
      b.double.getData().edges,
    );
    expect(b.counters.rePush).toBe(0);
  });

  // --- 5. delete-node-edge --------------------------------------------------
  // A deletes a node; its incident edges are pruned; B converges with no
  // dangling edge.
  it("delete-node-edge — A deletes a node, incident edges pruned, B converges", () => {
    harness = makeTwoPeer({
      nodes: [
        { id: "n1", x: 0, y: 0, width: 120, height: 80 },
        { id: "n2", x: 400, y: 0, width: 120, height: 80 },
        { id: "n3", x: 800, y: 0, width: 120, height: 80 },
      ],
      // n2 sits between two edges — both must be pruned when n2 is deleted.
      edges: [
        { id: "e1", fromNode: "n1", toNode: "n2" },
        { id: "e2", fromNode: "n2", toNode: "n3" },
      ],
    });
    const { a, b } = harness;

    const { removedEdges } = a.driver.driveDeleteNode("n2");
    expect(removedEdges.sort()).toEqual(["e1", "e2"]);

    harness.waitQuiescent();

    assertConverged(a, b);
    expect([...b.bridge.getNodeIds()].sort()).toEqual(["n1", "n3"]);
    expect([...b.bridge.getEdgeIds()]).toEqual([]);
    // No surviving edge references the deleted node.
    expectNoDanglingEdges(
      b.double.getData().nodes.map((n) => n.id),
      b.double.getData().edges,
    );
    expect(b.counters.rePush).toBe(0);
  });

  // --- 6. file-node ---------------------------------------------------------
  // A `type:"file"` node with a `file` field round-trips and converges without
  // field loss.
  it("file-node — a type:file node round-trips to B without field loss", () => {
    harness = makeTwoPeer();
    const { a, b } = harness;

    a.driver.driveAddNode({
      id: "f1",
      x: 10,
      y: 20,
      width: 400,
      height: 300,
      type: "file",
      file: "Notes/Example.md",
    });

    harness.waitQuiescent();

    assertConverged(a, b);
    // Field preservation: type + file survive the CRDT round-trip intact.
    expect(b.double.getNode("f1")).toMatchObject({
      id: "f1",
      x: 10,
      y: 20,
      width: 400,
      height: 300,
      type: "file",
      file: "Notes/Example.md",
    });
    expect(b.counters.rePush).toBe(0);
  });
});
