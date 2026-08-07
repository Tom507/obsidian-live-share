// WP5 / AC2 — an `"interacting"` skip is scoped to its own record.
//
// Angle: a RESIZE (the other half of the drag bracket) on the FIRST record of the
// pass, with edges in the fixture. Order matters here: if the receipt bailed out
// of the loop on the first unconfirmed record instead of skipping just that one,
// this file catches it and the drag-last variant would not.

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

const PATH = "arch/layers.canvas";

const LIVE_NODES = [
  { id: "top", type: "text", x: 0, y: 0, width: 240, height: 120, text: "ui", color: "1" },
  { id: "mid", type: "text", x: 0, y: 200, width: 240, height: 120, text: "core", color: "2" },
  { id: "bot", type: "text", x: 0, y: 400, width: 240, height: 120, text: "db", color: "3" },
];
const LIVE_EDGES = [
  { id: "t-m", fromNode: "top", toNode: "mid", fromSide: "bottom", toSide: "top" },
  { id: "m-b", fromNode: "mid", toNode: "bot", fromSide: "bottom", toSide: "top" },
];

const DESIRED = {
  nodes: [
    { id: "top", type: "text", x: 0, y: 0, width: 300, height: 160, text: "ui", color: "6" },
    { id: "mid", type: "text", x: 20, y: 200, width: 240, height: 120, text: "domain", color: "2" },
    { id: "bot", type: "text", x: 20, y: 400, width: 240, height: 120, text: "db", color: "5" },
  ],
  edges: LIVE_EDGES.map((edge) => ({ ...edge })),
};

function seeded() {
  const shadow = createSurfaceShadow();
  for (const record of LIVE_NODES) advanceRecord(shadow, PATH, "node", record.id, record);
  for (const record of LIVE_EDGES) advanceRecord(shadow, PATH, "edge", record.id, record);
  return shadow;
}

function rig() {
  const double = new CanvasDouble({
    nodes: LIVE_NODES.map((record) => ({ ...record })),
    edges: LIVE_EDGES.map((record) => ({ ...record })),
  });
  const adapter = createCanvasAdapter(double.view);
  adapter.isBusy();
  return { double, adapter, driver: new InteractionDriver(double) };
}

function outcomesFor(adapter: ReturnType<typeof createCanvasAdapter>) {
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

describe("WP5 AC2 (blind1) — a resize on the first record of the pass", () => {
  it("the real adapter reports interacting for the resized card", () => {
    const r = rig();
    let outcomes = new Map<string, ApplyOutcome>();
    r.driver.driveResize(
      "top",
      { width: 260, height: 130 },
      { during: () => { outcomes = outcomesFor(r.adapter); } },
    );
    expect(outcomes.get("top")).toBe("interacting");
    expect(outcomes.get("mid")).toBe("applied");
    expect(outcomes.get("bot")).toBe("applied");
  });

  it("the later records still advance in full, edges included", () => {
    const r = rig();
    const shadow = seeded();
    let outcomes = new Map<string, ApplyOutcome>();
    r.driver.driveResize(
      "top",
      { width: 260, height: 130 },
      { during: () => { outcomes = outcomesFor(r.adapter); } },
    );

    const summary = advanceFromReceipt(
      shadow,
      buildApplyReceipt({ path: PATH, desired: DESIRED, plan: "geometry", nodeOutcomes: outcomes }),
    );

    expect(getRecordFields(shadow, PATH, "node", "top")).toEqual(LIVE_NODES[0]);
    expect(getField(shadow, PATH, "node", "mid", "x")).toBe(20);
    expect(getField(shadow, PATH, "node", "mid", "text")).toBe("domain");
    expect(getField(shadow, PATH, "node", "bot", "color")).toBe("5");
    expect(getRecordFields(shadow, PATH, "edge", "t-m")).toEqual(LIVE_EDGES[0]);

    expect(summary.handed.node.has("top")).toBe(false);
    expect([...summary.handed.node].sort()).toEqual(["bot", "mid"]);
    expect([...summary.handed.edge].sort()).toEqual(["m-b", "t-m"]);
  });

  it("the skip does not consume the record's earlier knowledge", () => {
    const r = rig();
    const shadow = seeded();
    let outcomes = new Map<string, ApplyOutcome>();
    r.driver.driveResize(
      "top",
      { width: 260, height: 130 },
      { during: () => { outcomes = outcomesFor(r.adapter); } },
    );
    advanceFromReceipt(
      shadow,
      buildApplyReceipt({ path: PATH, desired: DESIRED, plan: "geometry", nodeOutcomes: outcomes }),
    );

    expect(getField(shadow, PATH, "node", "top", "width")).toBe(240);
    expect(getField(shadow, PATH, "node", "top", "color")).toBe("1");
    expect(getField(shadow, PATH, "node", "top", "text")).toBe("ui");
  });

  it("two consecutive skips of the same record never accumulate an advance", () => {
    const r = rig();
    const shadow = seeded();
    for (const width of [260, 280]) {
      let outcomes = new Map<string, ApplyOutcome>();
      r.driver.driveResize(
        "top",
        { width, height: 130 },
        { during: () => { outcomes = outcomesFor(r.adapter); } },
      );
      advanceFromReceipt(
        shadow,
        buildApplyReceipt({ path: PATH, desired: DESIRED, plan: "geometry", nodeOutcomes: outcomes }),
      );
    }
    expect(getRecordFields(shadow, PATH, "node", "top")).toEqual(LIVE_NODES[0]);
  });
});
