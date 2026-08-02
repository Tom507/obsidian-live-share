// WP14 AC1 + AC2 — same guarantee as TP05, attacked on the OTHER type-
// specific instances the AC pins by name: `text`→`text` and `link`→`url`.
// A node with the required key entirely absent, versus one with the key present
// but holding something that is not a value of that kind, must both be invalid
// with DISTINGUISHABLE reasons.
//
// RE-PINNED 2026-08-02 (Worker 2's E1-b ruling). This file used to pin
// `text: ""` as INVALID_TYPE_SPECIFIC. That is the retired rule: `"text": ""` is
// a LEGAL JSON Canvas text node — an empty card the user has not typed into yet,
// or one whose content they cleared — and refusing it composed with the
// write-back into deleting that card from the user's own file. For `text` the
// requirement is now PRESENCE AND CORRECT TYPE; any string satisfies it.
//
// AC2's real subject is untouched and is asserted at least as hard as before:
// the ill-typed leg is re-pointed at shapes that are STILL ill-typed under the
// amendment — `text: null` and `text: []` — and the non-empty requirement that
// `file`/`url` KEPT is pinned separately, so a future implementation cannot
// "simplify" the exemption across every type-specific field. The amended
// positive case (`text: ""` is valid) is pinned directly, because an
// implementation that merely stops emitting INVALID_TYPE_SPECIFIC for it while
// still refusing it some other way would be the same data loss under a new code.

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

function baseTextNodeFields(): Record<string, unknown> {
  return {
    [V2_FIELD.id]: "n5",
    [V2_FIELD.type]: "text",
    [V2_FIELD.pos]: encodePos(1, 1),
    [V2_FIELD.size]: encodeSize(150, 75),
  };
}

function baseLinkNodeFields(): Record<string, unknown> {
  return {
    [V2_FIELD.id]: "n6",
    [V2_FIELD.type]: "link",
    [V2_FIELD.pos]: encodePos(40, 90),
    [V2_FIELD.size]: encodeSize(260, 120),
  };
}

function verdictFor(fields: Record<string, unknown>) {
  return validateNodeIngest(new StubRecord(fields), "local");
}

function reasonFor(fields: Record<string, unknown>): string {
  const verdict = verdictFor(fields);
  if (verdict.valid) throw new Error("expected an invalid verdict, got a valid one");
  return verdict.reason;
}

describe("WP14 AC2 — missing vs ill-typed type-specific values are distinguishable", () => {
  it("`text` key entirely absent → invalid, reason MISSING_TYPE_SPECIFIC", () => {
    expect(verdictFor(baseTextNodeFields()).valid).toBe(false);
    expect(reasonFor(baseTextNodeFields())).toBe("MISSING_TYPE_SPECIFIC");
  });

  it("`text` present but holding a non-text value → invalid, reason INVALID_TYPE_SPECIFIC", () => {
    for (const illTyped of [null, [], ["a"], 42, true]) {
      const fields = baseTextNodeFields();
      fields[V2_FIELD.text] = illTyped;
      expect(
        reasonFor(fields),
        `text: ${JSON.stringify(illTyped)} was not diagnosed as ill-typed`,
      ).toBe("INVALID_TYPE_SPECIFIC");
    }
  });

  it("`link` → `url`: missing and empty are BOTH invalid, and reported differently", () => {
    // `url` KEEPS the non-empty requirement — an empty URL addresses nothing.
    expect(reasonFor(baseLinkNodeFields())).toBe("MISSING_TYPE_SPECIFIC");

    const empty = baseLinkNodeFields();
    empty[V2_FIELD.url] = "";
    expect(reasonFor(empty)).toBe("INVALID_TYPE_SPECIFIC");

    expect(reasonFor(baseLinkNodeFields())).not.toBe(reasonFor(empty));
  });

  it("the two reasons are distinct on every ill-typed shape, not merged into one code", () => {
    const missing = reasonFor(baseTextNodeFields());
    for (const illTyped of [null, [], 42]) {
      const fields = baseTextNodeFields();
      fields[V2_FIELD.text] = illTyped;
      expect(reasonFor(fields)).not.toBe(missing);
    }
  });

  it("AMENDED: `text: \"\"` is a LEGAL empty card — valid, not a diagnosis", () => {
    const fields = baseTextNodeFields();
    fields[V2_FIELD.text] = "";
    const verdict = verdictFor(fields);
    expect(
      verdict.valid,
      "an empty text card was refused — the E1-b data-loss reading",
    ).toBe(true);

    // ...and the exemption is per FIELD, not a blanket relaxation: the tolerant
    // object form stays accepted, an ordinary string stays accepted, and
    // `link`→`url` above still refuses its empty value.
    const withObject = baseTextNodeFields();
    withObject[V2_FIELD.text] = { toString: () => "y-text-like" };
    expect(verdictFor(withObject).valid).toBe(true);

    const withString = baseTextNodeFields();
    withString[V2_FIELD.text] = "hello";
    expect(verdictFor(withString).valid).toBe(true);
  });
});
