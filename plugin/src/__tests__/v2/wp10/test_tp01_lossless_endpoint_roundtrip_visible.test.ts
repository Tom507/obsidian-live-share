// WP10 / AC1 — `from` and `to` each round-trip losslessly to and from the
// `.canvas` file representation, including the optional `end` component.
//
// Same two angles as WP9's tp01: the pure codec (encode/decode, no Yjs at
// all) and the same round trip wired through an actual `Y.Map` record via
// write/read, so a codec that is correct in isolation but never actually
// reaches the doc is still caught. Both directions (`from` and `to`) are
// exercised, and `end` is varied across present / absent so an
// implementation that only handles the mandatory `node`/`side` pair — and
// silently drops or stores a stray `end` — is caught too.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  decodeEndpoint,
  encodeEndpoint,
  readFrom,
  readTo,
  writeFrom,
  writeTo,
} from "../../../canvas/canvas-registers";

const ENDPOINT_CASES: ReadonlyArray<{ node: string; side: string; end?: string }> = [
  { node: "n1", side: "top", end: "none" },
  { node: "n2", side: "bottom" }, // end omitted — must round-trip as absent, not a stored `undefined`
  { node: "n3", side: "left", end: "arrow" },
  { node: "n4", side: "right" },
];

describe("WP10 AC1 — from/to codec round-trips losslessly, including optional end", () => {
  it("decodeEndpoint(encodeEndpoint(...)) reproduces node/side/end exactly for every case", () => {
    for (const { node, side, end } of ENDPOINT_CASES) {
      const roundTripped = decodeEndpoint(encodeEndpoint(node, side, end));
      expect(roundTripped).toEqual({ node, side, ...(end === undefined ? {} : { end }) });
      expect("end" in roundTripped).toBe(end !== undefined);
    }
  });

  it("survives a real write/read cycle through a Y.Map record for `from`, not just the pure codec", () => {
    const doc = new Y.Doc();
    const edges = doc.getMap<Y.Map<unknown>>("edges");
    const record = new Y.Map<unknown>();
    edges.set("e1", record);

    for (const { node, side, end } of ENDPOINT_CASES) {
      writeFrom(record, node, side, end);
      const read = readFrom(record);
      expect(read).toEqual({ node, side, ...(end === undefined ? {} : { end }) });
      expect(read !== undefined && "end" in read).toBe(end !== undefined);
    }

    doc.destroy();
  });

  it("survives a real write/read cycle through a Y.Map record for `to`, independently of `from`", () => {
    const doc = new Y.Doc();
    const edges = doc.getMap<Y.Map<unknown>>("edges");
    const record = new Y.Map<unknown>();
    edges.set("e1", record);

    // `from` is set once, up front, and must be untouched by every `to`
    // write below — this test is about the `to` round trip, not about
    // cross-key interference (AC3 owns the concurrent version of that).
    writeFrom(record, "anchor", "top", "arrow");

    for (const { node, side, end } of ENDPOINT_CASES) {
      writeTo(record, node, side, end);
      const read = readTo(record);
      expect(read).toEqual({ node, side, ...(end === undefined ? {} : { end }) });
    }

    expect(readFrom(record)).toEqual({ node: "anchor", side: "top", end: "arrow" });

    doc.destroy();
  });
});
