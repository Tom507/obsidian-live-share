// WP5 / AC1 — the projection that makes the shadow the classifier's `lastApplied`.
//
// Angle: record LIFECYCLE rather than a static snapshot — a record that goes
// absent and comes back, `initial` overriding the projection entirely, and a
// live-view membership difference that must win over a projection that agrees.

import { describe, expect, it } from "vitest";

import {
  advanceField,
  advanceRecord,
  createSurfaceShadow,
  getRecordState,
  markRecordAbsent,
  shadowToCanvasRecords,
} from "../../../canvas/canvas-shadow";
import { planReconcile } from "../../../canvas/reconcile-plan";

const PATH = "life/cycle.canvas";

const CARD = { id: "k", type: "text", x: 5, y: 5, width: 90, height: 45, text: "v1", color: "2" };
const LINK = { id: "l", fromNode: "k", toNode: "k", fromSide: "top", toSide: "bottom" };

describe("WP5 AC1 (blind1) — projection across a record's lifecycle", () => {
  it("a resurrected record projects only its NEW fields", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "k", CARD);
    expect(shadowToCanvasRecords(shadow, PATH)?.nodes[0]?.color).toBe("2");

    markRecordAbsent(shadow, PATH, "node", "k");
    expect(shadowToCanvasRecords(shadow, PATH)?.nodes).toEqual([]);

    // It comes back — but as a different incarnation: the old fields are stale
    // knowledge and must not reappear in the classifier's basis.
    advanceField(shadow, PATH, "node", "k", "x", 500);
    const revived = shadowToCanvasRecords(shadow, PATH)?.nodes[0] as Record<string, unknown>;
    expect(getRecordState(shadow, PATH, "node", "k")).toBe("present");
    expect(revived.id).toBe("k");
    expect(revived.x).toBe(500);
    expect("color" in revived).toBe(false);
    expect("text" in revived).toBe(false);
  });

  it("`initial` beats any projection, however well it matches", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "k", CARD);
    advanceRecord(shadow, PATH, "edge", "l", LINK);

    const desired = { nodes: [{ ...CARD }], edges: [{ ...LINK }] };
    const input = {
      desired,
      lastApplied: shadowToCanvasRecords(shadow, PATH),
      liveNodeIds: new Set(["k"]),
      liveEdgeIds: new Set(["l"]),
    };

    expect(planReconcile(input)).toBe("noop");
    expect(planReconcile({ ...input, initial: true })).toBe("structural");
  });

  it("a live-view membership difference wins over an agreeing projection", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "k", CARD);

    // The projection and the desired data agree, but the open view has an extra
    // card the shared doc does not know about.
    expect(
      planReconcile({
        desired: { nodes: [{ ...CARD }], edges: [] },
        lastApplied: shadowToCanvasRecords(shadow, PATH),
        liveNodeIds: new Set(["k", "stray"]),
        liveEdgeIds: new Set<string>(),
      }),
    ).toBe("structural");
  });

  it("the two id spaces project independently", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "same-id", { id: "same-id", x: 1, y: 1 });
    advanceRecord(shadow, PATH, "edge", "same-id", { id: "same-id", fromNode: "a", toNode: "b" });

    const projected = shadowToCanvasRecords(shadow, PATH);
    expect(projected?.nodes).toHaveLength(1);
    expect(projected?.edges).toHaveLength(1);
    expect(projected?.nodes[0]?.x).toBe(1);
    expect(projected?.edges[0]?.fromNode).toBe("a");

    markRecordAbsent(shadow, PATH, "node", "same-id");
    const after = shadowToCanvasRecords(shadow, PATH);
    expect(after?.nodes).toEqual([]);
    expect(after?.edges).toHaveLength(1);
  });
});
