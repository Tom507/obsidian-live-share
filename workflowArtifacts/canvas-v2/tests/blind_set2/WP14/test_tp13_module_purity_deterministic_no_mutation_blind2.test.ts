// WP14 AC4 — same behavioural-purity guarantee as TP13, attacked with a
// FROZEN record double whose `set()` throws: if the validator ever tried
// to write, this test would fail with that thrown error rather than a
// missed assertion, making a write attempt impossible to overlook. This is
// the "does not mutate" claim enforced structurally, following the
// `wp2/test_tp05_purity_visible` deep-freeze precedent.

import { describe, expect, it } from "vitest";

import {
  encodeEndpoint,
  encodePos,
  encodeSize,
  V2_FIELD,
  type V2RecordMap,
} from "../../../canvas/canvas-registers";
import { validateEdgeIngest, validateNodeIngest } from "../../../canvas/canvas-ingest-schema";

class ThrowOnWriteRecord implements V2RecordMap {
  private readonly fields: Map<string, unknown>;
  constructor(fields: Record<string, unknown> = {}) {
    this.fields = new Map(Object.entries(fields));
  }
  get(key: string): unknown {
    return this.fields.get(key);
  }
  set(): unknown {
    throw new Error("canvas-ingest-schema must never write to the record it is validating");
  }
}

describe("WP14 AC4 — the validator never calls `set` even when it would throw", () => {
  it("validateNodeIngest on a valid file node does not throw", () => {
    const record = new ThrowOnWriteRecord({
      [V2_FIELD.id]: "n-pure-5",
      [V2_FIELD.type]: "file",
      [V2_FIELD.pos]: encodePos(3, 3),
      [V2_FIELD.size]: encodeSize(3, 3),
      [V2_FIELD.file]: "z.md",
    });

    expect(() => validateNodeIngest(record, "local")).not.toThrow();
    expect(() => validateNodeIngest(record, "remote")).not.toThrow();
  });

  it("validateNodeIngest on an invalid node does not throw (the invalid path is where a repair-on-read bug would write)", () => {
    const record = new ThrowOnWriteRecord({
      [V2_FIELD.id]: "n-pure-6",
      [V2_FIELD.type]: "file",
      // no `pos`, no `size`, no `file` — maximally invalid.
    });

    expect(() => validateNodeIngest(record, "local")).not.toThrow();
    expect(() => validateNodeIngest(record, "remote")).not.toThrow();
  });

  it("validateEdgeIngest, valid or invalid, does not throw", () => {
    const validEdge = new ThrowOnWriteRecord({
      [V2_FIELD.id]: "e-pure-3",
      [V2_FIELD.from]: encodeEndpoint("n1", "right"),
      [V2_FIELD.to]: encodeEndpoint("n2", "left"),
    });
    const invalidEdge = new ThrowOnWriteRecord({ [V2_FIELD.id]: "e-pure-4" });

    expect(() => validateEdgeIngest(validEdge, "local")).not.toThrow();
    expect(() => validateEdgeIngest(invalidEdge, "remote")).not.toThrow();
  });
});
