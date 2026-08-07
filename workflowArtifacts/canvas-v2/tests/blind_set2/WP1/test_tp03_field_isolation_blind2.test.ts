// WP1 / AC2 (first half) — field isolation as a model-based property.
//
// Angle of attack: instead of hand-picked assertions, a seeded generator (a plain
// LCG — deterministic, no `Math.random`, no clock) drives 200 single-field
// advances over a 12-field record, while the test keeps its own trivial reference
// model in a plain object. After EVERY step the whole record must equal the model.
//
// This catches the failure modes example tests miss: a stale-write-back after N
// advances, an off-by-one in an internal copy, or a "last advance wins for the
// whole record" bug that only shows once two different fields are touched in a
// row.

import { describe, expect, it } from "vitest";

import {
  type ShadowFieldValue,
  advanceField,
  advanceRecord,
  createSurfaceShadow,
  getField,
  getRecordFields,
} from "../../../canvas/canvas-shadow";

const PATH = "Planung/Roadmap 2026.canvas";
const ID = "card-0";

const FIELD_NAMES = [
  "x",
  "y",
  "width",
  "height",
  "type",
  "text",
  "color",
  "file",
  "subpath",
  "url",
  "background",
  "backgroundStyle",
] as const;

const INITIAL: Record<string, ShadowFieldValue> = {
  x: 0,
  y: 0,
  width: 250,
  height: 60,
  type: "file",
  text: "",
  color: null,
  file: "Notes/a.md",
  subpath: "#Heading",
  url: "https://example.invalid/x",
  background: "bg.png",
  backgroundStyle: "cover",
};

/** Deterministic 32-bit LCG — the test's only source of "randomness". */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

function valueFor(step: number, field: string): ShadowFieldValue {
  switch (step % 4) {
    case 0:
      return step;
    case 1:
      return `${field}#${step}`;
    case 2:
      return step % 8 === 2;
    default:
      return null;
  }
}

describe("WP1 AC2 — 200 single-field advances never disturb a sibling", () => {
  it("matches an independent reference model after every step", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", ID, INITIAL);

    const model: Record<string, ShadowFieldValue> = { ...INITIAL };
    const next = lcg(20260731);

    for (let step = 0; step < 200; step += 1) {
      const field = FIELD_NAMES[next() % FIELD_NAMES.length];
      const value = valueFor(step, field);

      if (step % 7 === 3) {
        // Every seventh step arrives as a PARTIAL multi-field observation: it must
        // upsert its own two fields and delete nothing else (I7).
        const other = FIELD_NAMES[next() % FIELD_NAMES.length];
        const patch = { [field]: value, [other]: `${other}@${step}` };
        advanceRecord(shadow, PATH, "node", ID, patch);
        Object.assign(model, patch);
      } else {
        advanceField(shadow, PATH, "node", ID, field, value);
        model[field] = value;
      }

      expect(getRecordFields(shadow, PATH, "node", ID)).toEqual(model);
    }

    // The field set never grew or shrank: advances only ever rewrite values here.
    expect(Object.keys(getRecordFields(shadow, PATH, "node", ID) ?? {}).sort()).toEqual(
      [...FIELD_NAMES].sort(),
    );
  });

  it("interleaving two fields keeps both last-written values", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", ID, INITIAL);

    for (let step = 1; step <= 25; step += 1) {
      advanceField(shadow, PATH, "node", ID, "x", step * 10);
      advanceField(shadow, PATH, "node", ID, "y", step * -10);
    }

    expect(getField(shadow, PATH, "node", ID, "x")).toBe(250);
    expect(getField(shadow, PATH, "node", ID, "y")).toBe(-250);
    expect(getField(shadow, PATH, "node", ID, "width")).toBe(250);
    expect(getField(shadow, PATH, "node", ID, "text")).toBe("");
  });

  it("a field added late survives every later advance of other fields", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", ID, INITIAL);

    advanceField(shadow, PATH, "node", ID, "ord", "a0");
    for (const field of FIELD_NAMES) {
      advanceField(shadow, PATH, "node", ID, field, 1);
      expect(getField(shadow, PATH, "node", ID, "ord")).toBe("a0");
    }
  });
});
