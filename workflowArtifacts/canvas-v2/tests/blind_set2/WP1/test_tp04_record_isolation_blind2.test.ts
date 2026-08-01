// WP1 / AC2 (second half) — isolation proven differentially against a twin shadow.
//
// Angle of attack: rather than snapshotting one shadow before and after, this
// builds TWO shadows — a "full" one that receives every operation, and a
// "reference" one that receives only the operations belonging to the records we
// claim are untouched. If any advance reaches beyond its own record, the two
// shadows disagree on the untouched region.
//
// The operation mix deliberately includes `markRecordAbsent`, because absence is
// the operation most likely to be implemented with a wide brush (e.g. "drop every
// record not mentioned").

import { describe, expect, it } from "vitest";

import {
  type ShadowRecordKind,
  type SurfaceShadow,
  advanceField,
  advanceRecord,
  createSurfaceShadow,
  getRecordState,
  markRecordAbsent,
} from "../../../canvas/canvas-shadow";

const HOT = "Team/Sprint.canvas";
const COLD_ONE = "Team/Backlog.canvas";
const COLD_TWO = "Team/Archive/2025.canvas";

type Dump = Array<[string, string, string, Array<[string, unknown]>]>;

function dump(shadow: SurfaceShadow, path: string): Dump {
  const pathState = shadow.paths.get(path);
  if (!pathState) return [];
  const rows: Dump = [];
  for (const kind of ["node", "edge"] as ShadowRecordKind[]) {
    for (const [id, record] of pathState[kind]) {
      const fields = [...record.fields.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
      rows.push([path, `${kind}:${record.state}`, id, fields]);
    }
  }
  return rows.sort((a, b) => (`${a[1]}|${a[2]}` < `${b[1]}|${b[2]}` ? -1 : 1));
}

/** The operations that build the two COLD paths — identical in both shadows. */
function seedCold(shadow: SurfaceShadow): void {
  advanceRecord(shadow, COLD_ONE, "node", "b1", { x: 10, y: 10, text: "backlog one" });
  advanceRecord(shadow, COLD_ONE, "node", "b2", { x: 20, y: 20, text: "backlog two" });
  advanceRecord(shadow, COLD_ONE, "edge", "be", { fromNode: "b1", toNode: "b2" });
  markRecordAbsent(shadow, COLD_ONE, "node", "b3");
  advanceRecord(shadow, COLD_TWO, "node", "a1", { x: 0, y: 0, color: null });
  markRecordAbsent(shadow, COLD_TWO, "edge", "ae");
}

describe("WP1 AC2 — a busy path cannot disturb the quiet ones", () => {
  it("keeps both cold paths identical to a reference shadow that never saw the hot ops", () => {
    const full = createSurfaceShadow();
    const reference = createSurfaceShadow();

    seedCold(full);
    seedCold(reference);

    // Everything below happens only on the HOT path.
    advanceRecord(full, HOT, "node", "b1", { x: -1, y: -1, text: "hot b1" });
    advanceRecord(full, HOT, "node", "s1", { x: 1, y: 1 });
    advanceField(full, HOT, "node", "s1", "x", 2);
    advanceField(full, HOT, "node", "b1", "text", "hot b1 again");
    markRecordAbsent(full, HOT, "node", "b2");
    markRecordAbsent(full, HOT, "edge", "be");
    advanceRecord(full, HOT, "edge", "he", { fromNode: "s1", toNode: "b1" });

    expect(dump(full, COLD_ONE)).toEqual(dump(reference, COLD_ONE));
    expect(dump(full, COLD_TWO)).toEqual(dump(reference, COLD_TWO));
  });

  it("marking one record absent leaves its siblings present with all their fields", () => {
    const shadow = createSurfaceShadow();
    seedCold(shadow);

    markRecordAbsent(shadow, COLD_ONE, "node", "b1");

    expect(getRecordState(shadow, COLD_ONE, "node", "b1")).toBe("absent");
    expect(getRecordState(shadow, COLD_ONE, "node", "b2")).toBe("present");
    expect(getRecordState(shadow, COLD_ONE, "edge", "be")).toBe("present");
    expect(dump(shadow, COLD_TWO)).toEqual([
      [COLD_TWO, "edge:absent", "ae", []],
      [COLD_TWO, "node:present", "a1", [["color", null], ["x", 0], ["y", 0]]],
    ]);
  });

  it("an advance on a brand-new path does not create records on an existing one", () => {
    const shadow = createSurfaceShadow();
    seedCold(shadow);
    const before = dump(shadow, COLD_ONE);

    advanceField(shadow, "Team/Neu.canvas", "node", "b1", "x", 77);

    expect(dump(shadow, COLD_ONE)).toEqual(before);
    expect(getRecordState(shadow, COLD_ONE, "node", "b1")).toBe("present");
    expect(getRecordState(shadow, "Team/Neu.canvas", "node", "b2")).toBe("unknown");
  });
});
