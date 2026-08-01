import { describe, expect, it } from "vitest";

import {
  CANONICAL_EDGE_KEY_ORDER,
  CANONICAL_NODE_KEY_ORDER,
  canonicalizeRecord,
} from "../../../canvas/canvas-canonical";

// ===========================================================================
// WP3 AC2 (first half) — "Object keys are emitted in the Obsidian-canonical
// order" (BUILD_SPEC §4.4: `id`, `type`, `x`/`y`, `width`/`height`, ...).
//
// Key order is the second half of byte determinism: even with the records in a
// fixed order, two clients whose Y.Maps were filled by different key sequences
// would still emit different bytes.
//
// Unknown / future keys must survive — canonicalisation is a reordering, never
// a filter — and they are appended after the known keys in UTF-16 code-unit
// order so their position is deterministic too.
// ===========================================================================

type Rec = Record<string, unknown>;

describe("WP3 AC2 — canonical key order", () => {
  it("emits a node's known keys in CANONICAL_NODE_KEY_ORDER regardless of input order", () => {
    const scrambled: Rec = {
      text: "hello",
      height: 60,
      color: "4",
      id: "n1",
      width: 250,
      y: -80,
      type: "text",
      x: 120,
    };

    const out = canonicalizeRecord(scrambled, "node");

    expect(Object.keys(out)).toEqual(["id", "type", "x", "y", "width", "height", "color", "text"]);
  });

  it("emits an edge's known keys in CANONICAL_EDGE_KEY_ORDER regardless of input order", () => {
    const scrambled: Rec = {
      label: "depends on",
      toSide: "left",
      color: "1",
      fromNode: "n1",
      id: "e1",
      toNode: "n2",
      fromSide: "right",
    };

    const out = canonicalizeRecord(scrambled, "edge");

    expect(Object.keys(out)).toEqual([
      "id",
      "fromNode",
      "fromSide",
      "toNode",
      "toSide",
      "color",
      "label",
    ]);
  });

  it("keeps every emitted key a subsequence of the declared canonical order", () => {
    const nodeKeys = Object.keys(
      canonicalizeRecord({ height: 1, id: "a", x: 2, file: "F.md", type: "file", y: 3, width: 4 }, "node"),
    );
    const positions = nodeKeys.map((k) => CANONICAL_NODE_KEY_ORDER.indexOf(k));

    expect(positions).not.toContain(-1);
    expect([...positions].sort((l, r) => l - r)).toEqual(positions);
  });

  it("appends unknown keys after the known ones, in UTF-16 code-unit order", () => {
    const out = canonicalizeRecord(
      { zeta: 1, id: "n1", Alpha: 2, type: "text", _beta: 3, x: 0, y: 0, width: 1, height: 1 },
      "node",
    );

    // "Alpha" (0x41) < "_beta" (0x5F) < "zeta" (0x7A) by code unit. A locale
    // collator would put "_beta" first and fold the case — that is exactly the
    // per-machine variation this ordering exists to exclude.
    expect(Object.keys(out)).toEqual([
      "id",
      "type",
      "x",
      "y",
      "width",
      "height",
      "Alpha",
      "_beta",
      "zeta",
    ]);
  });

  it("declares a duplicate-free order that starts with id and covers the file schema", () => {
    expect(CANONICAL_NODE_KEY_ORDER[0]).toBe("id");
    expect(CANONICAL_EDGE_KEY_ORDER[0]).toBe("id");
    expect(new Set(CANONICAL_NODE_KEY_ORDER).size).toBe(CANONICAL_NODE_KEY_ORDER.length);
    expect(new Set(CANONICAL_EDGE_KEY_ORDER).size).toBe(CANONICAL_EDGE_KEY_ORDER.length);
    for (const key of ["type", "x", "y", "width", "height"]) {
      expect(CANONICAL_NODE_KEY_ORDER).toContain(key);
    }
    for (const key of ["fromNode", "fromSide", "toNode", "toSide"]) {
      expect(CANONICAL_EDGE_KEY_ORDER).toContain(key);
    }
    // P0 has no `ord` — it must not appear in the file schema at all.
    expect(CANONICAL_NODE_KEY_ORDER).not.toContain("ord");
    expect(CANONICAL_EDGE_KEY_ORDER).not.toContain("ord");
  });
});
