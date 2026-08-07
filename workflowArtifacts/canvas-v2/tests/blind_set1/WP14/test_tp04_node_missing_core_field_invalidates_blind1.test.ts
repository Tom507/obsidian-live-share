// WP14 AC1 — same guarantee as TP04, attacked from a `text`-type base
// record instead of `file`, with different literal id/geometry values, to
// rule out a design that only enforces the conjunction for one node type.

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

function validTextNodeFields(): Record<string, unknown> {
  return {
    [V2_FIELD.id]: "note-77",
    [V2_FIELD.type]: "text",
    [V2_FIELD.pos]: encodePos(3, 9),
    [V2_FIELD.size]: encodeSize(240, 120),
    [V2_FIELD.text]: "some content",
  };
}

describe("WP14 AC1 — each core conjunct is independently required (text-type base)", () => {
  it("removing `id` → invalid, reason MISSING_ID", () => {
    const fields = validTextNodeFields();
    delete fields[V2_FIELD.id];
    const verdict = validateNodeIngest(new StubRecord(fields), "local");
    expect(verdict.valid).toBe(false);
    if (verdict.valid) throw new Error("unreachable");
    expect(verdict.reason).toBe("MISSING_ID");
  });

  it("removing `type` → invalid, reason MISSING_TYPE", () => {
    const fields = validTextNodeFields();
    delete fields[V2_FIELD.type];
    const verdict = validateNodeIngest(new StubRecord(fields), "local");
    expect(verdict.valid).toBe(false);
    if (verdict.valid) throw new Error("unreachable");
    expect(verdict.reason).toBe("MISSING_TYPE");
  });

  it("removing `pos` → invalid, reason MISSING_POS", () => {
    const fields = validTextNodeFields();
    delete fields[V2_FIELD.pos];
    const verdict = validateNodeIngest(new StubRecord(fields), "local");
    expect(verdict.valid).toBe(false);
    if (verdict.valid) throw new Error("unreachable");
    expect(verdict.reason).toBe("MISSING_POS");
  });

  it("removing `size` → invalid, reason MISSING_SIZE", () => {
    const fields = validTextNodeFields();
    delete fields[V2_FIELD.size];
    const verdict = validateNodeIngest(new StubRecord(fields), "local");
    expect(verdict.valid).toBe(false);
    if (verdict.valid) throw new Error("unreachable");
    expect(verdict.reason).toBe("MISSING_SIZE");
  });

  it("`id` present but empty string → invalid, reason INVALID_ID (distinct from MISSING_ID)", () => {
    const fields = validTextNodeFields();
    fields[V2_FIELD.id] = "";
    const verdict = validateNodeIngest(new StubRecord(fields), "local");
    expect(verdict.valid).toBe(false);
    if (verdict.valid) throw new Error("unreachable");
    expect(verdict.reason).toBe("INVALID_ID");
    expect(verdict.reason).not.toBe("MISSING_ID");
  });
});
