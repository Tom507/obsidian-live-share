// WP14 AC1 — same guarantee as TP01, attacked with negative coordinates and
// extraneous optional fields present alongside the required core, so the
// validator is shown NOT to be tripped up by additional, unrelated keys.

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

describe("WP14 AC1 — a file node with negative geometry and extra optional fields is valid", () => {
  it("id + type + pos(-15,42) + size(640,480) + file, plus color/ord present → valid", () => {
    const record = new StubRecord({
      [V2_FIELD.id]: "f-99",
      [V2_FIELD.type]: "file",
      [V2_FIELD.pos]: encodePos(-15, 42),
      [V2_FIELD.size]: encodeSize(640, 480),
      [V2_FIELD.file]: "deeply/nested/path/doc.pdf",
      [V2_FIELD.color]: "4",
      [V2_FIELD.ord]: "a0",
    });

    const verdict = validateNodeIngest(record, "local");

    expect(verdict.valid).toBe(true);
  });
});
