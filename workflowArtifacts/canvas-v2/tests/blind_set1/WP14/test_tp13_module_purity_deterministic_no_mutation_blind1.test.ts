// WP14 AC4 — same behavioural-purity guarantee as TP13, attacked with the
// WP2-precedent "interleaved call" shape: a completely unrelated call in
// between two calls on the SAME record must not change the second result,
// ruling out module-level mutable state (a memoised verdict, a cache keyed
// wrong, …).

import { describe, expect, it } from "vitest";

import {
  encodeEndpoint,
  encodePos,
  encodeSize,
  V2_FIELD,
  type V2RecordMap,
} from "../../../canvas/canvas-registers";
import { validateEdgeIngest, validateNodeIngest } from "../../../canvas/canvas-ingest-schema";

class CountingStubRecord implements V2RecordMap {
  private readonly fields: Map<string, unknown>;
  setCallCount = 0;
  constructor(fields: Record<string, unknown> = {}) {
    this.fields = new Map(Object.entries(fields));
  }
  get(key: string): unknown {
    return this.fields.get(key);
  }
  set(key: string, value: unknown): unknown {
    this.setCallCount++;
    this.fields.set(key, value);
    return value;
  }
}

describe("WP14 AC4 — no state is held between calls", () => {
  it("an interleaved, unrelated call does not change the next call's result", () => {
    const record = new CountingStubRecord({
      [V2_FIELD.id]: "n-pure-3",
      [V2_FIELD.type]: "text",
      [V2_FIELD.pos]: encodePos(9, 9),
      [V2_FIELD.size]: encodeSize(9, 9),
      [V2_FIELD.text]: "steady state",
    });

    const before = validateNodeIngest(record, "local");

    // A completely different, invalid call in between.
    const other = new CountingStubRecord({ [V2_FIELD.id]: "unrelated" });
    validateNodeIngest(other, "remote");
    validateEdgeIngest(
      new CountingStubRecord({
        [V2_FIELD.id]: "e-unrelated",
        [V2_FIELD.from]: encodeEndpoint("z1", "top"),
      }),
      "local",
    );

    const after = validateNodeIngest(record, "local");

    expect(after).toEqual(before);
  });

  it("neither the target record nor the unrelated records are ever written to", () => {
    const record = new CountingStubRecord({
      [V2_FIELD.id]: "n-pure-4",
      [V2_FIELD.type]: "file",
      [V2_FIELD.pos]: encodePos(2, 2),
      [V2_FIELD.size]: encodeSize(2, 2),
      [V2_FIELD.file]: "y.md",
    });
    const other = new CountingStubRecord({ [V2_FIELD.id]: "unrelated-2" });

    validateNodeIngest(record, "local");
    validateNodeIngest(other, "remote");

    expect(record.setCallCount).toBe(0);
    expect(other.setCallCount).toBe(0);
  });
});
