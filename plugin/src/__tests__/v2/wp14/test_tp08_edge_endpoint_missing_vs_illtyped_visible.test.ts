// WP14 AC1 + AC2 — the endpoint conjuncts (`from.node`, `to.node`) get the
// same missing-vs-ill-typed treatment as node fields: an edge with `to`
// entirely absent, versus one with `to` present but malformed (an empty
// `node`), are both invalid with distinguishable reasons. This is also the
// "no endpoint-less edge" invariant from `hasBothEndpoints` — the DoD is
// that this is a TYPE constraint at the boundary, not a downstream filter.
//
// AMENDED 2026-08-02 (Worker 2's E1 ruling). The ill-typed example used to be
// "`to` present but missing `side`". That shape is now VALID — the edge rule is
// exactly `id ∧ from.node ∧ to.node` and `side` was never a conjunct — so using
// it here was pinning the defect. The example is re-pointed at a genuinely
// unreadable endpoint (`to` present with an EMPTY `node`), which keeps this
// test's real subject, the missing-vs-ill-typed distinction, exactly as strict.

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

function baseEdgeFields(): Record<string, unknown> {
  return {
    [V2_FIELD.id]: "e2",
    [V2_FIELD.from]: encodeEndpoint("n1", "right"),
  };
}

describe("WP14 AC2 — missing vs ill-typed `to` endpoint are distinguishable", () => {
  it("`to` key entirely absent → invalid, reason MISSING_TO", () => {
    const record = new StubRecord(baseEdgeFields());
    const verdict = validateEdgeIngest(record, "local");
    expect(verdict.valid).toBe(false);
    if (verdict.valid) throw new Error("unreachable");
    expect(verdict.reason).toBe("MISSING_TO");
  });

  it("`to` key present but carrying an EMPTY node → invalid, reason INVALID_TO", () => {
    const fields = baseEdgeFields();
    fields[V2_FIELD.to] = { node: "", side: "left" };
    const record = new StubRecord(fields);
    const verdict = validateEdgeIngest(record, "local");
    expect(verdict.valid).toBe(false);
    if (verdict.valid) throw new Error("unreachable");
    expect(verdict.reason).toBe("INVALID_TO");
  });

  it("the two reasons are distinct", () => {
    const missing = validateEdgeIngest(new StubRecord(baseEdgeFields()), "local");
    const illTypedFields = baseEdgeFields();
    illTypedFields[V2_FIELD.to] = { node: "", side: "left" };
    const illTyped = validateEdgeIngest(new StubRecord(illTypedFields), "local");

    expect(missing.valid).toBe(false);
    expect(illTyped.valid).toBe(false);
    if (missing.valid || illTyped.valid) throw new Error("unreachable");
    expect(missing.reason).not.toBe(illTyped.reason);
  });
});
