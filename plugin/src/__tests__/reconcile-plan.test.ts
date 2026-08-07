import { describe, expect, it } from "vitest";

import { canvasIds, cloneCanvasRecords, planReconcile } from "../canvas/reconcile-plan";

// ===========================================================================
// WP5 / US3 — the pure reconcile classifier.
//
// At HEAD there is no module: `reconcileLiveCanvas` decides "structural" from the
// id-set difference ALONE (`main.ts:1013-1016`) and its non-structural branch
// applies x/y/width/height only (`:1048-1068`), so a remote `text` / `color` /
// `label` / `fromSide` / `toSide` change with unchanged id sets never reaches the
// open view — the view drifts and the next local save pushes the stale values
// back over the peer (US3 AC1).
//
// Everything here is a pure data test: no Obsidian, no adapter, no clock (AC2/AC3).
// ===========================================================================

type Rec = Record<string, unknown>;

const node = (id: string, extra: Rec = {}): Rec => ({
  id,
  x: 0,
  y: 0,
  width: 100,
  height: 60,
  type: "text",
  text: "a",
  ...extra,
});

const edge = (id: string, extra: Rec = {}): Rec => ({
  id,
  fromNode: "n1",
  toNode: "n2",
  fromSide: "right",
  toSide: "left",
  ...extra,
});

/** desired/lastApplied pair sharing the same id sets, plus matching live ids. */
function scenario(desired: { nodes: Rec[]; edges: Rec[] }, lastApplied: { nodes: Rec[]; edges: Rec[] }) {
  return {
    desired,
    lastApplied,
    liveNodeIds: canvasIds(desired.nodes),
    liveEdgeIds: canvasIds(desired.edges),
  };
}

describe("planReconcile (US3)", () => {
  it("AC4: a node `text`-only difference is STRUCTURAL, not geometry", () => {
    const plan = planReconcile(
      scenario(
        { nodes: [node("n1", { text: "peer edited me" })], edges: [] },
        { nodes: [node("n1", { text: "a" })], edges: [] },
      ),
    );
    expect(plan).toBe("structural");
  });

  it("AC4 (sibling fields): color / label differences are STRUCTURAL too", () => {
    expect(
      planReconcile(
        scenario(
          { nodes: [node("n1", { color: "4" })], edges: [] },
          { nodes: [node("n1")], edges: [] },
        ),
      ),
    ).toBe("structural");
    expect(
      planReconcile(
        scenario(
          { nodes: [node("n1")], edges: [edge("e1", { label: "why" })] },
          { nodes: [node("n1")], edges: [edge("e1")] },
        ),
      ),
    ).toBe("structural");
  });

  it("AC5: an edge `fromSide`-only difference is STRUCTURAL", () => {
    const plan = planReconcile(
      scenario(
        { nodes: [node("n1"), node("n2")], edges: [edge("e1", { fromSide: "top" })] },
        { nodes: [node("n1"), node("n2")], edges: [edge("e1", { fromSide: "right" })] },
      ),
    );
    expect(plan).toBe("structural");
  });

  it("AC6: an x/y/width/height-only difference stays GEOMETRY (the smooth drag path)", () => {
    const plan = planReconcile(
      scenario(
        { nodes: [node("n1", { x: 500, y: 400, width: 120, height: 80 })], edges: [] },
        { nodes: [node("n1", { x: 0, y: 0, width: 100, height: 60 })], edges: [] },
      ),
    );
    expect(plan).toBe("geometry");
  });

  it("AC6: 50 streamed drag frames all stay GEOMETRY (no setData per mouse move)", () => {
    let last = { nodes: [node("n1")], edges: [] as Rec[] };
    for (let i = 1; i <= 50; i++) {
      const next = { nodes: [node("n1", { x: i * 7, y: i * 3 })], edges: [] as Rec[] };
      expect(planReconcile(scenario(next, last))).toBe("geometry");
      last = next;
    }
  });

  it("AC7: identical data with matching id sets is NOOP (nothing to apply)", () => {
    const plan = planReconcile(
      scenario(
        { nodes: [node("n1"), node("n2")], edges: [edge("e1")] },
        { nodes: [node("n1"), node("n2")], edges: [edge("e1")] },
      ),
    );
    expect(plan).toBe("noop");
  });

  it("AC7: key ORDER and record ORDER never make a noop look like a change", () => {
    const plan = planReconcile(
      scenario(
        { nodes: [node("n2"), node("n1")], edges: [{ toNode: "n2", id: "e1", fromNode: "n1" }] },
        { nodes: [node("n1"), node("n2")], edges: [{ id: "e1", fromNode: "n1", toNode: "n2" }] },
      ),
    );
    expect(plan).toBe("noop");
  });

  it("AC1: an id-set difference against the LIVE view is STRUCTURAL even when the data matches the shadow", () => {
    // The local user added a node the shared doc does not have: desired == shadow,
    // but the live view carries an extra id → the view must be reloaded.
    const desired = { nodes: [node("n1")], edges: [] };
    expect(
      planReconcile({
        desired,
        lastApplied: desired,
        liveNodeIds: new Set(["n1", "n-local"]),
        liveEdgeIds: new Set<string>(),
      }),
    ).toBe("structural");
    expect(
      planReconcile({
        desired: { nodes: [node("n1")], edges: [edge("e1")] },
        lastApplied: { nodes: [node("n1")], edges: [edge("e1")] },
        liveNodeIds: new Set(["n1"]),
        liveEdgeIds: new Set<string>(), // edge missing from the live view
      }),
    ).toBe("structural");
  });

  it("AC1: an added / removed record is STRUCTURAL", () => {
    expect(
      planReconcile({
        desired: { nodes: [node("n1"), node("n2")], edges: [] },
        lastApplied: { nodes: [node("n1")], edges: [] },
        liveNodeIds: new Set(["n1", "n2"]),
        liveEdgeIds: new Set<string>(),
      }),
    ).toBe("structural");
    expect(
      planReconcile({
        desired: { nodes: [node("n1")], edges: [] },
        lastApplied: { nodes: [node("n1"), node("n2")], edges: [] },
        liveNodeIds: new Set(["n1"]),
        liveEdgeIds: new Set<string>(),
      }),
    ).toBe("structural");
  });

  it("AC8: `initial` forces STRUCTURAL even for an exact match", () => {
    const same = { nodes: [node("n1")], edges: [] };
    expect(planReconcile({ ...scenario(same, same), initial: true })).toBe("structural");
    expect(planReconcile({ ...scenario(same, same), initial: false })).toBe("noop");
  });

  it("no shadow yet (first pass after a mount that had nothing to seed) is STRUCTURAL", () => {
    expect(
      planReconcile({
        desired: { nodes: [node("n1")], edges: [] },
        lastApplied: null,
        liveNodeIds: new Set(["n1"]),
        liveEdgeIds: new Set<string>(),
      }),
    ).toBe("structural");
  });

  it("a node that LOST its type (or gained one) is STRUCTURAL, not geometry", () => {
    const withType = { nodes: [node("n1", { type: "text" })], edges: [] };
    const withoutType = { nodes: [{ id: "n1", x: 0, y: 0, width: 100, height: 60, text: "a" }], edges: [] };
    expect(planReconcile(scenario(withoutType, withType))).toBe("structural");
    expect(planReconcile(scenario(withType, withoutType))).toBe("structural");
  });

  it("AC3: purity — same inputs give the same output and the inputs are not mutated", () => {
    const input = scenario(
      { nodes: [node("n1", { x: 9 })], edges: [] },
      { nodes: [node("n1", { x: 1 })], edges: [] },
    );
    const before = JSON.stringify(input.desired) + JSON.stringify(input.lastApplied);
    const a = planReconcile(input);
    const b = planReconcile(input);
    const c = planReconcile(input);
    expect([a, b, c]).toEqual(["geometry", "geometry", "geometry"]);
    expect(JSON.stringify(input.desired) + JSON.stringify(input.lastApplied)).toBe(before);
    expect(input.liveNodeIds.size).toBe(1);
  });

  it("cloneCanvasRecords detaches the shadow from the records handed to setData", () => {
    const data = { nodes: [node("n1")], edges: [edge("e1")] };
    const shadow = cloneCanvasRecords(data);
    expect(shadow).toEqual(data);
    expect(shadow.nodes[0]).not.toBe(data.nodes[0]);
    // Obsidian retains the records we pass to setData; an in-place mutation of the
    // live model must NOT rewrite what we recorded as applied.
    data.nodes[0].x = 9999;
    data.nodes.push(node("n2"));
    expect(shadow.nodes).toHaveLength(1);
    expect(shadow.nodes[0].x).toBe(0);
    expect(
      planReconcile({
        desired: data,
        lastApplied: shadow,
        liveNodeIds: canvasIds(data.nodes),
        liveEdgeIds: canvasIds(data.edges),
      }),
    ).toBe("structural"); // the added node is still seen
  });

  it("records without a usable string id are ignored by canvasIds", () => {
    expect([...canvasIds([{ id: "a" }, { id: 7 }, {}, { id: "" }, { id: "b" }])]).toEqual(["a", "b"]);
  });

  it("a geometry move of a record whose id is missing from the shadow is STRUCTURAL", () => {
    // Defensive: a mangled record (no id) must never be silently treated as a
    // geometry-only move of some other record.
    expect(
      planReconcile({
        desired: { nodes: [{ x: 5, y: 5 }], edges: [] },
        lastApplied: { nodes: [node("n1")], edges: [] },
        liveNodeIds: new Set(["n1"]),
        liveEdgeIds: new Set<string>(),
      }),
    ).toBe("structural");
  });
});
