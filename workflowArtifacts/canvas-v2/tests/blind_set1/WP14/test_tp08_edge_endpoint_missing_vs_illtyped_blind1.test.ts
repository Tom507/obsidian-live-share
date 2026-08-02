// WP14 AC1 + AC2 — same guarantee as TP08, attacked on the OTHER endpoint
// (`from` instead of `to`) with an empty-`node` malformation instead of a
// missing `side`.

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

function baseEdgeFields(): Record<string, unknown> {
  return {
    [V2_FIELD.id]: "edge-inbound-7",
    [V2_FIELD.to]: encodeEndpoint("n9", "left"),
  };
}

describe("WP14 AC2 — missing vs ill-typed `from` endpoint are distinguishable", () => {
  it("`from` key entirely absent → invalid, reason MISSING_FROM", () => {
    const record = new StubRecord(baseEdgeFields());
    const verdict = validateEdgeIngest(record, "local");
    expect(verdict.valid).toBe(false);
    if (verdict.valid) throw new Error("unreachable");
    expect(verdict.reason).toBe("MISSING_FROM");
  });

  it("`from` key present but `node` is an empty string → invalid, reason INVALID_FROM", () => {
    const fields = baseEdgeFields();
    fields[V2_FIELD.from] = { node: "", side: "left" };
    const record = new StubRecord(fields);
    const verdict = validateEdgeIngest(record, "local");
    expect(verdict.valid).toBe(false);
    if (verdict.valid) throw new Error("unreachable");
    expect(verdict.reason).toBe("INVALID_FROM");
  });

  it("the two reasons are distinct", () => {
    const missing = validateEdgeIngest(new StubRecord(baseEdgeFields()), "local");
    const illTypedFields = baseEdgeFields();
    illTypedFields[V2_FIELD.from] = { node: "", side: "left" };
    const illTyped = validateEdgeIngest(new StubRecord(illTypedFields), "local");

    expect(missing.valid).toBe(false);
    expect(illTyped.valid).toBe(false);
    if (missing.valid || illTyped.valid) throw new Error("unreachable");
    expect(missing.reason).not.toBe(illTyped.reason);
  });
});
