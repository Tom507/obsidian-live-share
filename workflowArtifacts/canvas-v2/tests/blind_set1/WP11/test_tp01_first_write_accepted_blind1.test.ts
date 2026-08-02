// WP11 AC1 — same guarantee, attacked from a non-CRDT angle: a hand-rolled
// V2RecordMap stub (no Yjs at all) proves the guard's decision does not
// secretly depend on Y.Map internals — it only needs get/set, exactly the
// structural contract canvas-registers.ts defines. Different id and value
// from the visible test.

import { describe, expect, it } from "vitest";

import { V2_FIELD, type V2RecordMap } from "../../../canvas/canvas-registers";
import { guardTypeWrite } from "../../../canvas/canvas-type-guard";

class StubRecord implements V2RecordMap {
  private readonly fields = new Map<string, unknown>();
  get(key: string): unknown {
    return this.fields.get(key);
  }
  set(key: string, value: unknown): unknown {
    this.fields.set(key, value);
    return value;
  }
}

describe("WP11 AC1 — first write accepted (non-Yjs record stub)", () => {
  it("accepts and stores the first type on a plain V2RecordMap implementation", () => {
    const record = new StubRecord();
    expect(record.get(V2_FIELD.type)).toBeUndefined();

    const verdict = guardTypeWrite(record, "e7", "link");

    expect(verdict.kind).toBe("accepted");
    expect(record.get(V2_FIELD.type)).toBe("link");
  });
});
