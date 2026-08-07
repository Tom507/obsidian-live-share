// WP10 / AC4 + AC5 — blind counterpart 2. Different angle: attacks the
// ABSENCE-vs-WRONG-TYPE boundary of the two optional components, and checks
// that one endpoint's state on a record never leaks into the OTHER endpoint's
// independent read — wholeness is a property of each register, not of the
// record as a whole.
//
// RE-PINNED 2026-08-02 (WP10 AC5, Worker 2's E1 ruling). Three assertions here
// pinned the retired rule and are re-pointed, none of them weakened:
//
//   ├── `end: null` was asserted REJECTED. `""` / `null` / `undefined` are now
//   │   ABSENCES of an optional component, so the register stays PRESENT and
//   │   simply carries no `end`. The test now pins the sharper line the
//   │   implementation must draw: an ABSENT optional component keeps the
//   │   register present, a WRONG-TYPED one still voids it entirely.
//   ├── a raw `{node: "half"}` was asserted ABSENT. It is a legal side-less
//   │   endpoint; the isolation probe is re-pointed at a genuinely absent
//   │   register (no `node`) and additionally pins that the two absences do not
//   │   collapse into each other.
//   └── `encodeEndpoint("n1", null)` was asserted to THROW. An absent side is
//       not a caller error; the constructor probe now pins that `node` is still
//       mandatory past a TS bypass, that an absence normalises to the key being
//       OMITTED, and that a wrong-TYPED component still throws.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  asEndpointRegister,
  encodeEndpoint,
  hasBothEndpoints,
  isEndpointRegister,
  readFromRegister,
  readToRegister,
  writeToRegister,
} from "../../../../../plugin/src/canvas/canvas-registers";

describe("WP10 AC4/AC5 blind2 — absence and wrong type are different things", () => {
  it("an ABSENT optional component keeps the register present; a WRONG-TYPED one voids it", () => {
    // `""` / `null` / `undefined` all mean "the file did not say".
    expect(isEndpointRegister({ node: "n9", side: "right", end: null })).toBe(true);
    expect(isEndpointRegister({ node: "n9", side: "right", end: "" })).toBe(true);
    expect(isEndpointRegister({ node: "n9", side: "right", end: undefined })).toBe(true);
    expect(isEndpointRegister({ node: "n9", side: null })).toBe(true);
    expect(isEndpointRegister({ node: "n9", side: "" })).toBe(true);
    expect(asEndpointRegister({ node: "n9", side: "right", end: null })).toBeDefined();

    // Anything that is neither an absence nor a string is a wrong-typed
    // component, and it makes the WHOLE register absent — half-reading is how a
    // torn endpoint gets back in through the read door.
    expect(isEndpointRegister({ node: "n9", side: "right", end: 0 })).toBe(false);
    expect(isEndpointRegister({ node: "n9", side: "right", end: {} })).toBe(false);
    expect(isEndpointRegister({ node: "n9", side: "right", end: [] })).toBe(false);
    expect(isEndpointRegister({ node: "n9", side: "right", end: false })).toBe(false);
    expect(isEndpointRegister({ node: "n9", side: 0 })).toBe(false);
    expect(asEndpointRegister({ node: "n9", side: "right", end: 0 })).toBeUndefined();

    // `node` is not optional under any reading: no node, no register.
    expect(isEndpointRegister({ side: "right", end: "arrow" })).toBe(false);
    expect(isEndpointRegister({ node: "", side: "right" })).toBe(false);
    expect(isEndpointRegister({ node: null, side: "right" })).toBe(false);
    expect(isEndpointRegister({ node: 9 })).toBe(false);
    expect(asEndpointRegister({ side: "right" })).toBeUndefined();
  });

  it("an ABSENT `from` and a side-less `from` are both isolated from a wholly-written `to`", () => {
    const doc = new Y.Doc();
    const edges = doc.getMap<Y.Map<unknown>>("edges");
    const record = new Y.Map<unknown>();
    edges.set("e9", record);

    // A genuinely ABSENT `from`: no node, so the edge is dangling.
    record.set("from", { side: "bottom" });
    // `to` is written through the real API and must be entirely unaffected by
    // the sibling key's state.
    writeToRegister(record, encodeEndpoint("whole", "bottom", "arrow"));

    expect(readFromRegister(record)).toBeUndefined();
    expect(readToRegister(record)).toEqual({ node: "whole", side: "bottom", end: "arrow" });
    expect(hasBothEndpoints(record)).toBe(false);

    // The mirrored case, and the one the defect got wrong: `from` PRESENT with
    // no side. It must not read as the absence above, and it must not drag the
    // well-formed `to` down with it.
    record.set("from", { node: "half" });
    expect(readFromRegister(record)).toEqual({ node: "half" });
    expect(readToRegister(record)).toEqual({ node: "whole", side: "bottom", end: "arrow" });
    expect(hasBothEndpoints(record)).toBe(true);

    doc.destroy();
  });

  it("encodeEndpoint still refuses a missing node past a TS bypass, and still refuses a wrong-typed component", () => {
    const encode = encodeEndpoint as (node: unknown, side?: unknown, end?: unknown) => unknown;

    // `node` is mandatory — unchanged by AC5.
    expect(() => encode(null, "top")).toThrow();
    expect(() => encode(undefined, "top")).toThrow();
    expect(() => encode("", "top")).toThrow();
    expect(() => encode(4, "top")).toThrow();

    // An ABSENT side/end is not a caller error, and normalises to the key being
    // OMITTED — so the file can never gain a meaningless `fromSide: null`.
    expect(() => encode("n1", null)).not.toThrow();
    expect(encode("n1", null)).toEqual({ node: "n1" });
    expect("side" in (encode("n1", null) as object)).toBe(false);
    expect(encode("n1", "left", null)).toEqual({ node: "n1", side: "left" });
    expect("end" in (encode("n1", "left", "") as object)).toBe(false);

    // A WRONG-TYPED component still is a caller error.
    expect(() => encode("n1", 5)).toThrow();
    expect(() => encode("n1", "left", { end: "arrow" })).toThrow();
    expect(() => encode("n1", ["left"])).toThrow();
  });
});
