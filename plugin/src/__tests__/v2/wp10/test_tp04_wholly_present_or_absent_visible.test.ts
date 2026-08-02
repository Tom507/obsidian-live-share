// WP10 / AC4 — an endpoint register is either wholly present or wholly
// absent; a partially populated endpoint cannot be constructed through the
// module's API.
//
// Three angles, matching the charter's "test the API surface, not what
// someone could force by writing raw keys":
//   1. The constructor (`encodeEndpoint`) refuses to build a value with no
//      `node` even when a caller bypasses the TypeScript signature — the
//      guarantee this test wants is a RUNTIME one, not merely a
//      compile-time one (a compile-time-only guarantee is not falsifiable
//      by a test that runs).
//   2. The read boundary (`isEndpointRegister` / `asEndpointRegister`)
//      treats a value with only `side`, or with a wrong-typed component, as
//      absent rather than partial, exactly as WP9's `isPosRegister` treats a
//      torn pair as absent rather than half-read.
//   3. The module exports no per-component setter (`writeFromNode`, etc.)
//      that would let a caller build one field of an endpoint at a time —
//      the only route to a stored endpoint is a whole value.
//
// AMENDED 2026-08-02 (WP10 AC5, Worker 2's E1 ruling). `side` and `end` are
// OPTIONAL components of the one register and `node` alone decides presence, so
// the assertions that treated a side-less endpoint as half-populated were
// asserting the defect. They are re-pointed at the empty-`node` refusal and the
// side-less-is-PRESENT reading. Nothing else in this file is weakened: AC4's
// subject — no partial CONSTRUCTION, no per-component setter, no half-read of a
// wrong-typed value — is asserted exactly as strictly as before.

import { describe, expect, it } from "vitest";

import * as CanvasRegisters from "../../../canvas/canvas-registers";
import {
  asEndpointRegister,
  encodeEndpoint,
  isEndpointRegister,
} from "../../../canvas/canvas-registers";

describe("WP10 AC4 — an endpoint register is wholly present or wholly absent", () => {
  it("encodeEndpoint refuses to construct an endpoint with no node even past a TS bypass", () => {
    // Cast away the compile-time signature to simulate a caller that got an
    // `any`/untyped value from JSON, a form, or another untrusted boundary —
    // exactly the situation AC4's runtime guarantee exists for.
    const encode = encodeEndpoint as (node: unknown, side?: unknown, end?: unknown) => unknown;

    expect(() => encode(undefined, "top")).toThrow();
    expect(() => encode("", "top")).toThrow();
    expect(() => encode(null, "top")).toThrow();
    expect(() => encode(7, "top")).toThrow();

    // A wrong-TYPED optional component is still a caller error — optional is
    // not "optionally garbage".
    expect(() => encode("n1", 7)).toThrow();
    expect(() => encode("n1", "top", 7)).toThrow();

    // The legitimate shapes do not throw. AC5: `node` alone is a complete
    // construction — an absent side is an absence, not a half-endpoint.
    expect(() => encodeEndpoint("n1", "top")).not.toThrow();
    expect(() => encodeEndpoint("n1", "top", "arrow")).not.toThrow();
    expect(() => encodeEndpoint("n1")).not.toThrow();
    expect(() => encode("n1", undefined)).not.toThrow();
    expect(() => encode("n1", "")).not.toThrow();

    // ...and an absent side is stored as the KEY BEING OMITTED, never as `""`
    // or `null`, so the file can never gain a meaningless `fromSide: ""`.
    expect(encodeEndpoint("n1")).toEqual({ node: "n1" });
    expect("side" in encodeEndpoint("n1")).toBe(false);
    expect(encode("n1", "")).toEqual({ node: "n1" });
  });

  it("isEndpointRegister / asEndpointRegister treat a value with only side as absent, and a side-less node as PRESENT", () => {
    expect(isEndpointRegister({ side: "top" })).toBe(false);
    expect(isEndpointRegister({ end: "arrow" })).toBe(false);
    expect(isEndpointRegister({ side: "top", end: "arrow" })).toBe(false);
    expect(isEndpointRegister({})).toBe(false);
    expect(isEndpointRegister({ node: "" })).toBe(false);

    expect(isEndpointRegister({ node: "n1", side: "top" })).toBe(true);
    expect(isEndpointRegister({ node: "n1", side: "top", end: "arrow" })).toBe(true);

    // AC5 — `node` alone decides presence; `side`/`end` are optional.
    expect(isEndpointRegister({ node: "n1" })).toBe(true);
    expect(isEndpointRegister({ node: "n1", end: "arrow" })).toBe(true);

    expect(asEndpointRegister({ side: "top" })).toBeUndefined();
    expect(asEndpointRegister({ node: "" })).toBeUndefined();
    expect(asEndpointRegister({ node: "n1", side: "top" })).toEqual({ node: "n1", side: "top" });
    expect(asEndpointRegister({ node: "n1" })).toEqual({ node: "n1" });
  });

  it("isEndpointRegister rejects wrong-typed fields and non-object values, not just missing keys", () => {
    expect(isEndpointRegister(undefined)).toBe(false);
    expect(isEndpointRegister(null)).toBe(false);
    expect(isEndpointRegister("n1")).toBe(false);
    expect(isEndpointRegister({ node: 1, side: "top" })).toBe(false);
    expect(isEndpointRegister({ node: "n1", side: 2 })).toBe(false);
    expect(isEndpointRegister({ node: "n1", side: "top", end: 3 })).toBe(false);
  });

  it("exports no per-component setter — the only construction route is a whole endpoint", () => {
    const partialWriteNames = [
      "writeFromNode",
      "writeFromSide",
      "writeFromEnd",
      "writeToNode",
      "writeToSide",
      "writeToEnd",
      "setFromNode",
      "setFromSide",
      "setToNode",
      "setToSide",
    ];
    for (const name of partialWriteNames) {
      expect(name in CanvasRegisters).toBe(false);
    }
  });
});
