// WP14 AC1 — same guarantee as TP07, attacked with a self-loop (both
// endpoints attach to the SAME node id, different sides) plus an
// unrelated optional `label` field present, to confirm the validator does
// not add an undocumented "distinct nodes" constraint and is not tripped
// up by unrelated optional keys.

import { describe, expect, it } from "vitest";

import {
  encodeEndpoint,
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

describe("WP14 AC1 — a self-loop edge with both endpoints well-formed is valid", () => {
  it("id + from(n1,right) + to(n1,left) + label → valid", () => {
    const record = new StubRecord({
      [V2_FIELD.id]: "conn-x",
      [V2_FIELD.from]: encodeEndpoint("n1", "right"),
      [V2_FIELD.to]: encodeEndpoint("n1", "left"),
      [V2_FIELD.label]: "loops back",
    });

    const verdict = validateEdgeIngest(record, "local");

    expect(verdict.valid).toBe(true);
  });
});
