// WP14 AC3 — THE CRUX TEST. "For origin `local`, the verdict is reject; for
// origin `remote`, the function reports invalidity but never signals
// rejection — this asymmetry is explicit in the API, not left to callers."
//
// The SAME invalid record is validated under both origins. A design that
// returns an IDENTICAL verdict shape for both origins (e.g. only
// `{valid:false, reason}` with no origin-derived signal at all, forcing the
// caller to branch on the origin it already knows to decide whether to
// reject) FAILS this test: the pinned contract requires the verdict ITSELF
// to carry an explicit `reject` boolean that differs between origins for
// this one invalid record. Rejecting invalid remote deltas would cause
// divergence (BUILD_SPEC §4.5) — that is exactly the bug this test exists
// to catch.

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

describe("WP14 AC3 — local rejects, remote never rejects, for the SAME invalid record", () => {
  it("a node missing `pos` is reject:true under local and reject:false under remote, same reason", () => {
    const fields: Record<string, unknown> = {
      [V2_FIELD.id]: "n-asym-1",
      [V2_FIELD.type]: "file",
      [V2_FIELD.size]: encodeSize(10, 10),
      [V2_FIELD.file]: "a.md",
      // `pos` deliberately omitted.
    };

    const verdictLocal = validateNodeIngest(new StubRecord(fields), "local");
    const verdictRemote = validateNodeIngest(new StubRecord(fields), "remote");

    // Primary oracle: both report the record as invalid.
    expect(verdictLocal.valid).toBe(false);
    expect(verdictRemote.valid).toBe(false);
    if (verdictLocal.valid || verdictRemote.valid) throw new Error("unreachable");

    // The asymmetry, explicit in the returned data:
    expect(verdictLocal.reject).toBe(true);
    expect(verdictRemote.reject).toBe(false);

    // Same underlying diagnosis regardless of origin — only `reject` differs.
    expect(verdictRemote.reason).toBe(verdictLocal.reason);
    expect(verdictLocal.reason).toBe("MISSING_POS");
  });

  it("sanity: pos supplied via a sibling well-formed record still shows the same asymmetry shape", () => {
    const fields: Record<string, unknown> = {
      [V2_FIELD.id]: "n-asym-1b",
      [V2_FIELD.type]: "text",
      [V2_FIELD.pos]: encodePos(1, 1),
      // `size` deliberately omitted.
    };

    const verdictLocal = validateNodeIngest(new StubRecord(fields), "local");
    const verdictRemote = validateNodeIngest(new StubRecord(fields), "remote");

    if (verdictLocal.valid || verdictRemote.valid) throw new Error("unreachable");
    expect(verdictLocal.reject).toBe(true);
    expect(verdictRemote.reject).toBe(false);
  });
});
