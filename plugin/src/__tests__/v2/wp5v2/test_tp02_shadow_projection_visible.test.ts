// WP5 / AC1 — the reconcile classifier's `lastApplied` input IS the shadow.
//
// AC1 requires ONE structure. `planReconcile` consumes a record snapshot, the
// shadow is field-granular, so the bridge between them is the load-bearing part
// of "no second, parallel shadow": `shadowToCanvasRecords(shadow, path)` must be
// a faithful, detached projection with the exact `null` semantics the classifier
// already handles ("nothing applied yet" → structural).
//
//   ├── T1 the projection of a confirmed apply classifies the same data `noop`,
//   │      a geometry-only difference `geometry`, a text difference `structural`.
//   ├── T2 an unknown path projects to `null` (→ `structural`, the safe branch),
//   │      and a path whose records are all `absent` projects to empty arrays.
//   ├── T3 `absent` records are excluded, so a record deleted from the surface
//   │      cannot make every future pass structural forever.
//   ├── T4 the projection is DETACHED — mutating it never rewrites what the
//   │      shadow claims reached the surface.
//   └── T5 the record key is the authoritative `id`, and hostile field names
//          (`__proto__`, `constructor`, `id`) stay ordinary data.
//
// Pure module test: no Obsidian, no doc, no timers.

import { describe, expect, it } from "vitest";

import {
  type ShadowFieldValue,
  advanceField,
  advanceRecord,
  createSurfaceShadow,
  getField,
  markRecordAbsent,
  shadowToCanvasRecords,
} from "../../../canvas/canvas-shadow";
import { planReconcile } from "../../../canvas/reconcile-plan";

const PATH = "notes/plan.canvas";

const A = { id: "a", type: "text", x: 10, y: 20, width: 300, height: 150, text: "one" };
const B = { id: "b", type: "file", x: 400, y: 20, width: 300, height: 150, file: "x.md" };
const E1 = { id: "e1", fromNode: "a", toNode: "b", fromSide: "right", toSide: "left" };

/** Seed a shadow from a full snapshot — what a confirmed reload receipt does. */
function seed(records: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] }) {
  const shadow = createSurfaceShadow();
  for (const node of records.nodes) {
    advanceRecord(shadow, PATH, "node", node.id as string, node as Record<string, ShadowFieldValue>);
  }
  for (const edge of records.edges) {
    advanceRecord(shadow, PATH, "edge", edge.id as string, edge as Record<string, ShadowFieldValue>);
  }
  return shadow;
}

describe("WP5 AC1 — shadowToCanvasRecords is the classifier's basis", () => {
  it("T1 projects into the three classifier verdicts", () => {
    const applied = { nodes: [{ ...A }, { ...B }], edges: [{ ...E1 }] };
    const shadow = seed(applied);
    const liveNodeIds = new Set(["a", "b"]);
    const liveEdgeIds = new Set(["e1"]);

    expect(
      planReconcile({
        desired: { nodes: [{ ...A }, { ...B }], edges: [{ ...E1 }] },
        lastApplied: shadowToCanvasRecords(shadow, PATH),
        liveNodeIds,
        liveEdgeIds,
      }),
    ).toBe("noop");

    expect(
      planReconcile({
        desired: { nodes: [{ ...A, x: 44 }, { ...B }], edges: [{ ...E1 }] },
        lastApplied: shadowToCanvasRecords(shadow, PATH),
        liveNodeIds,
        liveEdgeIds,
      }),
    ).toBe("geometry");

    expect(
      planReconcile({
        desired: { nodes: [{ ...A, text: "two" }, { ...B }], edges: [{ ...E1 }] },
        lastApplied: shadowToCanvasRecords(shadow, PATH),
        liveNodeIds,
        liveEdgeIds,
      }),
    ).toBe("structural");
  });

  it("T2 an unknown path projects to null and yields the safe branch", () => {
    const shadow = createSurfaceShadow();
    expect(shadowToCanvasRecords(shadow, PATH)).toBeNull();
    expect(shadowToCanvasRecords(shadow, "other.canvas")).toBeNull();

    expect(
      planReconcile({
        desired: { nodes: [{ ...A }], edges: [] },
        lastApplied: shadowToCanvasRecords(shadow, PATH),
        liveNodeIds: new Set(["a"]),
        liveEdgeIds: new Set<string>(),
      }),
      "an unknown surface must never be classified as noop",
    ).toBe("structural");

    // A path that exists but holds only absent records is NOT unknown.
    markRecordAbsent(shadow, PATH, "node", "ghost");
    const projected = shadowToCanvasRecords(shadow, PATH);
    expect(projected).not.toBeNull();
    expect(projected?.nodes).toEqual([]);
    expect(projected?.edges).toEqual([]);
  });

  it("T3 absent records are excluded from the projection", () => {
    const shadow = seed({ nodes: [{ ...A }, { ...B }], edges: [{ ...E1 }] });
    markRecordAbsent(shadow, PATH, "node", "b");
    markRecordAbsent(shadow, PATH, "edge", "e1");

    const projected = shadowToCanvasRecords(shadow, PATH);
    expect(projected?.nodes.map((record: Record<string, unknown>) => record.id)).toEqual(["a"]);
    expect(projected?.edges).toEqual([]);

    // …and the classifier therefore settles instead of reloading forever.
    expect(
      planReconcile({
        desired: { nodes: [{ ...A }], edges: [] },
        lastApplied: projected,
        liveNodeIds: new Set(["a"]),
        liveEdgeIds: new Set<string>(),
      }),
    ).toBe("noop");
  });

  it("T4 the projection is detached from the live shadow", () => {
    const shadow = seed({ nodes: [{ ...A }], edges: [] });
    const projected = shadowToCanvasRecords(shadow, PATH);
    (projected as { nodes: Record<string, unknown>[] }).nodes[0].x = 9999;
    (projected as { nodes: Record<string, unknown>[] }).nodes.push({ id: "injected" });

    expect(getField(shadow, PATH, "node", "a", "x")).toBe(10);
    expect(
      shadowToCanvasRecords(shadow, PATH)?.nodes.map((record: Record<string, unknown>) => record.id),
    ).toEqual(["a"]);
  });

  it("T5 the record key is the authoritative id and hostile field names survive", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "constructor", { type: "text", x: 1, y: 2 });
    advanceField(shadow, PATH, "node", "constructor", "__proto__", "not-a-prototype");
    // A field literally named `id` must never win over the record key.
    advanceField(shadow, PATH, "node", "constructor", "id", "spoofed");

    const projected = shadowToCanvasRecords(shadow, PATH);
    const record = projected?.nodes[0] as Record<string, unknown>;
    expect(record.id).toBe("constructor");
    expect(Object.prototype.hasOwnProperty.call(record, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(record, "__proto__")?.value).toBe("not-a-prototype");
    expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
  });
});
