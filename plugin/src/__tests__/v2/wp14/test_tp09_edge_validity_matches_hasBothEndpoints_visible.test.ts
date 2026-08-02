// WP14 AC1 (reuse, Shared Ownership Contract §1) — `canvas-registers.ts`
// already exports `hasBothEndpoints(record)` expressing "no endpoint-less
// edge" as ONE predicate, specifically so WP14's validator and WP23's
// fuzzer oracle ask the same question the same way. This test does not
// inspect the validator's source; it cross-checks BEHAVIOUR: for a table of
// `to` shapes (well-formed, missing, and several kinds of malformed), the
// validator's id-holding-edge verdict must agree with `hasBothEndpoints`
// exactly. A validator that re-implements the endpoint check with its own
// inline logic could easily disagree with `hasBothEndpoints` on an edge
// case (e.g. an object with extra keys); this table is built to surface
// exactly that kind of drift.

import { describe, expect, it } from "vitest";

import {
  encodeEndpoint,
  hasBothEndpoints,
  V2_FIELD,
  type V2RecordMap,
} from "../../../canvas/canvas-registers";
import { validateEdgeIngest } from "../../../canvas/canvas-ingest-schema";

class StubRecord implements V2RecordMap {
  private readonly fields: Map<string, unknown>;
  constructor(fields: Record<string, unknown> = {}) {
    this.fields = new Map(Object.entries(fields));
  }
  get(key: string): unknown {
    return this.fields.get(key);
  }
  set(key: string, value: unknown): unknown {
    this.fields.set(key, value);
    return value;
  }
}

// AMENDED 2026-08-02 (Worker 2's E1 ruling). "missing side" is no longer an
// invalid shape — `side` is optional in the JSON Canvas format and was never a
// conjunct of `Edge valid` — so it is relabelled and joined by shapes that are
// genuinely unreadable (empty node, wrong primitive, wrong-typed side). The
// table is deliberately still scored against `hasBothEndpoints` rather than a
// hardcoded verdict column: the point is that the two can never disagree, in
// EITHER direction, whichever way an individual shape's verdict falls.
const TO_SHAPES: ReadonlyArray<{ label: string; value: unknown }> = [
  { label: "well-formed", value: encodeEndpoint("n2", "left") },
  { label: "well-formed with end", value: encodeEndpoint("n2", "left", "arrow") },
  { label: "absent", value: undefined },
  { label: "side-less (node only — legal JSON Canvas)", value: { node: "n2" } },
  { label: "side-less with end", value: { node: "n2", end: "arrow" } },
  { label: "empty node", value: { node: "", side: "left" } },
  { label: "no node, side only", value: { side: "left" } },
  { label: "wrong-typed side", value: { node: "n2", side: 7 } },
  { label: "non-object (string)", value: "n2" },
  { label: "array instead of object", value: ["n2", "left"] },
  { label: "extra unrelated key present", value: { node: "n2", side: "left", extra: 1 } },
];

describe("WP14 AC1 — edge validity agrees with hasBothEndpoints across `to` shapes", () => {
  for (const shape of TO_SHAPES) {
    it(`"to" = ${shape.label} → validity matches hasBothEndpoints`, () => {
      const fields: Record<string, unknown> = {
        [V2_FIELD.id]: "e-consistency",
        [V2_FIELD.from]: encodeEndpoint("n1", "right"),
      };
      if (shape.value !== undefined) fields[V2_FIELD.to] = shape.value;

      const record = new StubRecord(fields);
      const expectedEndpointsOk = hasBothEndpoints(record);
      const verdict = validateEdgeIngest(record, "local");

      expect(verdict.valid).toBe(expectedEndpointsOk);
    });
  }
});
