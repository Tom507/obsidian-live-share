// WP11 AC2 — same guarantee, attacked from a different oracle channel: a
// spy on the record's own `set` call count. Rather than a CRDT delta (no
// Yjs involved at all here), this proves directly that the guard's
// same-value branch never calls `record.set` a second time — which is the
// structural reason a real Y.Map produces no delta in the first place.

import { describe, expect, it } from "vitest";

import { V2_FIELD, type V2RecordMap } from "../../../canvas/canvas-registers";
import { guardTypeWrite } from "../../../canvas/canvas-type-guard";

class SpyRecord implements V2RecordMap {
  private readonly fields = new Map<string, unknown>();
  setCallCount = 0;
  get(key: string): unknown {
    return this.fields.get(key);
  }
  set(key: string, value: unknown): unknown {
    this.setCallCount++;
    this.fields.set(key, value);
    return value;
  }
}

describe("WP11 AC2 — a same-value rewrite never calls set a second time", () => {
  it("leaves set() call count at exactly one after an accepted write plus a same-value re-attempt", () => {
    const record = new SpyRecord();

    const first = guardTypeWrite(record, "grp-2", "group");
    expect(first.kind).toBe("accepted");
    expect(record.setCallCount).toBe(1);

    const verdict = guardTypeWrite(record, "grp-2", "group");

    expect(verdict.kind).toBe("noop");
    expect("signature" in verdict).toBe(false);
    expect(record.setCallCount, "a same-value rewrite must not call set() again").toBe(1);
    expect(record.get(V2_FIELD.type)).toBe("group");
  });
});
