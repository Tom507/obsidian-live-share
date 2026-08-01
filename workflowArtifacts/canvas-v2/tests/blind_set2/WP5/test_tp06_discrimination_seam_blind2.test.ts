// WP5 — DISCRIMINATION (BUILD_SPEC §8), at the state level.
//
// Seam: `advanceFromReceipt(shadow, receipt, { perFieldReceipt: false })`.
//
// Angle: total shadow dumps compared between the two modes, plus the NARROWNESS
// property — on a pass in which every record is confirmed the two modes must agree
// exactly. A seam that changes behaviour everywhere would discriminate trivially
// and would say nothing about the mechanism; this file pins that it changes
// behaviour only where a receipt is missing.

import { describe, expect, it } from "vitest";

import {
  type ApplyOutcome,
  type SurfaceShadow,
  advanceFromReceipt,
  advanceRecord,
  buildApplyReceipt,
  createSurfaceShadow,
  getField,
  listPaths,
} from "../../../canvas/canvas-shadow";

const PATH = "seam/state.canvas";

const BEFORE = [
  { id: "g1", type: "text", x: 0, y: 0, width: 50, height: 50, text: "g1" },
  { id: "g2", type: "text", x: 60, y: 0, width: 50, height: 50, text: "g2" },
  { id: "g3", type: "text", x: 120, y: 0, width: 50, height: 50, text: "g3" },
];

const AFTER = {
  nodes: BEFORE.map((record) => ({ ...record, y: 40, text: `${record.text}*` })),
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
  for (const record of BEFORE) advanceRecord(shadow, PATH, "node", record.id, record);
  return shadow;
}

function run(outcomes: Array<[string, ApplyOutcome]>, perFieldReceipt: boolean): SurfaceShadow {
  const shadow = seeded();
  advanceFromReceipt(
    shadow,
    buildApplyReceipt({
      path: PATH,
      desired: AFTER,
      plan: "geometry",
      nodeOutcomes: new Map<string, ApplyOutcome>(outcomes),
    }),
    { perFieldReceipt },
  );
  return shadow;
}

const CLEAN: Array<[string, ApplyOutcome]> = [
  ["g1", "applied"],
  ["g2", "applied"],
  ["g3", "unchanged"],
];

const HELD: Array<[string, ApplyOutcome]> = [
  ["g1", "applied"],
  ["g2", "interacting"],
  ["g3", "applied"],
];

const LOST: Array<[string, ApplyOutcome]> = [
  ["g1", "applied"],
  ["g2", "missing"],
  ["g3", "applied"],
];

describe("WP5 §8 (blind2) — the seam moves only what the receipt governs", () => {
  it("a fully confirmed pass is identical in both modes", () => {
    expect(dump(run(CLEAN, true))).toBe(dump(run(CLEAN, false)));
    // …and it really did advance, so the comparison is not vacuous.
    expect(getField(run(CLEAN, true), PATH, "node", "g2", "text")).toBe("g2*");
  });

  it("a held record makes the two modes diverge on EVERY other record", () => {
    const on = run(HELD, true);
    const off = run(HELD, false);

    expect(dump(on)).not.toBe(dump(off));
    expect(getField(on, PATH, "node", "g1", "y")).toBe(40);
    expect(getField(on, PATH, "node", "g3", "text")).toBe("g3*");
    expect(getField(on, PATH, "node", "g2", "y")).toBe(0);

    expect(getField(off, PATH, "node", "g1", "y"), "the disabled seam discards the pass").toBe(0);
    expect(getField(off, PATH, "node", "g3", "text")).toBe("g3");
  });

  it("a lost record makes the disabled mode claim it was applied", () => {
    const on = run(LOST, true);
    const off = run(LOST, false);

    expect(dump(on)).not.toBe(dump(off));
    expect(getField(on, PATH, "node", "g2", "y"), "an unapplied card advanced").toBe(0);
    expect(
      getField(off, PATH, "node", "g2", "y"),
      "the disabled seam must reproduce the V1 defect",
    ).toBe(40);
  });
});
