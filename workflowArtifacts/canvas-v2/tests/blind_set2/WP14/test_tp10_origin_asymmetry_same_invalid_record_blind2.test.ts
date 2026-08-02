// WP14 AC3 — same crux guarantee as TP10, attacked with a DIFFERENT
// invalidity class on a node: an ill-typed type-specific field (`file`
// present but empty) rather than a missing core register, to confirm the
// asymmetry holds across invalidity classes, not just the "missing key"
// class TP10's visible/blind1 use.

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

describe("WP14 AC3 — local rejects, remote never rejects, for an ill-typed type-specific field", () => {
  it("a file node with `file: ''` is reject:true under local and reject:false under remote, same reason", () => {
    const fields: Record<string, unknown> = {
      [V2_FIELD.id]: "n-asym-3",
      [V2_FIELD.type]: "file",
      [V2_FIELD.pos]: encodePos(0, 0),
      [V2_FIELD.size]: encodeSize(10, 10),
      [V2_FIELD.file]: "",
    };

    const verdictLocal = validateNodeIngest(new StubRecord(fields), "local");
    const verdictRemote = validateNodeIngest(new StubRecord(fields), "remote");

    expect(verdictLocal.valid).toBe(false);
    expect(verdictRemote.valid).toBe(false);
    if (verdictLocal.valid || verdictRemote.valid) throw new Error("unreachable");

    expect(verdictLocal.reject).toBe(true);
    expect(verdictRemote.reject).toBe(false);
    expect(verdictRemote.reason).toBe(verdictLocal.reason);
    expect(verdictLocal.reason).toBe("INVALID_TYPE_SPECIFIC");
  });
});
