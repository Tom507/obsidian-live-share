// WP14 AC1 — "Node valid ⟺ id ∧ type ∧ pos ∧ size ∧ type-specific
// requirement" is a CONJUNCTION: this test pins that EACH of the four core
// conjuncts is independently necessary, not merely that a fully-populated
// node is valid (TP01/TP02/TP03 already cover the positive case).
//
// Removing any one of `id` / `type` / `pos` / `size` from an otherwise
// valid file node must invalidate it, and the reported reason must name the
// missing conjunct. `id` presence-but-empty is also checked here (as
// INVALID_ID, distinct from MISSING_ID) since it is a simple scalar with no
// ambiguity about what "ill-typed" means — unlike `pos`/`size`/the
// type-specific field, whose missing-vs-ill-typed distinction gets its own
// dedicated test points (TP05/TP06).

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

function validFileNodeFields(): Record<string, unknown> {
  return {
    [V2_FIELD.id]: "n1",
    [V2_FIELD.type]: "file",
    [V2_FIELD.pos]: encodePos(10, 20),
    [V2_FIELD.size]: encodeSize(100, 50),
    [V2_FIELD.file]: "notes/foo.md",
  };
}

describe("WP14 AC1 — each core conjunct is independently required", () => {
  it("removing `id` → invalid, reason MISSING_ID", () => {
    const fields = validFileNodeFields();
    delete fields[V2_FIELD.id];
    const verdict = validateNodeIngest(new StubRecord(fields), "local");
    expect(verdict.valid).toBe(false);
    if (verdict.valid) throw new Error("unreachable");
    expect(verdict.reason).toBe("MISSING_ID");
  });

  it("removing `type` → invalid, reason MISSING_TYPE", () => {
    const fields = validFileNodeFields();
    delete fields[V2_FIELD.type];
    const verdict = validateNodeIngest(new StubRecord(fields), "local");
    expect(verdict.valid).toBe(false);
    if (verdict.valid) throw new Error("unreachable");
    expect(verdict.reason).toBe("MISSING_TYPE");
  });

  it("removing `pos` → invalid, reason MISSING_POS", () => {
    const fields = validFileNodeFields();
    delete fields[V2_FIELD.pos];
    const verdict = validateNodeIngest(new StubRecord(fields), "local");
    expect(verdict.valid).toBe(false);
    if (verdict.valid) throw new Error("unreachable");
    expect(verdict.reason).toBe("MISSING_POS");
  });

  it("removing `size` → invalid, reason MISSING_SIZE", () => {
    const fields = validFileNodeFields();
    delete fields[V2_FIELD.size];
    const verdict = validateNodeIngest(new StubRecord(fields), "local");
    expect(verdict.valid).toBe(false);
    if (verdict.valid) throw new Error("unreachable");
    expect(verdict.reason).toBe("MISSING_SIZE");
  });

  it("`id` present but empty string → invalid, reason INVALID_ID (distinct from MISSING_ID)", () => {
    const fields = validFileNodeFields();
    fields[V2_FIELD.id] = "";
    const verdict = validateNodeIngest(new StubRecord(fields), "local");
    expect(verdict.valid).toBe(false);
    if (verdict.valid) throw new Error("unreachable");
    expect(verdict.reason).toBe("INVALID_ID");
    expect(verdict.reason).not.toBe("MISSING_ID");
  });
});
