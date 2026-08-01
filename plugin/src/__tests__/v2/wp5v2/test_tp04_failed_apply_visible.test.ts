// WP5 / AC3 — a failed or partial apply advances no field of the affected record.
//
// AC3: "A failed or partial apply advances no field of the affected record."
//
// The point of the receipt is that "we tried" is not "it landed". Every negative
// outcome the adapter can produce is exercised through the REAL adapter, and the
// oracle is a full structural dump of the shadow — not a spot check, so an advance
// that leaks into some other field of the same record is caught too.
//
//   ├── T1 a structural reload that did not land advances nothing at all; the
//   │      shadow is bit-for-bit what it was.
//   ├── T2 `"missing"` (the card is not in the live view) leaves that record
//   │      un-advanced while the rest of the pass advances.
//   ├── T3 `"unsupported"` (the private API could not move it) does the same.
//   ├── T4 a partial receipt for a CONFIRMED record advances exactly the fields it
//   │      carries and removes none of the others (I7).
//   └── T5 a landed structural reload marks the records it no longer carries as
//          absent, so the classifier settles instead of reloading forever.
//
// No timers, no sleeps, no timing constants.

import { describe, expect, it } from "vitest";

import { createCanvasAdapter } from "../../../canvas/canvas-adapter";
import {
  type ApplyOutcome,
  type ShadowFieldValue,
  type SurfaceShadow,
  advanceFromReceipt,
  advanceRecord,
  buildApplyReceipt,
  createSurfaceShadow,
  getField,
  getRecordFields,
  getRecordState,
  listPaths,
  shadowToCanvasRecords,
} from "../../../canvas/canvas-shadow";
import { planReconcile } from "../../../canvas/reconcile-plan";
import { CanvasDouble } from "../../harness/canvas-double";

const PATH = "ops/runbook.canvas";

const LIVE = [
  { id: "a", type: "text", x: 0, y: 0, width: 120, height: 60, text: "start", color: "1" },
  { id: "b", type: "text", x: 200, y: 0, width: 120, height: 60, text: "middle", color: "2" },
];

const DESIRED = {
  nodes: [
    { id: "a", type: "text", x: 30, y: 30, width: 120, height: 60, text: "start", color: "4" },
    { id: "b", type: "text", x: 230, y: 30, width: 120, height: 60, text: "middle", color: "5" },
    // A card the shared doc has and the live view does not.
    { id: "c", type: "text", x: 400, y: 30, width: 120, height: 60, text: "end", color: "6" },
  ],
  edges: [] as Record<string, unknown>[],
};

function seededShadow(): SurfaceShadow {
  const shadow = createSurfaceShadow();
  for (const record of LIVE) {
    advanceRecord(shadow, PATH, "node", record.id, record as Record<string, ShadowFieldValue>);
  }
  return shadow;
}

/**
 * A TOTAL, comparable dump of the shadow — every path, both id spaces, every
 * record state and every field. The oracle for "nothing changed at all"; a spot
 * check would miss an advance that leaked into another field of the same record.
 */
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

describe("WP5 AC3 — a failed or partial apply advances no field", () => {
  it("T1 a structural reload that did not land advances nothing at all", () => {
    const shadow = seededShadow();
    const before = dump(shadow);

    const summary = advanceFromReceipt(
      shadow,
      buildApplyReceipt({ path: PATH, desired: DESIRED, plan: "structural", reloaded: false }),
    );

    expect(dump(shadow), "an unsupported/skipped reload advanced the shadow").toBe(before);
    expect(summary.advanced).toEqual([]);
    expect(summary.markedAbsent).toEqual([]);
    expect(summary.handed.node.size).toBe(0);
    expect(summary.handed.edge.size).toBe(0);
    expect(getRecordState(shadow, PATH, "node", "c")).toBe("unknown");
  });

  it("T2 a missing card is left un-advanced while the rest of the pass advances", () => {
    const double = new CanvasDouble({ nodes: [...LIVE] });
    const adapter = createCanvasAdapter(double.view);
    const shadow = seededShadow();

    const outcomes = new Map<string, ApplyOutcome>();
    for (const node of DESIRED.nodes) {
      outcomes.set(
        node.id,
        adapter.applyNodeGeometry(node.id, {
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
        }),
      );
    }
    expect(outcomes.get("c"), "fixture: c is not in the live view").toBe("missing");

    const summary = advanceFromReceipt(
      shadow,
      buildApplyReceipt({ path: PATH, desired: DESIRED, plan: "geometry", nodeOutcomes: outcomes }),
    );

    expect(getRecordState(shadow, PATH, "node", "c")).toBe("unknown");
    expect(getField(shadow, PATH, "node", "a", "x")).toBe(30);
    expect(getField(shadow, PATH, "node", "b", "color")).toBe("5");
    expect(summary.handed.node.has("c")).toBe(false);
    expect(summary.unconfirmed).toEqual([{ kind: "node", id: "c", outcome: "missing" }]);
  });

  it("T3 an unsupported apply is left un-advanced too", () => {
    const double = new CanvasDouble({ nodes: [...LIVE] });
    // The private API surface drifts away under us on exactly one card.
    const b = double.getNode("b") as unknown as Record<string, unknown>;
    b.moveAndResize = undefined;
    const adapter = createCanvasAdapter(double.view);
    const shadow = seededShadow();

    const outcomes = new Map<string, ApplyOutcome>();
    for (const node of DESIRED.nodes.filter((record) => record.id !== "c")) {
      outcomes.set(
        node.id,
        adapter.applyNodeGeometry(node.id, {
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
        }),
      );
    }
    expect(outcomes.get("b")).toBe("unsupported");

    advanceFromReceipt(
      shadow,
      buildApplyReceipt({
        path: PATH,
        desired: { nodes: DESIRED.nodes.filter((r) => r.id !== "c"), edges: [] },
        plan: "geometry",
        nodeOutcomes: outcomes,
      }),
    );

    expect(getRecordFields(shadow, PATH, "node", "b")).toEqual(LIVE[1]);
    expect(getField(shadow, PATH, "node", "a", "color")).toBe("4");
  });

  it("T4 a confirmed partial receipt advances only its own fields", () => {
    const shadow = seededShadow();

    advanceFromReceipt(
      shadow,
      buildApplyReceipt({
        path: PATH,
        // The doc only carries the two geometry keys for `a` in this pass.
        desired: { nodes: [{ id: "a", x: 77, y: 88 }], edges: [] },
        plan: "geometry",
        nodeOutcomes: new Map<string, ApplyOutcome>([["a", "applied"]]),
      }),
    );

    expect(getField(shadow, PATH, "node", "a", "x")).toBe(77);
    expect(getField(shadow, PATH, "node", "a", "y")).toBe(88);
    // I7: a partial report is not a removal.
    expect(getField(shadow, PATH, "node", "a", "text")).toBe("start");
    expect(getField(shadow, PATH, "node", "a", "color")).toBe("1");
    expect(getField(shadow, PATH, "node", "a", "width")).toBe(120);
  });

  it("T5 a landed reload marks the records it no longer carries as absent", () => {
    const shadow = seededShadow();
    const shrunk = { nodes: [{ ...LIVE[0], x: 30 }], edges: [] as Record<string, unknown>[] };

    const summary = advanceFromReceipt(
      shadow,
      buildApplyReceipt({ path: PATH, desired: shrunk, plan: "structural", reloaded: true }),
    );

    expect(getRecordState(shadow, PATH, "node", "b")).toBe("absent");
    expect(summary.markedAbsent).toEqual([{ kind: "node", id: "b" }]);
    expect(
      planReconcile({
        desired: shrunk,
        lastApplied: shadowToCanvasRecords(shadow, PATH),
        liveNodeIds: new Set(["a"]),
        liveEdgeIds: new Set<string>(),
      }),
      "a settled surface must not reload forever",
    ).toBe("noop");
  });
});
