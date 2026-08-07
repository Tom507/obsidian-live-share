// WP14 AC1 + forward-compatibility (Shared Ownership Contract §3 / Worker 2
// escalation 5) — P4 moves node `text` (and edge `label`) to a nested
// `Y.Text` WITHIN schema major 2, and reads must tolerate BOTH the
// plain-string shape (TP02) and the `Y.Text` shape. `V2Node.text` is typed
// `unknown` in canvas-registers.ts specifically for this reason — a
// validator that hard-asserts `typeof text === "string"` would make the
// future `Y.Text` shape invalid and would be a SPEC_CONTRADICTION.
//
// This is the pinned, NON-contradictory reading: the validator accepts
// EITHER a non-empty string OR a `Y.Text`-like object for the type-specific
// requirement on a `text` node. This test drives it with a real `Y.Text`
// instance (unattached to any `Y.Doc`, which `Y.Text` supports standalone)
// to make the forward-compat claim concrete rather than a stand-in shape.

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

describe("WP14 AC1 — a text node whose `text` is a Y.Text instance is valid (forward-compat)", () => {
  it("id + type + pos + size + text(Y.Text) → valid, not rejected as ill-typed", () => {
    const record = new StubRecord({
      [V2_FIELD.id]: "n3",
      [V2_FIELD.type]: "text",
      [V2_FIELD.pos]: encodePos(8, 8),
      [V2_FIELD.size]: encodeSize(220, 90),
      [V2_FIELD.text]: new Y.Text("hello world"),
    });

    const verdict = validateNodeIngest(record, "local");

    expect(verdict.valid).toBe(true);
  });
});
