// WP9 AC4 — same pin, attacked from the doc-storage angle: after writePos /
// writeSize, the raw Y.Map record's own top-level keys must be the register
// keys (`pos`, `size`), never the flattened file keys directly. If an
// implementation wrote `x`/`y`/`width`/`height` straight onto the record (the
// exact torn-write shape C9 exists to eliminate) this test fails even though a
// naive decode-based check might still pass.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { writePos, writeSize } from "../../../canvas/canvas-registers";
import { GEOMETRY_KEYS } from "../../../files/canvas-sync";

describe("WP9 AC4 — the doc never stores the flattened geometry keys directly", () => {
  it("a record written through the register module carries no top-level x/y/width/height keys", () => {
    const doc = new Y.Doc();
    const record = new Y.Map<unknown>();
    doc.getMap<Y.Map<unknown>>("nodes").set("n1", record);

    writePos(record, 15, 25);
    writeSize(record, 35, 45);

    const topLevelKeys = new Set([...record.keys()]);
    for (const geometryKey of GEOMETRY_KEYS) {
      expect(topLevelKeys.has(geometryKey)).toBe(false);
    }

    doc.destroy();
  });
});
