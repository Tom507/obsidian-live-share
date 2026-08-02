// WP14 AC1 (reuse) — same consistency guarantee as TP09, attacked by
// varying BOTH endpoints simultaneously across a combination table (both
// well-formed, both malformed, one of each in either direction), so
// agreement with `hasBothEndpoints` is shown to hold under compound
// conditions, not only when a single endpoint varies in isolation.

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

const WELL_FORMED_FROM = encodeEndpoint("n1", "right");
const WELL_FORMED_TO = encodeEndpoint("n2", "left");
const MALFORMED = { node: "n3" }; // missing `side`

const COMBINATIONS: ReadonlyArray<{
  label: string;
  from: unknown;
  to: unknown;
}> = [
  { label: "both well-formed", from: WELL_FORMED_FROM, to: WELL_FORMED_TO },
  { label: "both malformed", from: MALFORMED, to: MALFORMED },
  { label: "from malformed, to well-formed", from: MALFORMED, to: WELL_FORMED_TO },
  { label: "from well-formed, to malformed", from: WELL_FORMED_FROM, to: MALFORMED },
  { label: "both absent", from: undefined, to: undefined },
];

describe("WP14 AC1 — edge validity agrees with hasBothEndpoints under compound endpoint states", () => {
  for (const combo of COMBINATIONS) {
    it(`from/to = [${combo.label}] → validity matches hasBothEndpoints`, () => {
      const fields: Record<string, unknown> = { [V2_FIELD.id]: "e-consistency-3" };
      if (combo.from !== undefined) fields[V2_FIELD.from] = combo.from;
      if (combo.to !== undefined) fields[V2_FIELD.to] = combo.to;

      const record = new StubRecord(fields);
      const expectedEndpointsOk = hasBothEndpoints(record);
      const verdict = validateEdgeIngest(record, "local");

      expect(verdict.valid).toBe(expectedEndpointsOk);
    });
  }
});
