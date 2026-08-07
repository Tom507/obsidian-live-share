// WP14 AC1 — "Edge valid ⟺ id ∧ from.node ∧ to.node", positive anchor: an
// edge with an id and two well-formed endpoint registers (built through
// WP10's `encodeEndpoint`, the only construction route) is valid.

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

describe("WP14 AC1 — an edge with id and both endpoints is valid", () => {
  it("id + from + to (both well-formed) → valid", () => {
    const record = new StubRecord({
      [V2_FIELD.id]: "e1",
      [V2_FIELD.from]: encodeEndpoint("n1", "right"),
      [V2_FIELD.to]: encodeEndpoint("n2", "left"),
    });

    const verdict = validateEdgeIngest(record, "local");

    expect(verdict.valid).toBe(true);
  });
});
