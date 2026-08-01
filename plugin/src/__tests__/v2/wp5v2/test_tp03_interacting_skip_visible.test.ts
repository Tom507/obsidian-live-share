// WP5 / AC2 — an `"interacting"` skip is scoped to the record it happened to.
//
// AC2: "An `\"interacting\"` skip leaves exactly the fields of the affected record
// un-advanced and advances every other record's confirmed fields."
//
// The `"interacting"` outcome is NOT hand-written here: it comes out of the REAL
// `createCanvasAdapter` over the contract-faithful `CanvasDouble`, driven by the
// real private-API signal bracket (`InteractionDriver`), so the receipt is fed the
// same value production feeds it.
//
//   ├── T1 the outcome really is `interacting` for the held card and `applied`
//   │      for the others — the fixture is honest before anything is asserted.
//   ├── T2 EXACTLY the held record's fields stay at their old shadow values, and
//   │      every other record's confirmed fields advance (geometry AND non-
//   │      geometry: the receipt is per field, not per geometry key).
//   ├── T3 the held record is not handed to the view, so the capture path may not
//   │      later read its absence as a deletion.
//   ├── T4 an un-advanced record keeps the knowledge it already had — a skip is
//   │      not an erase (I7).
//   └── T5 once the drag ends the next pass advances that record normally, so the
//          skip is a deferral and not a permanent hole.
//
// No timers, no sleeps, no timing constants.

import { describe, expect, it } from "vitest";

import { createCanvasAdapter } from "../../../canvas/canvas-adapter";
import {
  type ApplyOutcome,
  type ShadowFieldValue,
  advanceField,
  advanceFromReceipt,
  advanceRecord,
  buildApplyReceipt,
  createSurfaceShadow,
  getField,
  getRecordFields,
} from "../../../canvas/canvas-shadow";
import { CanvasDouble } from "../../harness/canvas-double";
import { InteractionDriver } from "../../harness/interaction-driver";

const PATH = "boards/sprint.canvas";

const LIVE = [
  { id: "n1", type: "text", x: 0, y: 0, width: 200, height: 100, text: "todo", color: "1" },
  { id: "n2", type: "text", x: 300, y: 0, width: 200, height: 100, text: "doing", color: "2" },
  { id: "n3", type: "text", x: 600, y: 0, width: 200, height: 100, text: "done", color: "3" },
];

/** What the shared doc wants the view to show: every card moved and recoloured. */
const DESIRED = {
  nodes: [
    { id: "n1", type: "text", x: 40, y: 8, width: 200, height: 100, text: "todo", color: "5" },
    { id: "n2", type: "text", x: 340, y: 8, width: 200, height: 100, text: "doing", color: "6" },
    { id: "n3", type: "text", x: 640, y: 8, width: 200, height: 100, text: "shipped", color: "3" },
  ],
  edges: [{ id: "e1", fromNode: "n1", toNode: "n3", fromSide: "right", toSide: "left" }],
};

function seededShadow() {
  const shadow = createSurfaceShadow();
  for (const record of LIVE) {
    advanceRecord(shadow, PATH, "node", record.id, record as Record<string, ShadowFieldValue>);
  }
  for (const record of DESIRED.edges) {
    advanceRecord(shadow, PATH, "edge", record.id, record as Record<string, ShadowFieldValue>);
  }
  return shadow;
}

function makeRig() {
  const double = new CanvasDouble({ nodes: [...LIVE], edges: [...DESIRED.edges] });
  const adapter = createCanvasAdapter(double.view);
  const driver = new InteractionDriver(double);
  // Reconcile always consults the busy seam first; that is also what installs the
  // dragging patch, so the driver's signals reach the adapter.
  adapter.isBusy();
  return { double, adapter, driver };
}

/** The per-node loop of `reconcileLiveCanvas`, verbatim in its effect. */
function collectNodeOutcomes(
  adapter: ReturnType<typeof createCanvasAdapter>,
): Map<string, ApplyOutcome> {
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
  return outcomes;
}

/** Run one reconcile pass while `nodeId` is genuinely held by the local user. */
function passWhileDragging(rig: ReturnType<typeof makeRig>, nodeId: string) {
  let outcomes = new Map<string, ApplyOutcome>();
  rig.driver.driveDrag(
    nodeId,
    { x: 305, y: 4 },
    {
      during: () => {
        outcomes = collectNodeOutcomes(rig.adapter);
      },
    },
  );
  return outcomes;
}

describe("WP5 AC2 — an interacting skip is scoped to its own record", () => {
  it("T1 the real adapter reports interacting for the held card only", () => {
    const outcomes = passWhileDragging(makeRig(), "n2");

    expect(outcomes.get("n2")).toBe("interacting");
    expect(outcomes.get("n1")).toBe("applied");
    expect(outcomes.get("n3")).toBe("applied");
  });

  it("T2 exactly the held record's fields stay un-advanced", () => {
    const rig = makeRig();
    const shadow = seededShadow();
    const outcomes = passWhileDragging(rig, "n2");

    const summary = advanceFromReceipt(
      shadow,
      buildApplyReceipt({ path: PATH, desired: DESIRED, plan: "geometry", nodeOutcomes: outcomes }),
    );

    // The affected record: every field still at its pre-pass value.
    expect(getRecordFields(shadow, PATH, "node", "n2")).toEqual(LIVE[1]);

    // Every other record: geometry AND non-geometry fields advanced.
    expect(getField(shadow, PATH, "node", "n1", "x")).toBe(40);
    expect(getField(shadow, PATH, "node", "n1", "y")).toBe(8);
    expect(getField(shadow, PATH, "node", "n1", "color")).toBe("5");
    expect(getField(shadow, PATH, "node", "n3", "x")).toBe(640);
    expect(getField(shadow, PATH, "node", "n3", "text")).toBe("shipped");

    expect(summary.unconfirmed).toEqual([{ kind: "node", id: "n2", outcome: "interacting" }]);
    expect(summary.advanced.some((advance: { id: string }) => advance.id === "n2")).toBe(false);
    expect(summary.advanced.filter((advance: { id: string }) => advance.id === "n1").length).toBeGreaterThan(0);
  });

  it("T3 the held record is not handed to the view", () => {
    const rig = makeRig();
    const shadow = seededShadow();
    const outcomes = passWhileDragging(rig, "n2");

    const summary = advanceFromReceipt(
      shadow,
      buildApplyReceipt({ path: PATH, desired: DESIRED, plan: "geometry", nodeOutcomes: outcomes }),
    );

    expect([...summary.handed.node].sort()).toEqual(["n1", "n3"]);
    expect(summary.handed.node.has("n2")).toBe(false);
  });

  it("T4 a skip does not erase what the shadow already knew", () => {
    const rig = makeRig();
    const shadow = seededShadow();
    // Knowledge that is not part of this pass at all.
    advanceField(shadow, PATH, "node", "n2", "note", "keep me");

    const outcomes = passWhileDragging(rig, "n2");
    advanceFromReceipt(
      shadow,
      buildApplyReceipt({ path: PATH, desired: DESIRED, plan: "geometry", nodeOutcomes: outcomes }),
    );

    expect(getField(shadow, PATH, "node", "n2", "note")).toBe("keep me");
    expect(getField(shadow, PATH, "node", "n2", "color")).toBe("2");
  });

  it("T5 the next pass after the drag ends advances the record normally", () => {
    const rig = makeRig();
    const shadow = seededShadow();
    const first = passWhileDragging(rig, "n2");
    advanceFromReceipt(
      shadow,
      buildApplyReceipt({ path: PATH, desired: DESIRED, plan: "geometry", nodeOutcomes: first }),
    );

    // Drag over: the same delta is re-delivered and now lands.
    const second = collectNodeOutcomes(rig.adapter);
    expect(second.get("n2")).toBe("applied");
    const summary = advanceFromReceipt(
      shadow,
      buildApplyReceipt({ path: PATH, desired: DESIRED, plan: "geometry", nodeOutcomes: second }),
    );

    expect(getField(shadow, PATH, "node", "n2", "x")).toBe(340);
    expect(getField(shadow, PATH, "node", "n2", "color")).toBe("6");
    expect(summary.handed.node.has("n2")).toBe(true);
  });
});
