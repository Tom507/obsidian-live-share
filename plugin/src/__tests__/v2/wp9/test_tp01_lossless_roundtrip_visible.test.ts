// WP9 / AC1 — `pos` and `size` round-trip losslessly to and from the `.canvas`
// file representation for integer geometry.
//
// Two angles in one file: the pure codec (encode/decode, no Yjs at all) and the
// same round trip wired through an actual `Y.Map` record via write/read, so a
// codec that is correct in isolation but never actually reaches the doc is
// still caught.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  decodePos,
  decodeSize,
  encodePos,
  encodeSize,
  readPos,
  readSize,
  writePos,
  writeSize,
} from "../../../canvas/canvas-registers";

const GEOMETRY_CASES: ReadonlyArray<{ x: number; y: number; width: number; height: number }> = [
  { x: 0, y: 0, width: 1, height: 1 },
  { x: 120, y: 340, width: 200, height: 100 },
  { x: -450, y: -12, width: 900, height: 700 },
  { x: -1, y: 1, width: 1, height: 1 },
];

describe("WP9 AC1 — pos/size codec round-trips losslessly for integer geometry", () => {
  it("decodePos(encodePos(x, y)) reproduces x and y exactly for every case", () => {
    for (const { x, y } of GEOMETRY_CASES) {
      const roundTripped = decodePos(encodePos(x, y));
      expect(roundTripped).toEqual({ x, y });
    }
  });

  it("decodeSize(encodeSize(width, height)) reproduces width and height exactly for every case", () => {
    for (const { width, height } of GEOMETRY_CASES) {
      const roundTripped = decodeSize(encodeSize(width, height));
      expect(roundTripped).toEqual({ width, height });
    }
  });

  it("survives a real write/read cycle through a Y.Map record, not just the pure codec", () => {
    const doc = new Y.Doc();
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");
    const record = new Y.Map<unknown>();
    nodes.set("n1", record);

    for (const { x, y, width, height } of GEOMETRY_CASES) {
      writePos(record, x, y);
      writeSize(record, width, height);

      expect(readPos(record)).toEqual({ x, y });
      expect(readSize(record)).toEqual({ width, height });
    }

    doc.destroy();
  });
});
