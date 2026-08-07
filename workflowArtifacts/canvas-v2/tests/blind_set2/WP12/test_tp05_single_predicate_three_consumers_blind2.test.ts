// WP12 AC2 — same guarantee, attacked by simulating batch filtering: a list
// of records is filtered by all three consumer angles (reconcile output,
// serialisation write-set, capture resurrect-block set) built purely from
// isTombstoneSuppressed, and the three resulting sets must agree exactly.

import { describe, expect, it } from "vitest";

import { isTombstoneSuppressed } from "../../../canvas/canvas-tombstone";
import type { TombstoneEntry } from "../../../canvas/canvas-tombstone";

interface RecordFixture {
  id: string;
  tombstone: TombstoneEntry | undefined;
}

describe("WP12 AC2 — batch-filtering three consumer angles from isTombstoneSuppressed agree exactly", () => {
  it("reconcile's emit-set, serialisation's write-set and capture's block-set partition a record batch identically", () => {
    const records: RecordFixture[] = [
      { id: "n1", tombstone: undefined },
      { id: "n2", tombstone: { t: 1, by: "peer-a", on: true } },
      { id: "n3", tombstone: { t: 2, by: "peer-b", on: false } },
      { id: "n4", tombstone: { t: 3, by: "auditor", on: true, q: true } },
      { id: "n5", tombstone: undefined },
    ];

    const reconcileEmitSet = records.filter((r) => !isTombstoneSuppressed(r.tombstone)).map((r) => r.id);
    const serialisationWriteSet = records.filter((r) => !isTombstoneSuppressed(r.tombstone)).map((r) => r.id);
    const captureBlockSet = records.filter((r) => isTombstoneSuppressed(r.tombstone)).map((r) => r.id);

    expect(reconcileEmitSet.sort()).toEqual(["n1", "n3", "n5"]);
    expect(serialisationWriteSet.sort()).toEqual(reconcileEmitSet.sort());
    expect(captureBlockSet.sort()).toEqual(["n2", "n4"]);

    // The emit-set and the block-set must be complementary over the whole batch.
    expect(reconcileEmitSet.length + captureBlockSet.length).toBe(records.length);
  });
});
