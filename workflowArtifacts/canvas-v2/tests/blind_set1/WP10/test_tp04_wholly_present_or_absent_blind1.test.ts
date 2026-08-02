// WP10 / AC4 + AC5 — blind counterpart 1. Different angle from the visible
// test: probes the DOC READ boundary directly. Raw endpoint values are written
// straight into a `Y.Map` record (simulating a hand-edited file, a V1 doc, or a
// buggy peer — bypassing the module's constructor entirely) and the read
// accessors must classify each one correctly. Also scans the module's exports
// dynamically for suspicious per-component setter names, instead of the visible
// test's fixed name list.
//
// RE-PINNED 2026-08-02 (WP10 AC5, Worker 2's E1 ruling). This file used to
// assert that a raw `{node: "orphan"}` reads back as ABSENT. That pinned the
// retired rule — `side` is now an OPTIONAL component of the one register and
// `node` ALONE decides presence, so a side-less endpoint is a complete, present,
// legal JSON Canvas endpoint. The assertion is re-pointed at the sharper
// property the defect actually violated: the TWO ABSENCES must stay
// distinguishable — a register that is *absent* (no `node`, the edge is
// dangling) versus one that is *present with no side* (attached, legal). Reading
// the second as the first was the entire loss path. Nothing is weakened: the
// no-`node` refusal, the wrong-typed-component rejection and the no-partial-
// setter scan are all still asserted, and `hasBothEndpoints` is now pinned too.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import * as CanvasRegisters from "../../../../../plugin/src/canvas/canvas-registers";
import {
  encodeEndpoint,
  hasBothEndpoints,
  readFromRegister,
  readToRegister,
  writeFromRegister,
  writeToRegister,
} from "../../../../../plugin/src/canvas/canvas-registers";

describe("WP10 AC4/AC5 blind1 — the doc read boundary keeps the two absences apart", () => {
  it("a raw side-less value reads back PRESENT; a raw node-less value reads back ABSENT", () => {
    const doc = new Y.Doc();
    const edges = doc.getMap<Y.Map<unknown>>("edges");
    const record = new Y.Map<unknown>();
    edges.set("e1", record);

    // Raw values written directly to the doc keys, bypassing the constructor.
    record.set("from", { node: "orphan" }); // attached, no side named -> PRESENT
    record.set("to", { side: "top" }); // no node at all           -> ABSENT

    expect(
      readFromRegister(record),
      "a side-less endpoint was read as absent — the E1 data-loss reading",
    ).toEqual({ node: "orphan" });
    expect(readToRegister(record), "a value with no node was read as an endpoint").toBeUndefined();

    // The distinction where it actually bites: this edge is dangling because
    // `to` has no node, NEVER because `from` named no side.
    expect(hasBothEndpoints(record)).toBe(false);

    // Give `to` a bare node too — still no side anywhere on this edge, and now
    // both endpoints are attached and the edge is fully connected.
    record.set("to", { node: "anchor" });
    expect(readToRegister(record)).toEqual({ node: "anchor" });
    expect(
      hasBothEndpoints(record),
      "a fully connected side-less edge was reported endpoint-less",
    ).toBe(true);

    doc.destroy();
  });

  it("optional is not 'optionally garbage' — a wrong-typed component voids the WHOLE register", () => {
    const doc = new Y.Doc();
    const edges = doc.getMap<Y.Map<unknown>>("edges");
    const record = new Y.Map<unknown>();
    edges.set("e2", record);

    record.set("from", { node: "n1", side: 90 }); // numeric side
    record.set("to", { node: "n2", end: ["arrow"] }); // array end

    expect(readFromRegister(record)).toBeUndefined();
    expect(readToRegister(record)).toBeUndefined();
    expect(hasBothEndpoints(record)).toBe(false);

    // A non-string `node` is not a node, and an empty one is still no node.
    record.set("from", { node: 7 });
    expect(readFromRegister(record)).toBeUndefined();
    record.set("from", { node: "" });
    expect(readFromRegister(record)).toBeUndefined();
    record.set("from", {});
    expect(readFromRegister(record)).toBeUndefined();

    doc.destroy();
  });

  it("a whole value written through the real constructor still reads back whole", () => {
    const doc = new Y.Doc();
    const edges = doc.getMap<Y.Map<unknown>>("edges");
    const record = new Y.Map<unknown>();
    edges.set("e3", record);

    writeFromRegister(record, encodeEndpoint("real", "left", "none"));
    expect(readFromRegister(record)).toEqual({ node: "real", side: "left", end: "none" });

    // AC5: `node` alone is a complete construction, and the absent components
    // are stored as the KEYS BEING OMITTED — never `""`, never `null`.
    writeToRegister(record, encodeEndpoint("bare"));
    const to = readToRegister(record);
    expect(to).toEqual({ node: "bare" });
    expect("side" in (to as object)).toBe(false);
    expect("end" in (to as object)).toBe(false);
    expect(hasBothEndpoints(record)).toBe(true);

    doc.destroy();
  });

  it("no exported function name matches a per-component setter pattern for from/to", () => {
    const suspiciousPattern = /^(write|set)(From|To)(Node|Side|End)$/;
    const offenders = Object.keys(CanvasRegisters).filter((name) => suspiciousPattern.test(name));
    expect(offenders).toEqual([]);
  });
});
