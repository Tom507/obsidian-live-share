// WP10 / AC5 — a SIDE-LESS endpoint is a first-class, representable endpoint.
//
// `fromSide` / `toSide` are OPTIONAL in the JSON Canvas format. Before this
// pin, the module required a whole `{node, side}` pair: `encodeEndpoint` threw
// on an absent side, `encodeEndpointFromFile` returned `undefined` unless both
// keys were non-empty, and `isEndpointRegister` read a side-less value back as
// ABSENT. A fully-connected, perfectly legal edge therefore had no
// representable V2 endpoint — it read as dangling, was refused at ingest, and
// the write-back then deleted it from the user's own `.canvas` file.
//
// The three predicates AC5 names are pinned here, plus the property the whole
// defect turned on: the TWO ABSENCES MUST STAY DISTINGUISHABLE. A register that
// is absent (no endpoint — dangling) and a register that is present with no
// side (attached, side unspecified — legal) are different states, and
// `hasBothEndpoints` must answer differently for them.
//
// What is NOT relaxed, and is asserted here so a future edit cannot quietly
// trade one for the other: atomicity. `{node, side?, end?}` is still ONE LWW
// register holding ONE value (AC4) — optionality is a property of the value's
// SHAPE, never of the write granularity.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  decodeEndpoint,
  decodeEndpointToFile,
  encodeEndpoint,
  encodeEndpointFromFile,
  hasBothEndpoints,
  isEndpointRegister,
  readFrom,
  readTo,
  writeFrom,
  writeTo,
} from "../../../canvas/canvas-registers";

describe("WP10 AC5 — a side-less endpoint is a first-class, representable endpoint", () => {
  it("encodeEndpoint builds a complete, frozen register from a node alone", () => {
    const endpoint = encodeEndpoint("n1");

    expect(endpoint).toEqual({ node: "n1" });
    expect(Object.isFrozen(endpoint)).toBe(true);
    // Absent means the KEY IS OMITTED — never `null`, never `""`, never a key
    // that exists holding `undefined`.
    expect("side" in endpoint).toBe(false);
    expect("end" in endpoint).toBe(false);

    // `end` remains independently optional alongside an absent side.
    const withEnd = encodeEndpoint("n1", undefined, "arrow");
    expect(withEnd).toEqual({ node: "n1", end: "arrow" });
    expect("side" in withEnd).toBe(false);
  });

  it("encodeEndpoint normalises an empty/null side to an omitted key, but still refuses an empty node", () => {
    const encode = encodeEndpoint as (node: unknown, side?: unknown, end?: unknown) => unknown;

    for (const absent of [undefined, null, ""]) {
      expect(encode("n1", absent)).toEqual({ node: "n1" });
      expect(encode("n1", "top", absent)).toEqual({ node: "n1", side: "top" });
    }

    // `node` alone decides presence — a register with no node is not a
    // register, and that refusal is unchanged.
    expect(() => encode(undefined)).toThrow();
    expect(() => encode("")).toThrow();
    expect(() => encode(null)).toThrow();
  });

  it("carries an unrecognised side through verbatim and opaquely — WP10 does not validate the vocabulary", () => {
    // A forward-compatible file, or a newer Obsidian, may name a side this
    // build has never heard of. Preserving it is the difference between a
    // round trip and silent information loss.
    const exotic = encodeEndpoint("n1", "top-left-ish", "diamond-tail");
    expect(exotic.side).toBe("top-left-ish");
    expect(decodeEndpoint(exotic)).toEqual({
      node: "n1",
      side: "top-left-ish",
      end: "diamond-tail",
    });
  });

  it("encodeEndpointFromFile builds the register whenever the *Node key is present and non-empty", () => {
    expect(encodeEndpointFromFile("from", { fromNode: "n1" })).toEqual({ node: "n1" });
    expect(encodeEndpointFromFile("to", { toNode: "n2" })).toEqual({ node: "n2" });

    // `*Side` / `*End` are taken only when present and usable; a malformed one
    // is dropped rather than voiding the whole endpoint.
    expect(encodeEndpointFromFile("from", { fromNode: "n1", fromSide: "" })).toEqual({
      node: "n1",
    });
    expect(encodeEndpointFromFile("from", { fromNode: "n1", fromSide: null })).toEqual({
      node: "n1",
    });
    expect(encodeEndpointFromFile("from", { fromNode: "n1", fromEnd: "arrow" })).toEqual({
      node: "n1",
      end: "arrow",
    });
    expect(encodeEndpointFromFile("from", { fromNode: "n1", fromSide: "top" })).toEqual({
      node: "n1",
      side: "top",
    });

    // A missing or empty `*Node` is still no endpoint at all.
    expect(encodeEndpointFromFile("from", { fromSide: "top" })).toBeUndefined();
    expect(encodeEndpointFromFile("from", { fromNode: "", fromSide: "top" })).toBeUndefined();
    expect(encodeEndpointFromFile("to", {})).toBeUndefined();
  });

  it("round-trips to the file with the *Side key ABSENT — never null, never empty string", () => {
    const fileFields = decodeEndpointToFile("from", encodeEndpoint("n1"));

    expect(fileFields).toEqual({ fromNode: "n1" });
    expect("fromSide" in fileFields).toBe(false);
    expect("fromEnd" in fileFields).toBe(false);

    // File → doc → file reproduces the original record exactly.
    const original = { toNode: "n2" };
    const register = encodeEndpointFromFile("to", original);
    expect(register).toBeDefined();
    if (register === undefined) throw new Error("unreachable");
    expect(decodeEndpointToFile("to", register)).toEqual(original);

    // And the same round trip with a side present is untouched.
    const withSide = { toNode: "n2", toSide: "left", toEnd: "arrow" };
    const withSideRegister = encodeEndpointFromFile("to", withSide);
    if (withSideRegister === undefined) throw new Error("unreachable");
    expect(decodeEndpointToFile("to", withSideRegister)).toEqual(withSide);
  });

  it("isEndpointRegister decides presence on `node` alone, side/end optional-when-present", () => {
    expect(isEndpointRegister({ node: "n1" })).toBe(true);
    expect(isEndpointRegister({ node: "n1", end: "arrow" })).toBe(true);
    expect(isEndpointRegister({ node: "n1", side: "top" })).toBe(true);

    // No node → not a register.
    expect(isEndpointRegister({ side: "top" })).toBe(false);
    expect(isEndpointRegister({ node: "" })).toBe(false);
    expect(isEndpointRegister({ node: 1 })).toBe(false);

    // Present-but-wrong-type is still ABSENT, not partial — this is the read
    // door that must stay shut.
    expect(isEndpointRegister({ node: "n1", side: 2 })).toBe(false);
    expect(isEndpointRegister({ node: "n1", side: {} })).toBe(false);
    expect(isEndpointRegister({ node: "n1", end: 3 })).toBe(false);
    expect(isEndpointRegister({ node: "n1", side: ["top"] })).toBe(false);
  });

  it("keeps the two absences distinguishable: register absent vs. register present with no side", () => {
    const doc = new Y.Doc();
    const edges = doc.getMap<Y.Map<unknown>>("edges");

    // (a) DANGLING — `to` was never written. The edge has no second endpoint.
    const dangling = new Y.Map<unknown>();
    edges.set("dangling", dangling);
    writeFrom(dangling, "n1", "right");
    expect(readTo(dangling)).toBeUndefined();
    expect(hasBothEndpoints(dangling)).toBe(false);

    // (b) ATTACHED, SIDE UNSPECIFIED — a legal JSON Canvas edge. Present.
    const sideless = new Y.Map<unknown>();
    edges.set("sideless", sideless);
    writeFrom(sideless, "n1");
    writeTo(sideless, "n2");
    expect(readFrom(sideless)).toEqual({ node: "n1" });
    expect(readTo(sideless)).toEqual({ node: "n2" });
    expect(hasBothEndpoints(sideless)).toBe(true);

    // (c) MIXED — one side named, one not. Still both endpoints.
    const mixed = new Y.Map<unknown>();
    edges.set("mixed", mixed);
    writeFrom(mixed, "n1", "right");
    writeTo(mixed, "n2");
    expect(hasBothEndpoints(mixed)).toBe(true);

    doc.destroy();
  });

  it("survives a real Y.Map write/read cycle and stays ONE atomic register", () => {
    const doc = new Y.Doc();
    const edges = doc.getMap<Y.Map<unknown>>("edges");
    const record = new Y.Map<unknown>();
    edges.set("e1", record);

    writeFrom(record, "n1");

    // Atomicity (AC4) is untouched by AC5: the whole endpoint lives under ONE
    // doc key, so no `fromNode` / `fromSide` sub-keys exist to tear.
    expect([...record.keys()]).toEqual(["from"]);
    expect(record.get("fromNode")).toBeUndefined();
    expect(record.get("fromSide")).toBeUndefined();

    const read = readFrom(record);
    expect(read).toEqual({ node: "n1" });
    expect(read !== undefined && "side" in read).toBe(false);

    // Replacing the whole value is still the only way to change it — a
    // side-less register is replaced by a sided one wholesale.
    writeFrom(record, "n1", "top");
    expect(readFrom(record)).toEqual({ node: "n1", side: "top" });
    expect([...record.keys()]).toEqual(["from"]);

    doc.destroy();
  });
});
