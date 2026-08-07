// WP14 AC1 + forward-compat — same guarantee as TP03, attacked with a
// `Y.Text` that has been mutated via `insert` after construction (closer to
// how P4's capture path would actually produce one), rather than seeded
// through the constructor.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

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

describe("WP14 AC1 — a text node whose `text` is a mutated Y.Text instance is valid", () => {
  it("id + type + pos + size + text(Y.Text built via insert) → valid", () => {
    const yText = new Y.Text();
    yText.insert(0, "built incrementally");

    const record = new StubRecord({
      [V2_FIELD.id]: "n3b",
      [V2_FIELD.type]: "text",
      [V2_FIELD.pos]: encodePos(12, 4),
      [V2_FIELD.size]: encodeSize(180, 70),
      [V2_FIELD.text]: yText,
    });

    const verdict = validateNodeIngest(record, "local");

    expect(verdict.valid).toBe(true);
  });
});
