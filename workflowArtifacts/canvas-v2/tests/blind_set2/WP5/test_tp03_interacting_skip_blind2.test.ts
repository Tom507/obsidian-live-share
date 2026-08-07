// WP5 / AC2 — an `"interacting"` skip is scoped to its own record.
//
// Angle: ACCUMULATION over three passes with a different card held each time. The
// union of what the three passes confirmed must equal the desired surface exactly,
// and at no point may a pass advance the card that was held in that pass. A
// per-pass "all or nothing" advance cannot produce this sequence.

import { describe, expect, it } from "vitest";

import { createCanvasAdapter } from "../../../canvas/canvas-adapter";
import {
  type ApplyOutcome,
  advanceFromReceipt,
  advanceRecord,
  buildApplyReceipt,
  createSurfaceShadow,
  getField,
  getRecordFields,
} from "../../../canvas/canvas-shadow";
import { CanvasDouble } from "../../harness/canvas-double";
import { InteractionDriver } from "../../harness/interaction-driver";

const PATH = "grid/three.canvas";

const START = [
  { id: "p", type: "text", x: 0, y: 0, width: 100, height: 100, text: "p0" },
  { id: "q", type: "text", x: 150, y: 0, width: 100, height: 100, text: "q0" },
  { id: "r", type: "text", x: 300, y: 0, width: 100, height: 100, text: "r0" },
];

const TARGET = {
  nodes: [
    { id: "p", type: "text", x: 10, y: 10, width: 100, height: 100, text: "p1" },
    { id: "q", type: "text", x: 160, y: 10, width: 100, height: 100, text: "q1" },
    { id: "r", type: "text", x: 310, y: 10, width: 100, height: 100, text: "r1" },
  ],
  edges: [] as Record<string, unknown>[],
};

function makeRig() {
  const double = new CanvasDouble({ nodes: START.map((record) => ({ ...record })) });
  const adapter = createCanvasAdapter(double.view);
  adapter.isBusy();
  return { double, adapter, driver: new InteractionDriver(double) };
}

/** One pass with `held` genuinely under the local user's pointer. */
function pass(rig: ReturnType<typeof makeRig>, held: string) {
  let outcomes = new Map<string, ApplyOutcome>();
  rig.driver.driveDrag(
    held,
    { x: 1, y: 1 },
    {
      during: () => {
        outcomes = new Map<string, ApplyOutcome>();
        for (const node of TARGET.nodes) {
          outcomes.set(
            node.id,
            rig.adapter.applyNodeGeometry(node.id, {
              x: node.x,
              y: node.y,
              width: node.width,
              height: node.height,
            }),
          );
        }
      },
    },
  );
  return outcomes;
}

function seeded() {
  const shadow = createSurfaceShadow();
  for (const record of START) advanceRecord(shadow, PATH, "node", record.id, record);
  return shadow;
}

describe("WP5 AC2 (blind2) — three passes, a different card held each time", () => {
  it("each pass advances exactly the two cards it did not hold", () => {
    const rig = makeRig();
    const shadow = seeded();

    const first = advanceFromReceipt(
      shadow,
      buildApplyReceipt({
        path: PATH,
        desired: TARGET,
        plan: "geometry",
        nodeOutcomes: pass(rig, "p"),
      }),
    );
    expect(getRecordFields(shadow, PATH, "node", "p")).toEqual(START[0]);
    expect(getField(shadow, PATH, "node", "q", "text")).toBe("q1");
    expect(getField(shadow, PATH, "node", "r", "text")).toBe("r1");
    expect([...first.handed.node].sort()).toEqual(["q", "r"]);

    const second = advanceFromReceipt(
      shadow,
      buildApplyReceipt({
        path: PATH,
        desired: TARGET,
        plan: "geometry",
        nodeOutcomes: pass(rig, "q"),
      }),
    );
    expect([...second.handed.node].sort()).toEqual(["p", "r"]);
    expect(getField(shadow, PATH, "node", "p", "x")).toBe(10);
  });

  it("after every card has been free once, the shadow equals the target exactly", () => {
    const rig = makeRig();
    const shadow = seeded();
    for (const held of ["p", "q", "r"]) {
      advanceFromReceipt(
        shadow,
        buildApplyReceipt({
          path: PATH,
          desired: TARGET,
          plan: "geometry",
          nodeOutcomes: pass(rig, held),
        }),
      );
    }

    for (const record of TARGET.nodes) {
      expect(getRecordFields(shadow, PATH, "node", record.id)).toEqual(record);
    }
  });

  it("a card that is held in EVERY pass never advances", () => {
    const rig = makeRig();
    const shadow = seeded();
    for (let i = 0; i < 3; i += 1) {
      advanceFromReceipt(
        shadow,
        buildApplyReceipt({
          path: PATH,
          desired: TARGET,
          plan: "geometry",
          nodeOutcomes: pass(rig, "r"),
        }),
      );
    }
    expect(getRecordFields(shadow, PATH, "node", "r")).toEqual(START[2]);
    expect(getRecordFields(shadow, PATH, "node", "p")).toEqual(TARGET.nodes[0]);
    expect(getRecordFields(shadow, PATH, "node", "q")).toEqual(TARGET.nodes[1]);
  });
});
