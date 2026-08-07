// WP11 AC1 — same guarantee, attacked from a non-CRDT angle plus a repeated-
// rejection edge case: TWO different later writes are each rejected in turn,
// and neither one is allowed to nudge the stored value forward even a
// little.

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

describe("WP11 AC1 — repeated differing writes are each rejected, never partially applied", () => {
  it("keeps the original value through two distinct rejected attempts", () => {
    const record = new StubRecord();
    const first = guardTypeWrite(record, "edge-3", "group");
    expect(first.kind).toBe("accepted");

    const secondAttempt = guardTypeWrite(record, "edge-3", "file");
    expect(secondAttempt.kind).toBe("rejected");
    expect(record.get(V2_FIELD.type)).toBe("group");
    if (secondAttempt.kind !== "rejected") throw new Error("unreachable");
    expect(secondAttempt.signature).toContain("edge-3");
    expect(secondAttempt.signature).toContain("file");

    const thirdAttempt = guardTypeWrite(record, "edge-3", "url");
    expect(thirdAttempt.kind).toBe("rejected");
    expect(record.get(V2_FIELD.type)).toBe("group");
    if (thirdAttempt.kind !== "rejected") throw new Error("unreachable");
    expect(thirdAttempt.signature).toContain("edge-3");
    expect(thirdAttempt.signature).toContain("url");
  });
});
