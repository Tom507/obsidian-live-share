// WP14 AC2 — the `pos` register (WP9's atomic geometry vocabulary) is
// subject to the same missing-vs-ill-typed distinction as the type-specific
// field: a node with no `pos` key at all, and one with `pos` present but a
// torn/malformed register (here: a one-element array, failing WP9's
// `isPosRegister` whole-pair check), are BOTH invalid with distinguishable
// reasons.

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
    [V2_FIELD.id]: "n7",
    [V2_FIELD.type]: "file",
    [V2_FIELD.size]: encodeSize(100, 50),
    [V2_FIELD.file]: "a.md",
  };
}

describe("WP14 AC2 — missing vs ill-typed `pos` are distinguishable", () => {
  it("`pos` key entirely absent → invalid, reason MISSING_POS", () => {
    const record = new StubRecord(baseFields());
    const verdict = validateNodeIngest(record, "local");
    expect(verdict.valid).toBe(false);
    if (verdict.valid) throw new Error("unreachable");
    expect(verdict.reason).toBe("MISSING_POS");
  });

  it("`pos` key present but a one-element array (torn pair) → invalid, reason INVALID_POS", () => {
    const fields = baseFields();
    fields[V2_FIELD.pos] = [1];
    const record = new StubRecord(fields);
    const verdict = validateNodeIngest(record, "local");
    expect(verdict.valid).toBe(false);
    if (verdict.valid) throw new Error("unreachable");
    expect(verdict.reason).toBe("INVALID_POS");
  });

  it("the two reasons are distinct", () => {
    const missing = validateNodeIngest(new StubRecord(baseFields()), "local");
    const illTypedFields = baseFields();
    illTypedFields[V2_FIELD.pos] = [1];
    const illTyped = validateNodeIngest(new StubRecord(illTypedFields), "local");

    expect(missing.valid).toBe(false);
    expect(illTyped.valid).toBe(false);
    if (missing.valid || illTyped.valid) throw new Error("unreachable");
    expect(missing.reason).not.toBe(illTyped.reason);
  });

  it("sanity: a well-formed `pos` alongside the same base fields is valid", () => {
    const fields = baseFields();
    fields[V2_FIELD.pos] = encodePos(1, 2);
    const verdict = validateNodeIngest(new StubRecord(fields), "local");
    expect(verdict.valid).toBe(true);
  });
});
