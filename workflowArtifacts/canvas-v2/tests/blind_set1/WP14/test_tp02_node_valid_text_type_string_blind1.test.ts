// WP14 AC1 — same guarantee as TP02, attacked with the shortest possible
// non-empty string: a single character. A validator that (wrongly) imposes
// a minimum length beyond "non-empty" would fail this.

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

describe("WP14 AC1 — a text node with a single-character string is valid", () => {
  it("id + type + pos + size + text('a') → valid", () => {
    const record = new StubRecord({
      [V2_FIELD.id]: "txt-1",
      [V2_FIELD.type]: "text",
      [V2_FIELD.pos]: encodePos(1, 2),
      [V2_FIELD.size]: encodeSize(60, 60),
      [V2_FIELD.text]: "a",
    });

    const verdict = validateNodeIngest(record, "local");

    expect(verdict.valid).toBe(true);
  });
});
