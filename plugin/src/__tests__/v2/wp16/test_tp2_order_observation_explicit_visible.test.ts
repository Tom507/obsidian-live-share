// WP16 / AC1 (part 2) — "... and preserves array order as an explicit
// observation instead of discarding it."
//
// Today `parseCanvas` returns `Record<string, ...>` keyed by id, so the
// file's array order is only INCIDENTALLY visible (JS object key iteration
// order for non-numeric string keys), never asserted, and easy to lose the
// moment anything sorts or rebuilds the map. AC1 requires order to be an
// EXPLICIT field of the return value. This test picks ids whose alphabetical
// order is the exact REVERSE of their file-array order, so an implementation
// that silently fell back to `Object.keys(...).sort()` (or any alphabetical
// derivation) instead of a real captured array-order observation is caught
// immediately.

import { describe, expect, it } from "vitest";

import { parseCanvas } from "../../../files/canvas-sync";

describe("WP16 AC1 — parseCanvas exposes an explicit order observation", () => {
  it("data.order.nodes is the exact file-array order, not an alphabetical derivation", () => {
    const content = JSON.stringify({
      nodes: [
        { id: "z-third-alpha-first", x: 0, y: 0, width: 1, height: 1, type: "text", text: "1" },
        { id: "m-second-alpha-mid", x: 1, y: 1, width: 1, height: 1, type: "text", text: "2" },
        { id: "a-first-alpha-last", x: 2, y: 2, width: 1, height: 1, type: "text", text: "3" },
      ],
      edges: [],
    });

    const data = parseCanvas(content);

    expect(data.order.nodes).toEqual([
      "z-third-alpha-first",
      "m-second-alpha-mid",
      "a-first-alpha-last",
    ]);
    // Sanity: the picked ids really are alphabetically the reverse of the
    // file order, so a sorted-keys fallback would have failed the assertion
    // above rather than passing it by coincidence.
    expect([...data.order.nodes].sort()).not.toEqual(data.order.nodes);
  });

  it("data.order.edges is the exact file-array order, independently of node order", () => {
    const content = JSON.stringify({
      nodes: [
        { id: "n1", x: 0, y: 0, width: 1, height: 1, type: "text", text: "A" },
        { id: "n2", x: 1, y: 1, width: 1, height: 1, type: "text", text: "B" },
      ],
      edges: [
        { id: "z-edge", fromNode: "n1", fromSide: "right", toNode: "n2", toSide: "left" },
        { id: "a-edge", fromNode: "n2", fromSide: "right", toNode: "n1", toSide: "left" },
      ],
    });

    const data = parseCanvas(content);

    expect(data.order.edges).toEqual(["z-edge", "a-edge"]);
  });
});
