// WP14 AC1 + forward-compat — same guarantee as TP03, attacked from a
// different angle: a PLAIN, non-`Y.Text` object standing in for the
// tolerant "object" branch. This proves the validator's tolerance is
// STRUCTURAL/duck-typed (any non-null object) rather than a check that
// happens to special-case the real `Y.Text` class — a `value instanceof
// Y.Text` check would itself require importing `yjs`, which would violate
// AC4 (module purity, no knowledge of Yjs). This is also, therefore, a
// purity-adjacent test: it shows the module does not need `yjs` to make this
// decision.

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

describe("WP14 AC1 — a text node whose `text` is a plain non-Y.Text object is valid", () => {
  it("id + type + pos + size + text(plain object stand-in) → valid", () => {
    const record = new StubRecord({
      [V2_FIELD.id]: "n3c",
      [V2_FIELD.type]: "text",
      [V2_FIELD.pos]: encodePos(2, 2),
      [V2_FIELD.size]: encodeSize(90, 90),
      [V2_FIELD.text]: { toString: () => "plain text stand-in" },
    });

    const verdict = validateNodeIngest(record, "local");

    expect(verdict.valid).toBe(true);
  });
});
