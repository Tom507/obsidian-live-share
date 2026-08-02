// WP14 AC1 — the `text`→`text` instance the AC pins by name, with `text`
// still in its plain-string shape (the shape it holds before P4 moves it to
// a nested `Y.Text`, per Shared Ownership Contract §3).

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

describe("WP14 AC1 — a fully-populated text node (plain string) is valid", () => {
  it("id + type + pos + size + text (string) → valid", () => {
    const record = new StubRecord({
      [V2_FIELD.id]: "n2",
      [V2_FIELD.type]: "text",
      [V2_FIELD.pos]: encodePos(5, 5),
      [V2_FIELD.size]: encodeSize(200, 80),
      [V2_FIELD.text]: "hello world",
    });

    const verdict = validateNodeIngest(record, "local");

    expect(verdict.valid).toBe(true);
  });
});
