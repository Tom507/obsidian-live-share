// WP14 AC1 (amendment 2026-08-02, Worker 2's E1 ruling) — the edge rule is
// EXACTLY `id ∧ from.node ∧ to.node`. `side` is NOT a conjunct.
//
// CONCEPT_V2 Teil 11's predicate never mentioned `side`, and `fromSide` /
// `toSide` are optional in the JSON Canvas format. The rule became wrong only
// by delegation: WP10 required a whole `{node, side}` pair, so a side-less
// endpoint read back as ABSENT and this validator reported `MISSING_FROM` on a
// fully-connected edge — which the write-back then deleted from the user's own
// `.canvas` file.
//
// WP10 AC5 fixes the model, so this file is not merely a duplicate of it: it is
// the PIN that stops the two modules drifting apart again, which is exactly how
// the defect reached a live path. If a future change to `canvas-registers.ts`
// re-tightens the endpoint predicate, WP10's own tests and this one fail
// together — the validator can never silently inherit a stricter edge rule than
// the spec states.

import { describe, expect, it } from "vitest";

import { encodeEndpoint, V2_FIELD, type V2RecordMap } from "../../../canvas/canvas-registers";
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

describe("WP14 AC1 — `side` is not a conjunct of edge validity", () => {
  it("an edge whose `from` carries a node and NO side is valid", () => {
    const record = new StubRecord({
      [V2_FIELD.id]: "e1",
      [V2_FIELD.from]: encodeEndpoint("n1"),
      [V2_FIELD.to]: encodeEndpoint("n2", "left"),
    });

    expect(validateEdgeIngest(record, "local").valid).toBe(true);
    expect(validateEdgeIngest(record, "remote").valid).toBe(true);
  });

  it("an edge with NEITHER side named is valid — the fully side-less legal JSON Canvas edge", () => {
    const record = new StubRecord({
      [V2_FIELD.id]: "e1",
      [V2_FIELD.from]: encodeEndpoint("n1"),
      [V2_FIELD.to]: encodeEndpoint("n2"),
    });

    expect(validateEdgeIngest(record, "local").valid).toBe(true);
  });

  it("a side-less endpoint carrying only an `end` is valid", () => {
    const record = new StubRecord({
      [V2_FIELD.id]: "e1",
      [V2_FIELD.from]: encodeEndpoint("n1", undefined, "arrow"),
      [V2_FIELD.to]: encodeEndpoint("n2"),
    });

    expect(validateEdgeIngest(record, "local").valid).toBe(true);
  });

  it("the raw file-shaped side-less register (no `side` key at all) is valid, not just the encoder's output", () => {
    // The doc can hold a value written by a peer or a migration rather than by
    // this build's encoder, so the shape — not the construction route — is what
    // must be accepted.
    const record = new StubRecord({
      [V2_FIELD.id]: "e1",
      [V2_FIELD.from]: { node: "n1" },
      [V2_FIELD.to]: { node: "n2" },
    });

    expect(validateEdgeIngest(record, "local").valid).toBe(true);
  });

  it("keeps MISSING_FROM and INVALID_FROM distinguishable — absent key vs. present-but-unreadable", () => {
    const missing = validateEdgeIngest(
      new StubRecord({
        [V2_FIELD.id]: "e1",
        [V2_FIELD.to]: encodeEndpoint("n2", "left"),
      }),
      "local",
    );
    expect(missing.valid).toBe(false);
    if (missing.valid) throw new Error("unreachable");
    expect(missing.reason).toBe("MISSING_FROM");

    // Present but unreadable — an empty `node` addresses nothing, so the
    // register is not readable at all. `side` has nothing to do with it.
    const illTyped = validateEdgeIngest(
      new StubRecord({
        [V2_FIELD.id]: "e1",
        [V2_FIELD.from]: { node: "", side: "right" },
        [V2_FIELD.to]: encodeEndpoint("n2", "left"),
      }),
      "local",
    );
    expect(illTyped.valid).toBe(false);
    if (illTyped.valid) throw new Error("unreachable");
    expect(illTyped.reason).toBe("INVALID_FROM");

    expect(missing.reason).not.toBe(illTyped.reason);
  });

  it("a wrong-typed `side` still makes the endpoint unreadable — tolerant of absence, not of garbage", () => {
    const verdict = validateEdgeIngest(
      new StubRecord({
        [V2_FIELD.id]: "e1",
        [V2_FIELD.from]: { node: "n1", side: 7 },
        [V2_FIELD.to]: encodeEndpoint("n2", "left"),
      }),
      "local",
    );

    expect(verdict.valid).toBe(false);
    if (verdict.valid) throw new Error("unreachable");
    expect(verdict.reason).toBe("INVALID_FROM");
  });
});
