// WP14 AC3 — same bounds check as TP11, attacked from the EDGE side: a
// valid edge is valid under both origins, closing out the "origin only
// matters when invalid" property for both `validateNodeIngest` and
// `validateEdgeIngest`.

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

function validEdgeFields(): Record<string, unknown> {
  return {
    [V2_FIELD.id]: "e-ok-1",
    [V2_FIELD.from]: encodeEndpoint("n1", "right"),
    [V2_FIELD.to]: encodeEndpoint("n2", "left"),
  };
}

describe("WP14 AC3 — origin has no effect on a valid edge's verdict", () => {
  it("a valid edge is valid under both `local` and `remote`, with equal verdicts", () => {
    const verdictLocal = validateEdgeIngest(new StubRecord(validEdgeFields()), "local");
    const verdictRemote = validateEdgeIngest(new StubRecord(validEdgeFields()), "remote");

    expect(verdictLocal.valid).toBe(true);
    expect(verdictRemote.valid).toBe(true);
    expect(verdictLocal).toEqual(verdictRemote);
  });
});
