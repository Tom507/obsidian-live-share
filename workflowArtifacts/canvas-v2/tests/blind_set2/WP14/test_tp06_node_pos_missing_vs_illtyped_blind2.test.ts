// WP14 AC2 — same guarantee as TP06, attacked with a `pos` holding a
// non-finite coordinate (`NaN`) — a two-element array that LOOKS whole but
// fails WP9's finiteness check — to confirm "ill-typed" also catches
// structurally-shaped-but-garbage values, not only wrong-shape ones.

import { describe, expect, it } from "vitest";

import {
  encodePos,
  encodeSize,
  V2_FIELD,
  type V2RecordMap,
} from "../../../canvas/canvas-registers";
import { validateNodeIngest } from "../../../canvas/canvas-ingest-schema";

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

function baseFields(): Record<string, unknown> {
  return {
    [V2_FIELD.id]: "n9",
    [V2_FIELD.type]: "file",
    [V2_FIELD.size]: encodeSize(20, 20),
    [V2_FIELD.file]: "b.md",
  };
}

describe("WP14 AC2 — missing vs non-finite `pos` are distinguishable", () => {
  it("`pos` key entirely absent → invalid, reason MISSING_POS", () => {
    const record = new StubRecord(baseFields());
    const verdict = validateNodeIngest(record, "local");
    expect(verdict.valid).toBe(false);
    if (verdict.valid) throw new Error("unreachable");
    expect(verdict.reason).toBe("MISSING_POS");
  });

  it("`pos` key present but holds [NaN, 5] → invalid, reason INVALID_POS", () => {
    const fields = baseFields();
    fields[V2_FIELD.pos] = [Number.NaN, 5];
    const record = new StubRecord(fields);
    const verdict = validateNodeIngest(record, "local");
    expect(verdict.valid).toBe(false);
    if (verdict.valid) throw new Error("unreachable");
    expect(verdict.reason).toBe("INVALID_POS");
  });

  it("the two reasons are distinct", () => {
    const missing = validateNodeIngest(new StubRecord(baseFields()), "local");
    const illTypedFields = baseFields();
    illTypedFields[V2_FIELD.pos] = [Number.NaN, 5];
    const illTyped = validateNodeIngest(new StubRecord(illTypedFields), "local");

    expect(missing.valid).toBe(false);
    expect(illTyped.valid).toBe(false);
    if (missing.valid || illTyped.valid) throw new Error("unreachable");
    expect(missing.reason).not.toBe(illTyped.reason);
  });

  it("sanity: a well-formed `pos` alongside the same base fields is valid", () => {
    const fields = baseFields();
    fields[V2_FIELD.pos] = encodePos(6, 7);
    const verdict = validateNodeIngest(new StubRecord(fields), "local");
    expect(verdict.valid).toBe(true);
  });
});
