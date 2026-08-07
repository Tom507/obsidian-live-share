// WP14 AC1 + AC2 — the type-specific requirement (`file`→`file` here) is
// itself subject to AC2's missing-vs-ill-typed distinction: a `file`-type
// node with no `file` key at all, and one with `file` present but empty,
// are BOTH invalid and their reasons must be distinguishable machine-
// readable codes, not just different human strings.

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

function baseFileNodeFields(): Record<string, unknown> {
  return {
    [V2_FIELD.id]: "n4",
    [V2_FIELD.type]: "file",
    [V2_FIELD.pos]: encodePos(10, 20),
    [V2_FIELD.size]: encodeSize(100, 50),
  };
}

describe("WP14 AC2 — missing vs ill-typed type-specific field are distinguishable", () => {
  it("`file` key entirely absent → invalid, reason MISSING_TYPE_SPECIFIC", () => {
    const record = new StubRecord(baseFileNodeFields());
    const verdict = validateNodeIngest(record, "local");
    expect(verdict.valid).toBe(false);
    if (verdict.valid) throw new Error("unreachable");
    expect(verdict.reason).toBe("MISSING_TYPE_SPECIFIC");
  });

  it("`file` key present but empty string → invalid, reason INVALID_TYPE_SPECIFIC", () => {
    const fields = baseFileNodeFields();
    fields[V2_FIELD.file] = "";
    const record = new StubRecord(fields);
    const verdict = validateNodeIngest(record, "local");
    expect(verdict.valid).toBe(false);
    if (verdict.valid) throw new Error("unreachable");
    expect(verdict.reason).toBe("INVALID_TYPE_SPECIFIC");
  });

  it("the two reasons are distinct", () => {
    const missing = validateNodeIngest(new StubRecord(baseFileNodeFields()), "local");
    const illTypedFields = baseFileNodeFields();
    illTypedFields[V2_FIELD.file] = "";
    const illTyped = validateNodeIngest(new StubRecord(illTypedFields), "local");

    expect(missing.valid).toBe(false);
    expect(illTyped.valid).toBe(false);
    if (missing.valid || illTyped.valid) throw new Error("unreachable");
    expect(missing.reason).not.toBe(illTyped.reason);
  });
});
