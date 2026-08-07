// WP9 AC1 — same guarantee, attacked from the wire angle: the value is written
// on one replica, serialised as a Yjs update, applied to a completely separate
// replica, and only THEN decoded. A codec that relies on object identity or a
// value type that does not survive `encodeStateAsUpdate`/`applyUpdate` (e.g. an
// object instead of the mandated array) would fail here even though a same-doc
// round trip could still pass.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { readPos, readSize, writePos, writeSize } from "../../../canvas/canvas-registers";

const CASES = [
  { x: 7, y: -7, width: 42, height: 42 },
  { x: -8192, y: 8191, width: 1, height: 16384 },
  { x: 2, y: 3, width: 5, height: 8 },
];

describe("WP9 AC1 — pos/size survive a cross-replica wire round trip", () => {
  it("decodes on a fresh replica exactly what was written on the origin replica", () => {
    for (const [index, { x, y, width, height }] of CASES.entries()) {
      const origin = new Y.Doc();
      const originRecord = new Y.Map<unknown>();
      origin.getMap<Y.Map<unknown>>("nodes").set(`n${index}`, originRecord);
      writePos(originRecord, x, y);
      writeSize(originRecord, width, height);

      const replica = new Y.Doc();
      Y.applyUpdate(replica, Y.encodeStateAsUpdate(origin));
      const replicaRecord = replica.getMap<Y.Map<unknown>>("nodes").get(`n${index}`);
      expect(replicaRecord).toBeDefined();
      if (!replicaRecord) throw new Error("unreachable");

      expect(readPos(replicaRecord)).toEqual({ x, y });
      expect(readSize(replicaRecord)).toEqual({ width, height });

      origin.destroy();
      replica.destroy();
    }
  });
});
