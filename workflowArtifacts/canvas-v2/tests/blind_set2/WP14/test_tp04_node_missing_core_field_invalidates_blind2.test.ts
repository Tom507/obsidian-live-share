// WP14 AC1 — same guarantee as TP04, attacked by removing TWO conjuncts at
// once (`id` and `size` together) to confirm the conjunction is checked
// robustly under multiple simultaneous violations (still invalid, still
// reports a reason — not a crash, not a silent pass), plus an isolated
// empty-`id` case as a second ill-typed variant with a different base
// fixture from TP04's visible/blind1.

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
    [V2_FIELD.id]: "f-anchor",
    [V2_FIELD.type]: "file",
    [V2_FIELD.pos]: encodePos(50, 60),
    [V2_FIELD.size]: encodeSize(30, 30),
    [V2_FIELD.file]: "a.md",
  };
}

describe("WP14 AC1 — the conjunction survives multiple simultaneous violations", () => {
  it("removing `id` AND `size` together → still invalid, still reports a reason", () => {
    const fields = validFileNodeFields();
    delete fields[V2_FIELD.id];
    delete fields[V2_FIELD.size];
    const verdict = validateNodeIngest(new StubRecord(fields), "local");
    expect(verdict.valid).toBe(false);
    if (verdict.valid) throw new Error("unreachable");
    expect(typeof verdict.reason).toBe("string");
    expect(verdict.reason.length).toBeGreaterThan(0);
  });

  it("removing `type` only → invalid, reason MISSING_TYPE", () => {
    const fields = validFileNodeFields();
    delete fields[V2_FIELD.type];
    const verdict = validateNodeIngest(new StubRecord(fields), "local");
    expect(verdict.valid).toBe(false);
    if (verdict.valid) throw new Error("unreachable");
    expect(verdict.reason).toBe("MISSING_TYPE");
  });

  it("removing `pos` only → invalid, reason MISSING_POS", () => {
    const fields = validFileNodeFields();
    delete fields[V2_FIELD.pos];
    const verdict = validateNodeIngest(new StubRecord(fields), "local");
    expect(verdict.valid).toBe(false);
    if (verdict.valid) throw new Error("unreachable");
    expect(verdict.reason).toBe("MISSING_POS");
  });

  it("`id` present but an empty string → invalid, reason INVALID_ID (distinct from MISSING_ID)", () => {
    const fields = validFileNodeFields();
    fields[V2_FIELD.id] = "";
    const verdict = validateNodeIngest(new StubRecord(fields), "local");
    expect(verdict.valid).toBe(false);
    if (verdict.valid) throw new Error("unreachable");
    expect(verdict.reason).toBe("INVALID_ID");
    expect(verdict.reason).not.toBe("MISSING_ID");
  });
});
