// WP5 / AC1 — the projection, attacked through PATH ISOLATION and value fidelity.
//
// Angle: several surfaces in one shadow, and the value classes `planReconcile`
// compares with `===` — `null`, `0` / `-0`, `false`, and a numeric string. If the
// projection normalised or dropped any of them, a `noop` would silently become a
// `structural` reload on every single delta (or worse, the other way round).

import { describe, expect, it } from "vitest";

import {
  advanceRecord,
  createSurfaceShadow,
  listPaths,
  shadowToCanvasRecords,
} from "../../../canvas/canvas-shadow";
import { planReconcile } from "../../../canvas/reconcile-plan";

const P1 = "a/one.canvas";
const P2 = "a/two.canvas";
const P3 = "b/one.canvas";

describe("WP5 AC1 (blind2) — projection isolation and value fidelity", () => {
  it("projects each surface independently and leaves the others alone", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, P1, "node", "x", { id: "x", x: 1, y: 1, width: 10, height: 10 });
    advanceRecord(shadow, P2, "node", "x", { id: "x", x: 2, y: 2, width: 20, height: 20 });

    expect(listPaths(shadow).sort()).toEqual([P1, P2]);
    expect(shadowToCanvasRecords(shadow, P1)?.nodes[0]?.x).toBe(1);
    expect(shadowToCanvasRecords(shadow, P2)?.nodes[0]?.x).toBe(2);
    expect(shadowToCanvasRecords(shadow, P3), "an untouched surface must be unknown").toBeNull();

    // A near-miss key must not resolve: no prefix matching, no case folding.
    expect(shadowToCanvasRecords(shadow, "a/one")).toBeNull();
    expect(shadowToCanvasRecords(shadow, "A/One.canvas")).toBeNull();
  });

  it("preserves the exact value classes the classifier compares with ===", () => {
    const record = {
      id: "v",
      type: "text",
      x: -0,
      y: 0,
      width: 100,
      height: 50,
      color: null,
      pinned: false,
      label: "12",
    };
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, P1, "node", "v", record);

    const projected = shadowToCanvasRecords(shadow, P1)?.nodes[0] as Record<string, unknown>;
    expect(projected.color).toBeNull();
    expect(projected.pinned).toBe(false);
    expect(projected.label).toBe("12");
    expect(Object.is(projected.x as number, -0) || projected.x === 0).toBe(true);

    // Same values, same verdict.
    expect(
      planReconcile({
        desired: { nodes: [{ ...record }], edges: [] },
        lastApplied: shadowToCanvasRecords(shadow, P1),
        liveNodeIds: new Set(["v"]),
        liveEdgeIds: new Set<string>(),
      }),
    ).toBe("noop");

    // A numeric string is NOT the number: that difference is real and structural.
    expect(
      planReconcile({
        desired: { nodes: [{ ...record, label: 12 }], edges: [] },
        lastApplied: shadowToCanvasRecords(shadow, P1),
        liveNodeIds: new Set(["v"]),
        liveEdgeIds: new Set<string>(),
      }),
    ).toBe("structural");
  });

  it("a field the shadow holds and the delta drops is structural, not geometry", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, P1, "node", "v", {
      id: "v",
      type: "text",
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      color: "4",
    });

    expect(
      planReconcile({
        desired: { nodes: [{ id: "v", type: "text", x: 20, y: 0, width: 100, height: 50 }], edges: [] },
        lastApplied: shadowToCanvasRecords(shadow, P1),
        liveNodeIds: new Set(["v"]),
        liveEdgeIds: new Set<string>(),
      }),
      "a vanished colour cannot reach an open view through per-node geometry",
    ).toBe("structural");
  });
});
