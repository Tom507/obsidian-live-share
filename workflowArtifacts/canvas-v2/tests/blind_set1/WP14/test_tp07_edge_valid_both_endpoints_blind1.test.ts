// WP14 AC1 — same guarantee as TP07, attacked with endpoints that carry the
// optional `end` (arrowhead) marker and a differently-shaped id, so the
// optional field's presence is shown not to interfere with validity.

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

describe("WP14 AC1 — an edge with id and both endpoints (with arrowheads) is valid", () => {
  it("id + from(with end) + to(with end) → valid", () => {
    const record = new StubRecord({
      [V2_FIELD.id]: "edge-9",
      [V2_FIELD.from]: encodeEndpoint("a", "bottom", "arrow"),
      [V2_FIELD.to]: encodeEndpoint("b", "top", "arrow"),
    });

    const verdict = validateEdgeIngest(record, "local");

    expect(verdict.valid).toBe(true);
  });
});
