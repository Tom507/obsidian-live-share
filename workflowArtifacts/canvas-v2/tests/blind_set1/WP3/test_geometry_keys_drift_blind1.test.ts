import { describe, expect, it } from "vitest";

import {
  CANONICAL_EDGE_KEY_ORDER,
  CANONICAL_GEOMETRY_KEYS,
  CANONICAL_NODE_KEY_ORDER,
  roundCanvasGeometry,
} from "../../../canvas/canvas-canonical";
import { GEOMETRY_KEYS, PROTECTED_KEYS } from "../../../files/canvas-sync";

// Hard constraint — `GEOMETRY_KEYS` keeps exactly {x, y, width, height} and
// stays exported, and the canonical module's private mirror must not drift.
// Angle: BEHAVIOURAL drift detection — derive the test data from the exported
// set at runtime, so a member added to one set and not the other is caught by
// what the helper DOES, not only by what the constant says.

type Rec = Record<string, unknown>;

describe("geometry key sets do not drift apart", () => {
  it("rounds every key the exported GEOMETRY_KEYS declares", () => {
    const record: Rec = { id: "n1" };
    for (const key of GEOMETRY_KEYS) record[key] = 41.6;

    const out = roundCanvasGeometry(record);

    for (const key of GEOMETRY_KEYS) expect(out[key]).toBe(42);
  });

  it("rounds nothing outside GEOMETRY_KEYS", () => {
    const outsiders = [...PROTECTED_KEYS].filter((key) => !GEOMETRY_KEYS.has(key));
    const record: Rec = { id: "n1", text: 41.6, color: 41.6, label: 41.6 };
    for (const key of outsiders) record[key] = 41.6;

    const out = roundCanvasGeometry(record);

    expect(outsiders.length).toBeGreaterThan(0);
    for (const key of outsiders) expect(out[key]).toBe(41.6);
    expect(out.text).toBe(41.6);
    expect(out.color).toBe(41.6);
  });

  it("keeps the two sets identical, both ways round", () => {
    for (const key of GEOMETRY_KEYS) expect(CANONICAL_GEOMETRY_KEYS.has(key)).toBe(true);
    for (const key of CANONICAL_GEOMETRY_KEYS) expect(GEOMETRY_KEYS.has(key)).toBe(true);
    expect(CANONICAL_GEOMETRY_KEYS.size).toBe(GEOMETRY_KEYS.size);
    expect(GEOMETRY_KEYS.size).toBe(4);
  });

  it("declares canonical key orders that are duplicate-free and free of P1 fields", () => {
    for (const order of [CANONICAL_NODE_KEY_ORDER, CANONICAL_EDGE_KEY_ORDER]) {
      expect(new Set(order).size).toBe(order.length);
      for (const p1Field of ["ord", "pos", "size", "from", "to", "schemaVersion"]) {
        expect(order).not.toContain(p1Field);
      }
    }
    // The node order carries the file-schema geometry; the edge order must not.
    for (const key of CANONICAL_GEOMETRY_KEYS) {
      expect(CANONICAL_NODE_KEY_ORDER).toContain(key);
      expect(CANONICAL_EDGE_KEY_ORDER).not.toContain(key);
    }
  });
});
