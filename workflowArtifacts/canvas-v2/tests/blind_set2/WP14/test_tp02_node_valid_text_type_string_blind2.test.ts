// WP14 AC1 — same guarantee as TP02, attacked with a multiline, markdown-
// bearing string, so the validator is shown not to inspect or constrain
// note CONTENT — only presence and non-emptiness.

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

describe("WP14 AC1 — a text node with multiline markdown content is valid", () => {
  it("id + type + pos + size + text(multiline markdown) → valid", () => {
    const record = new StubRecord({
      [V2_FIELD.id]: "txt-vault-9",
      [V2_FIELD.type]: "text",
      [V2_FIELD.pos]: encodePos(-3, 7),
      [V2_FIELD.size]: encodeSize(300, 150),
      [V2_FIELD.text]: "Multi\nline\ntext with **markdown** and a [[wikilink]]",
    });

    const verdict = validateNodeIngest(record, "local");

    expect(verdict.valid).toBe(true);
  });
});
