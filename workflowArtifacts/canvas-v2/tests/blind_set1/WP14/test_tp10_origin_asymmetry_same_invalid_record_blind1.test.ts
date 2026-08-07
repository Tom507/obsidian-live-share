// WP14 AC3 — same crux guarantee as TP10, attacked from the EDGE side
// (`validateEdgeIngest`) rather than the node side, to confirm the
// asymmetry is not a property only `validateNodeIngest` happens to have.

import { describe, expect, it } from "vitest";

import {
  encodeEndpoint,
  V2_FIELD,
  type V2RecordMap,
} from "../../../canvas/canvas-registers";
import { validateEdgeIngest } from "../../../canvas/canvas-ingest-schema";

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

describe("WP14 AC3 — local rejects, remote never rejects, for the same invalid edge", () => {
  it("an edge missing `to` is reject:true under local and reject:false under remote, same reason", () => {
    const fields: Record<string, unknown> = {
      [V2_FIELD.id]: "e-asym-1",
      [V2_FIELD.from]: encodeEndpoint("n1", "right"),
      // `to` deliberately omitted.
    };

    const verdictLocal = validateEdgeIngest(new StubRecord(fields), "local");
    const verdictRemote = validateEdgeIngest(new StubRecord(fields), "remote");

    expect(verdictLocal.valid).toBe(false);
    expect(verdictRemote.valid).toBe(false);
    if (verdictLocal.valid || verdictRemote.valid) throw new Error("unreachable");

    expect(verdictLocal.reject).toBe(true);
    expect(verdictRemote.reject).toBe(false);
    expect(verdictRemote.reason).toBe(verdictLocal.reason);
    expect(verdictLocal.reason).toBe("MISSING_TO");
  });

  it("a self-consistency check: the two verdict objects are not the same object and differ only in `reject`", () => {
    const fields: Record<string, unknown> = {
      [V2_FIELD.id]: "e-asym-2",
      // both endpoints omitted
    };

    const verdictLocal = validateEdgeIngest(new StubRecord(fields), "local");
    const verdictRemote = validateEdgeIngest(new StubRecord({ ...fields }), "remote");

    if (verdictLocal.valid || verdictRemote.valid) throw new Error("unreachable");
    expect(verdictLocal.reject).not.toBe(verdictRemote.reject);
    expect(verdictLocal.reason).toBe(verdictRemote.reason);
  });
});
