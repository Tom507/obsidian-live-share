// WP14 AC1 + AC2 — same guarantee as TP08, attacked with `to` holding a
// completely wrong SHAPE (an array, mimicking a torn/legacy value) rather
// than an object missing one field.

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
    [V2_FIELD.id]: "e-loop-3",
    [V2_FIELD.from]: encodeEndpoint("n5", "top"),
  };
}

describe("WP14 AC2 — missing vs array-shaped `to` endpoint are distinguishable", () => {
  it("`to` key entirely absent → invalid, reason MISSING_TO", () => {
    const record = new StubRecord(baseEdgeFields());
    const verdict = validateEdgeIngest(record, "local");
    expect(verdict.valid).toBe(false);
    if (verdict.valid) throw new Error("unreachable");
    expect(verdict.reason).toBe("MISSING_TO");
  });

  it("`to` key present but holds an array ['n2','left'] → invalid, reason INVALID_TO", () => {
    const fields = baseEdgeFields();
    fields[V2_FIELD.to] = ["n2", "left"];
    const record = new StubRecord(fields);
    const verdict = validateEdgeIngest(record, "local");
    expect(verdict.valid).toBe(false);
    if (verdict.valid) throw new Error("unreachable");
    expect(verdict.reason).toBe("INVALID_TO");
  });

  it("the two reasons are distinct", () => {
    const missing = validateEdgeIngest(new StubRecord(baseEdgeFields()), "local");
    const illTypedFields = baseEdgeFields();
    illTypedFields[V2_FIELD.to] = ["n2", "left"];
    const illTyped = validateEdgeIngest(new StubRecord(illTypedFields), "local");

    expect(missing.valid).toBe(false);
    expect(illTyped.valid).toBe(false);
    if (missing.valid || illTyped.valid) throw new Error("unreachable");
    expect(missing.reason).not.toBe(illTyped.reason);
  });
});
