// WP14 AC3 — bounds check on the asymmetry: origin only branches behaviour
// on the INVALID path (TP10). A valid record must be reported valid under
// BOTH origins, with no reject signal leaking into the valid case either.
// This guards against an overzealous implementation that ties `reject` to
// `origin === "local"` unconditionally rather than to "origin local AND the
// record is invalid".

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

function validFileNodeFields(): Record<string, unknown> {
  return {
    [V2_FIELD.id]: "n-ok-1",
    [V2_FIELD.type]: "file",
    [V2_FIELD.pos]: encodePos(1, 1),
    [V2_FIELD.size]: encodeSize(10, 10),
    [V2_FIELD.file]: "ok.md",
  };
}

describe("WP14 AC3 — origin has no effect on a valid record's verdict", () => {
  it("a valid node is valid under both `local` and `remote`, with equal verdicts", () => {
    const verdictLocal = validateNodeIngest(new StubRecord(validFileNodeFields()), "local");
    const verdictRemote = validateNodeIngest(new StubRecord(validFileNodeFields()), "remote");

    expect(verdictLocal.valid).toBe(true);
    expect(verdictRemote.valid).toBe(true);
    expect(verdictLocal).toEqual(verdictRemote);
  });
});
