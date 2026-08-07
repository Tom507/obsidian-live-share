// WP14 AC1 + AC2 (amendment 2026-08-02, Worker 2's E1-b ruling) — `"text": ""`
// is a LEGAL empty text card.
//
// An empty card is what the user gets the moment they add a text node and
// before they type into it, and what they get again if they clear it. The
// landed implementation required a NON-EMPTY string, so it refused that card as
// `INVALID_TYPE_SPECIFIC`; composed with the write-back, the refusal deleted the
// card from the user's own `.canvas` file. Same class of defect as the side-less
// edge, second instance.
//
// For `text`, the requirement is PRESENCE AND CORRECT TYPE — any string
// satisfies it. The boundaries this test holds in place around that:
//   ├── `file` and `url` KEEP their non-empty requirement (an empty path or URL
//   │   addresses nothing, and this loosening must not leak sideways)
//   ├── the tolerant object form (the future `Y.Text` shape) stays accepted
//   ├── arrays and `null` stay INVALID
//   └── AC2's real subject is untouched: a MISSING key and a PRESENT-but-
//       ill-typed key still produce distinguishable reasons.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

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

function textNode(text: unknown, includeText = true): StubRecord {
  const fields: Record<string, unknown> = {
    [V2_FIELD.id]: "n1",
    [V2_FIELD.type]: "text",
    [V2_FIELD.pos]: encodePos(10, 20),
    [V2_FIELD.size]: encodeSize(200, 80),
  };
  if (includeText) fields[V2_FIELD.text] = text;
  return new StubRecord(fields);
}

describe("WP14 — `text: \"\"` is a legal empty text card", () => {
  it("a text node whose `text` is the empty string is VALID", () => {
    expect(validateNodeIngest(textNode(""), "local").valid).toBe(true);
    expect(validateNodeIngest(textNode(""), "remote").valid).toBe(true);
  });

  it("any string satisfies `text` — whitespace and non-empty alike", () => {
    for (const value of ["", " ", "\n", "hello world"]) {
      expect(validateNodeIngest(textNode(value), "local").valid).toBe(true);
    }
  });

  it("the tolerant object form (real Y.Text) is still accepted", () => {
    // Unattached on purpose — the validator must not need a Y.Doc, and must not
    // know what a Y.Text is (AC4 purity); it only sees a non-null, non-array
    // object.
    expect(validateNodeIngest(textNode(new Y.Text("")), "local").valid).toBe(true);
    expect(validateNodeIngest(textNode(new Y.Text("hi")), "local").valid).toBe(true);
  });

  it("arrays and null stay INVALID, and stay distinguishable from a missing key", () => {
    for (const illTyped of [null, [], ["a"], 7, true]) {
      const verdict = validateNodeIngest(textNode(illTyped), "local");
      expect(verdict.valid).toBe(false);
      if (verdict.valid) throw new Error("unreachable");
      expect(verdict.reason).toBe("INVALID_TYPE_SPECIFIC");
    }

    // AC2's subject, untouched: missing key != present-but-ill-typed.
    const missing = validateNodeIngest(textNode(undefined, false), "local");
    expect(missing.valid).toBe(false);
    if (missing.valid) throw new Error("unreachable");
    expect(missing.reason).toBe("MISSING_TYPE_SPECIFIC");
  });

  it("`file` and `url` KEEP the non-empty requirement — the loosening does not leak sideways", () => {
    const base = {
      [V2_FIELD.id]: "n2",
      [V2_FIELD.pos]: encodePos(0, 0),
      [V2_FIELD.size]: encodeSize(100, 100),
    };

    const emptyFile = validateNodeIngest(
      new StubRecord({ ...base, [V2_FIELD.type]: "file", [V2_FIELD.file]: "" }),
      "local",
    );
    expect(emptyFile.valid).toBe(false);
    if (emptyFile.valid) throw new Error("unreachable");
    expect(emptyFile.reason).toBe("INVALID_TYPE_SPECIFIC");

    const emptyUrl = validateNodeIngest(
      new StubRecord({ ...base, [V2_FIELD.type]: "link", [V2_FIELD.url]: "" }),
      "local",
    );
    expect(emptyUrl.valid).toBe(false);
    if (emptyUrl.valid) throw new Error("unreachable");
    expect(emptyUrl.reason).toBe("INVALID_TYPE_SPECIFIC");

    // ...and the non-empty forms of both are still valid.
    expect(
      validateNodeIngest(
        new StubRecord({ ...base, [V2_FIELD.type]: "file", [V2_FIELD.file]: "notes/a.md" }),
        "local",
      ).valid,
    ).toBe(true);
    expect(
      validateNodeIngest(
        new StubRecord({ ...base, [V2_FIELD.type]: "link", [V2_FIELD.url]: "https://x.test" }),
        "local",
      ).valid,
    ).toBe(true);
  });

  it("a type absent from the type-specific table (group) carries no further requirement", () => {
    const group = new StubRecord({
      [V2_FIELD.id]: "g1",
      [V2_FIELD.type]: "group",
      [V2_FIELD.pos]: encodePos(0, 0),
      [V2_FIELD.size]: encodeSize(400, 300),
    });

    expect(validateNodeIngest(group, "local").valid).toBe(true);
  });
});
