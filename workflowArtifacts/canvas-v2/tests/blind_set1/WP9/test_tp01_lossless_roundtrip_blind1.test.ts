// WP9 AC1 — same guarantee, attacked from the file-record angle: build a
// `.canvas`-shaped node object, push it through the register codec into a
// `Y.Map`, then rebuild a file-shaped object purely from what the module reads
// back. Different value set from the visible test (boundary-scale integers,
// a zero-size record, and a coordinate pair that straddles the origin).

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

interface FileNode {
  x: number;
  y: number;
  width: number;
  height: number;
}

const FILE_NODES: readonly FileNode[] = [
  { x: 999999, y: -999999, width: 1, height: 1 },
  { x: 0, y: 0, width: 0, height: 0 },
  { x: -1, y: -1, width: 3000, height: 2 },
  { x: 500000, y: 500000, width: 500000, height: 500000 },
];

function toFileShape(record: Y.Map<unknown>): FileNode {
  const pos = readPos(record);
  const size = readSize(record);
  if (!pos || !size) throw new Error("expected pos and size to be readable");
  return { x: pos.x, y: pos.y, width: size.width, height: size.height };
}

describe("WP9 AC1 — file-record round trip through the register codec", () => {
  it("rebuilds an identical file-shaped node after a write/read cycle, for every case", () => {
    const doc = new Y.Doc();
    const nodes = doc.getMap<Y.Map<unknown>>("nodes");

    FILE_NODES.forEach((node, index) => {
      const record = new Y.Map<unknown>();
      nodes.set(`n${index}`, record);
      writePos(record, node.x, node.y);
      writeSize(record, node.width, node.height);

      expect(toFileShape(record)).toEqual(node);
    });

    doc.destroy();
  });

  it("the pure codec agrees with the wired write/read path on the same data", () => {
    for (const node of FILE_NODES) {
      const codecPos = decodePos(encodePos(node.x, node.y));
      const codecSize = decodeSize(encodeSize(node.width, node.height));
      expect(codecPos).toEqual({ x: node.x, y: node.y });
      expect(codecSize).toEqual({ width: node.width, height: node.height });
    }
  });
});
