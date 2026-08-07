// WP14 AC1 — same guarantee as the visible TP01, attacked with different
// data: a different id shape, a zero-origin position, a 1x1 size (the
// smallest legal geometry) and a nested file path.

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

describe("WP14 AC1 — a minimal-geometry file node is valid", () => {
  it("id + type + pos(0,0) + size(1,1) + a nested file path → valid", () => {
    const record = new StubRecord({
      [V2_FIELD.id]: "node-alpha",
      [V2_FIELD.type]: "file",
      [V2_FIELD.pos]: encodePos(0, 0),
      [V2_FIELD.size]: encodeSize(1, 1),
      [V2_FIELD.file]: "attachments/deep/nested/img.png",
    });

    const verdict = validateNodeIngest(record, "local");

    expect(verdict.valid).toBe(true);
  });
});
