// WP14 AC3 — same bounds check as TP11, attacked with a valid TEXT node
// whose `text` is a Y.Text-like object (combining with the forward-compat
// finding from TP03), to confirm the origin-independence holds for that
// branch of the type-specific requirement too.

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

function validTextNodeFields(): Record<string, unknown> {
  return {
    [V2_FIELD.id]: "n-ok-2",
    [V2_FIELD.type]: "text",
    [V2_FIELD.pos]: encodePos(4, 4),
    [V2_FIELD.size]: encodeSize(50, 50),
    [V2_FIELD.text]: { toString: () => "stand-in Y.Text" },
  };
}

describe("WP14 AC3 — origin has no effect on a valid text node's verdict", () => {
  it("a valid text node is valid under both `local` and `remote`, with equal verdicts", () => {
    const verdictLocal = validateNodeIngest(new StubRecord(validTextNodeFields()), "local");
    const verdictRemote = validateNodeIngest(new StubRecord(validTextNodeFields()), "remote");

    expect(verdictLocal.valid).toBe(true);
    expect(verdictRemote.valid).toBe(true);
    expect(verdictLocal).toEqual(verdictRemote);
  });
});
