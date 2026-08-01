// WP1 / AC3 — the three states as a state machine, exercised over every transition.
//
// Angle of attack: the visible risk is that an implementation encodes "absent" as
// "present with zero fields", or "unknown" as "present with zero fields". Both
// collapse under a transition sequence, so this file drives the full transition
// table (unknown→present, unknown→absent, present→absent, absent→present,
// present→present, absent→absent) and asserts the reported state after each step
// — including the two idempotence cases.
//
// The records are edges, and the field payload is deliberately empty in one case
// (`advanceRecord(..., {})`), which is the exact shape a naive "no fields means
// absent" implementation gets wrong.

import { describe, expect, it } from "vitest";

import {
  type ShadowRecordKind,
  type SurfaceShadow,
  advanceField,
  advanceRecord,
  createSurfaceShadow,
  getRecordFields,
  getRecordState,
  markRecordAbsent,
} from "../../../canvas/canvas-shadow";

const PATH = "Karten/Zustände.canvas";

type Step = readonly [label: string, apply: (shadow: SurfaceShadow) => void, expected: string];

const KIND: ShadowRecordKind = "edge";
const ID = "e-state";

const TRANSITIONS: readonly Step[] = [
  ["initial", () => undefined, "unknown"],
  ["unknown → present", (s) => advanceField(s, PATH, KIND, ID, "label", "a"), "present"],
  ["present → present", (s) => advanceField(s, PATH, KIND, ID, "label", "b"), "present"],
  ["present → absent", (s) => markRecordAbsent(s, PATH, KIND, ID), "absent"],
  ["absent → absent", (s) => markRecordAbsent(s, PATH, KIND, ID), "absent"],
  ["absent → present", (s) => advanceRecord(s, PATH, KIND, ID, { fromNode: "x" }), "present"],
];

describe("WP1 AC3 — full state transition table", () => {
  it("reports the expected state after every transition", () => {
    const shadow = createSurfaceShadow();

    for (const [label, apply, expected] of TRANSITIONS) {
      apply(shadow);
      expect(`${label}=${getRecordState(shadow, PATH, KIND, ID)}`).toBe(`${label}=${expected}`);
    }
  });

  it("a record with an empty field set is `present`, not `absent` and not `unknown`", () => {
    const shadow = createSurfaceShadow();

    advanceRecord(shadow, PATH, "node", "empty", {});

    expect(getRecordState(shadow, PATH, "node", "empty")).toBe("present");
    expect(getRecordFields(shadow, PATH, "node", "empty")).toEqual({});
  });

  it("a record whose only known field is `null` is still `present`", () => {
    const shadow = createSurfaceShadow();

    advanceField(shadow, PATH, "node", "nulled", "color", null);

    expect(getRecordState(shadow, PATH, "node", "nulled")).toBe("present");
    expect(getRecordFields(shadow, PATH, "node", "nulled")).toEqual({ color: null });
  });

  it("marking absent is idempotent and does not resurrect the old field values", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "n1", { x: 4, y: 5 });

    markRecordAbsent(shadow, PATH, "node", "n1");
    markRecordAbsent(shadow, PATH, "node", "n1");
    markRecordAbsent(shadow, PATH, "node", "n1");

    expect(getRecordState(shadow, PATH, "node", "n1")).toBe("absent");
    expect(getRecordFields(shadow, PATH, "node", "n1")).toBeNull();

    advanceField(shadow, PATH, "node", "n1", "y", 5);
    expect(getRecordFields(shadow, PATH, "node", "n1")).toEqual({ y: 5 });
  });

  it("the state of one record says nothing about its neighbours", () => {
    const shadow = createSurfaceShadow();
    advanceRecord(shadow, PATH, "node", "a", { x: 1 });
    advanceRecord(shadow, PATH, "node", "b", { x: 2 });
    advanceRecord(shadow, PATH, "edge", "a", { fromNode: "a" });

    markRecordAbsent(shadow, PATH, "node", "a");

    expect(getRecordState(shadow, PATH, "node", "a")).toBe("absent");
    expect(getRecordState(shadow, PATH, "node", "b")).toBe("present");
    expect(getRecordState(shadow, PATH, "edge", "a")).toBe("present");
    expect(getRecordState(shadow, PATH, "edge", "b")).toBe("unknown");
  });
});
