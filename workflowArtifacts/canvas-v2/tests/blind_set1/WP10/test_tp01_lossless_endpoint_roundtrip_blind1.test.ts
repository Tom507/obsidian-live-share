// WP10 / AC1 — blind counterpart 1. Different angle from the visible test:
// round-trips through an actual JSON.stringify/JSON.parse cycle (the real
// `.canvas` file persistence boundary) instead of direct object comparison,
// and exercises TWO edges sharing one doc so a codec that leaks state
// between records would be caught. Different data vocabulary throughout.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  decodeEndpoint,
  encodeEndpoint,
  readFrom,
  readTo,
  writeFrom,
  writeTo,
} from "../../../../../plugin/src/canvas/canvas-registers";

const CASES: ReadonlyArray<{ node: string; side: string; end?: string }> = [
  { node: "cardA", side: "north" },
  { node: "cardB", side: "south", end: "circle" },
  { node: "cardC", side: "east", end: "diamond" },
  { node: "cardD", side: "west" },
];

describe("WP10 AC1 blind1 — round-trips through JSON persistence, across two edges", () => {
  it("survives JSON.stringify/JSON.parse of the decoded file shape for every case", () => {
    for (const { node, side, end } of CASES) {
      const persisted = JSON.parse(JSON.stringify(decodeEndpoint(encodeEndpoint(node, side, end))));
      expect(persisted).toEqual({ node, side, ...(end === undefined ? {} : { end }) });
      expect(Object.prototype.hasOwnProperty.call(persisted, "end")).toBe(end !== undefined);
    }
  });

  it("two edges in the same doc keep independent from/to state", () => {
    const doc = new Y.Doc();
    const edges = doc.getMap<Y.Map<unknown>>("edges");
    const e1 = new Y.Map<unknown>();
    const e2 = new Y.Map<unknown>();
    edges.set("e1", e1);
    edges.set("e2", e2);

    writeFrom(e1, "cardA", "north");
    writeTo(e1, "cardB", "south", "circle");
    writeFrom(e2, "cardC", "east", "diamond");
    writeTo(e2, "cardD", "west");

    expect(readFrom(e1)).toEqual({ node: "cardA", side: "north" });
    expect(readTo(e1)).toEqual({ node: "cardB", side: "south", end: "circle" });
    expect(readFrom(e2)).toEqual({ node: "cardC", side: "east", end: "diamond" });
    expect(readTo(e2)).toEqual({ node: "cardD", side: "west" });

    doc.destroy();
  });
});
