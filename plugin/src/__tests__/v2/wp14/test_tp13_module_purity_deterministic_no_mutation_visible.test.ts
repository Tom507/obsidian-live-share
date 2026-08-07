// WP14 AC4 — purity's BEHAVIOURAL half, complementing TP12's source scan:
// same inputs → same output, and the validator never writes to the record
// it is inspecting. A boundary type-check that "repairs" or annotates the
// record as a side effect would violate "a type constraint at the
// boundary, not a downstream filter" (the DoD) — the validator only reads.
//
// `set()` calls are counted directly on the stub rather than inferred, so
// this is a state-is-the-oracle assertion, not a log/signature one.

import { describe, expect, it } from "vitest";

import {
  encodeEndpoint,
  encodePos,
  encodeSize,
  V2_FIELD,
  type V2RecordMap,
} from "../../../canvas/canvas-registers";
import { validateEdgeIngest, validateNodeIngest } from "../../../canvas/canvas-ingest-schema";

class CountingStubRecord implements V2RecordMap {
  private readonly fields: Map<string, unknown>;
  setCallCount = 0;
  constructor(fields: Record<string, unknown> = {}) {
    this.fields = new Map(Object.entries(fields));
  }
  get(key: string): unknown {
    return this.fields.get(key);
  }
  set(key: string, value: unknown): unknown {
    this.setCallCount++;
    this.fields.set(key, value);
    return value;
  }
}

describe("WP14 AC4 — validateNodeIngest / validateEdgeIngest are pure and read-only", () => {
  it("same node input → same output, over repeated calls", () => {
    const record = new CountingStubRecord({
      [V2_FIELD.id]: "n-pure-1",
      [V2_FIELD.type]: "file",
      [V2_FIELD.pos]: encodePos(1, 2),
      [V2_FIELD.size]: encodeSize(3, 4),
      [V2_FIELD.file]: "x.md",
    });

    const first = validateNodeIngest(record, "local");
    const second = validateNodeIngest(record, "local");
    const third = validateNodeIngest(record, "local");

    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it("validateNodeIngest never calls `record.set(...)`", () => {
    const record = new CountingStubRecord({
      [V2_FIELD.id]: "n-pure-2",
      [V2_FIELD.type]: "text",
      // deliberately invalid: no `pos`, no `size`, no `text` — exercising
      // the invalid path, which is exactly where a "repair on read" bug
      // would be tempted to write something back.
    });

    validateNodeIngest(record, "local");
    validateNodeIngest(record, "remote");

    expect(record.setCallCount).toBe(0);
  });

  it("validateEdgeIngest never calls `record.set(...)`, valid or invalid", () => {
    const validEdge = new CountingStubRecord({
      [V2_FIELD.id]: "e-pure-1",
      [V2_FIELD.from]: encodeEndpoint("n1", "right"),
      [V2_FIELD.to]: encodeEndpoint("n2", "left"),
    });
    const invalidEdge = new CountingStubRecord({
      [V2_FIELD.id]: "e-pure-2",
    });

    validateEdgeIngest(validEdge, "local");
    validateEdgeIngest(invalidEdge, "remote");

    expect(validEdge.setCallCount).toBe(0);
    expect(invalidEdge.setCallCount).toBe(0);
  });
});
