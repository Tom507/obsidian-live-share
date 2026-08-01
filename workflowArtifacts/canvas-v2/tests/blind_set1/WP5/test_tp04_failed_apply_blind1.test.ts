// WP5 / AC3 — a failed or partial apply advances no field of the affected record.
//
// Angle: failure modes the visible case does not use — a `setData` that THROWS
// (the adapter swallows it and reports false), an outcome that is simply absent
// from the map, and a `null` field value that must be advanced as a real value
// when the record IS confirmed. Plus path isolation of the absent-marking.

import { describe, expect, it } from "vitest";

import { createCanvasAdapter } from "../../../canvas/canvas-adapter";
import {
  type ApplyOutcome,
  type SurfaceShadow,
  advanceFromReceipt,
  advanceRecord,
  buildApplyReceipt,
  createSurfaceShadow,
  getField,
  getRecordFields,
  getRecordState,
  listPaths,
} from "../../../canvas/canvas-shadow";
import { CanvasDouble } from "../../harness/canvas-double";

const PATH = "fail/modes.canvas";
const NEIGHBOUR = "fail/other.canvas";

const LIVE = [
  { id: "u", type: "text", x: 0, y: 0, width: 80, height: 40, text: "u0", color: null },
  { id: "v", type: "text", x: 100, y: 0, width: 80, height: 40, text: "v0", color: "3" },
];

const DESIRED = {
  nodes: [
    { id: "u", type: "text", x: 50, y: 50, width: 80, height: 40, text: "u1", color: "9" },
    { id: "v", type: "text", x: 150, y: 50, width: 80, height: 40, text: "v1", color: null },
  ],
  edges: [] as Record<string, unknown>[],
};

function dump(shadow: SurfaceShadow): string {
  const byKey = (a: [string, unknown], b: [string, unknown]) => (a[0] < b[0] ? -1 : 1);
  const out: unknown[] = [];
  for (const path of listPaths(shadow).sort()) {
    const pathState = shadow.paths.get(path);
    if (!pathState) continue;
    for (const kind of ["node", "edge"] as const) {
      for (const [id, record] of [...pathState[kind]].sort(byKey)) {
        out.push([path, kind, id, record.state, [...record.fields].sort(byKey)]);
      }
    }
  }
  return JSON.stringify(out);
}

function seeded(): SurfaceShadow {
  const shadow = createSurfaceShadow();
  for (const record of LIVE) advanceRecord(shadow, PATH, "node", record.id, record);
  advanceRecord(shadow, NEIGHBOUR, "node", "u", { id: "u", x: 7, y: 7 });
  return shadow;
}

describe("WP5 AC3 (blind1) — failure modes the happy path never sees", () => {
  it("a setData that throws advances nothing", () => {
    const double = new CanvasDouble({ nodes: LIVE.map((record) => ({ ...record })) });
    (double.canvas as unknown as Record<string, unknown>).setData = () => {
      throw new Error("private API drift");
    };
    const adapter = createCanvasAdapter(double.view);
    const shadow = seeded();
    const before = dump(shadow);

    const reloaded = adapter.reloadCanvasData({ nodes: DESIRED.nodes, edges: DESIRED.edges });
    expect(reloaded, "fixture: the reload must have failed").toBe(false);

    const summary = advanceFromReceipt(
      shadow,
      buildApplyReceipt({ path: PATH, desired: DESIRED, plan: "structural", reloaded }),
    );

    expect(dump(shadow)).toBe(before);
    expect(summary.advanced).toEqual([]);
    expect(summary.handed.node.size).toBe(0);
  });

  it("an outcome absent from the map is not a confirmation", () => {
    const shadow = seeded();
    advanceFromReceipt(
      shadow,
      buildApplyReceipt({
        path: PATH,
        desired: DESIRED,
        plan: "geometry",
        // `u` was never even attempted this pass.
        nodeOutcomes: new Map<string, ApplyOutcome>([["v", "applied"]]),
      }),
    );

    expect(getRecordFields(shadow, PATH, "node", "u")).toEqual(LIVE[0]);
    expect(getField(shadow, PATH, "node", "v", "text")).toBe("v1");
  });

  it("a confirmed record advances a null field as a real observed value", () => {
    const shadow = seeded();
    advanceFromReceipt(
      shadow,
      buildApplyReceipt({
        path: PATH,
        desired: DESIRED,
        plan: "geometry",
        nodeOutcomes: new Map<string, ApplyOutcome>([
          ["u", "applied"],
          ["v", "applied"],
        ]),
      }),
    );

    expect(getField(shadow, PATH, "node", "v", "color")).toBeNull();
    expect(getField(shadow, PATH, "node", "u", "color")).toBe("9");
  });

  it("absent-marking from a landed reload is scoped to its own surface", () => {
    const shadow = seeded();
    advanceFromReceipt(
      shadow,
      buildApplyReceipt({
        path: PATH,
        desired: { nodes: [{ ...DESIRED.nodes[1] }], edges: [] },
        plan: "structural",
        reloaded: true,
      }),
    );

    expect(getRecordState(shadow, PATH, "node", "u")).toBe("absent");
    expect(getRecordFields(shadow, PATH, "node", "u")).toBeNull();
    expect(
      getRecordState(shadow, NEIGHBOUR, "node", "u"),
      "another surface's record was swept by a reload it was never part of",
    ).toBe("present");
    expect(getField(shadow, NEIGHBOUR, "node", "u", "x")).toBe(7);
  });
});
