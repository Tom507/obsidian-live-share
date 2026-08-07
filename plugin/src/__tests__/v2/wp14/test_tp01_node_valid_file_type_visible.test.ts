// WP14 AC1 — "Node valid ⟺ id ∧ type ∧ pos ∧ size ∧ type-specific requirement",
// exercised for the `file`→`file` instance the AC pins by name.
//
// A node record carrying all four core fields plus a non-empty `file` value
// for a `type: "file"` node must validate as VALID. This is the positive
// anchor for AC1's conjunction — the negative half (each conjunct's absence
// invalidates) is pinned separately (TP04/TP05/TP06).

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

describe("WP14 AC1 — a fully-populated file node is valid", () => {
  it("id + type + pos + size + file → valid", () => {
    const record = new StubRecord({
      [V2_FIELD.id]: "n1",
      [V2_FIELD.type]: "file",
      [V2_FIELD.pos]: encodePos(10, 20),
      [V2_FIELD.size]: encodeSize(100, 50),
      [V2_FIELD.file]: "notes/foo.md",
    });

    const verdict = validateNodeIngest(record, "local");

    expect(verdict.valid).toBe(true);
  });
});
