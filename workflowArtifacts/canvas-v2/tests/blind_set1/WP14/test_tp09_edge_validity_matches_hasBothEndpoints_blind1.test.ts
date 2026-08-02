// WP14 AC1 (reuse) — same consistency guarantee as TP09, attacked from the
// OTHER endpoint: this table varies `from` (holding `to` well-formed)
// instead of `to`, with a different set of malformed shapes (null, a
// number, an object with `side` present but `node` of the wrong type).

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

const FROM_SHAPES: ReadonlyArray<{ label: string; value: unknown }> = [
  { label: "well-formed", value: encodeEndpoint("n1", "right") },
  { label: "absent", value: undefined },
  { label: "null", value: null },
  { label: "a number", value: 42 },
  { label: "node has wrong type", value: { node: 7, side: "right" } },
  { label: "missing node entirely", value: { side: "right" } },
];

describe("WP14 AC1 — edge validity agrees with hasBothEndpoints across `from` shapes", () => {
  for (const shape of FROM_SHAPES) {
    it(`"from" = ${shape.label} → validity matches hasBothEndpoints`, () => {
      const fields: Record<string, unknown> = {
        [V2_FIELD.id]: "e-consistency-2",
        [V2_FIELD.to]: encodeEndpoint("n9", "left"),
      };
      if (shape.value !== undefined) fields[V2_FIELD.from] = shape.value;

      const record = new StubRecord(fields);
      const expectedEndpointsOk = hasBothEndpoints(record);
      const verdict = validateEdgeIngest(record, "local");

      expect(verdict.valid).toBe(expectedEndpointsOk);
    });
  }
});
