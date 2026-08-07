// WP5 / AC3 — a failed or partial apply advances no field of the affected record.
//
// Angle: the failure is INSIDE a pass that otherwise succeeds, and the oracle is
// the field-level delta between two shadows — one advanced by the real pass, one
// advanced by a hand-built "everything landed" pass. Exactly the records that
// failed may differ, and nothing else. A `moveAndResize` that throws is used as
// the failure, which the adapter reports as `unsupported`.

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
} from "../../../canvas/canvas-shadow";
import { CanvasDouble } from "../../harness/canvas-double";

const PATH = "delta/compare.canvas";

const LIVE = [
  { id: "s1", type: "text", x: 0, y: 0, width: 60, height: 60, text: "a" },
  { id: "s2", type: "text", x: 80, y: 0, width: 60, height: 60, text: "b" },
  { id: "s3", type: "text", x: 160, y: 0, width: 60, height: 60, text: "c" },
];

const DESIRED = {
  nodes: LIVE.map((record) => ({ ...record, x: record.x + 25, text: `${record.text}!` })),
  edges: [] as Record<string, unknown>[],
};

function seeded(): SurfaceShadow {
  const shadow = createSurfaceShadow();
  for (const record of LIVE) {
    advanceRecord(shadow, PATH, "node", record.id, record as Record<string, ShadowFieldValue>);
  }
  return shadow;
}

/** Every (id, field) the shadow currently holds, as a flat comparable set. */
function fields(shadow: SurfaceShadow): Map<string, ShadowFieldValue | undefined> {
  const out = new Map<string, ShadowFieldValue | undefined>();
  for (const record of DESIRED.nodes) {
    for (const field of Object.keys(record)) {
      out.set(`${record.id}.${field}`, getField(shadow, PATH, "node", record.id, field));
    }
  }
  return out;
}

describe("WP5 AC3 (blind2) — only the failed record may differ from a full apply", () => {
  it("an unsupported card is the ONLY difference against an all-landed pass", () => {
    const double = new CanvasDouble({ nodes: LIVE.map((record) => ({ ...record })) });
    const broken = double.getNode("s2") as unknown as Record<string, unknown>;
    broken.moveAndResize = () => {
      throw new Error("model rejected the move");
    };
    const adapter = createCanvasAdapter(double.view);

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
    expect(outcomes.get("s2"), "fixture: the middle card must fail").toBe("unsupported");

    const real = seeded();
    advanceFromReceipt(
      real,
      buildApplyReceipt({ path: PATH, desired: DESIRED, plan: "geometry", nodeOutcomes: outcomes }),
    );

    const ideal = seeded();
    advanceFromReceipt(
      ideal,
      buildApplyReceipt({
        path: PATH,
        desired: DESIRED,
        plan: "geometry",
        nodeOutcomes: new Map<string, ApplyOutcome>(
          DESIRED.nodes.map((node) => [node.id, "applied" as ApplyOutcome]),
        ),
      }),
    );

    const realFields = fields(real);
    const idealFields = fields(ideal);
    const differing = [...realFields.keys()]
      .filter((key) => realFields.get(key) !== idealFields.get(key))
      .sort();

    expect(differing).toEqual(["s2.text", "s2.x"]);
    expect(getRecordFields(real, PATH, "node", "s2")).toEqual(LIVE[1]);
  });

  it("a whole-pass failure differs from the ideal in EVERY changed field", () => {
    const real = seeded();
    advanceFromReceipt(
      real,
      buildApplyReceipt({ path: PATH, desired: DESIRED, plan: "structural", reloaded: false }),
    );

    for (const record of LIVE) {
      expect(getRecordFields(real, PATH, "node", record.id)).toEqual(record);
    }
  });

  it("a failed pass on an unknown surface creates no shadow entry at all", () => {
    const shadow = createSurfaceShadow();
    advanceFromReceipt(
      shadow,
      buildApplyReceipt({ path: PATH, desired: DESIRED, plan: "structural", reloaded: false }),
    );

    expect(shadow.paths.has(PATH), "a failed apply must not register the surface").toBe(false);
    expect(getRecordState(shadow, PATH, "node", "s1")).toBe("unknown");
  });
});
