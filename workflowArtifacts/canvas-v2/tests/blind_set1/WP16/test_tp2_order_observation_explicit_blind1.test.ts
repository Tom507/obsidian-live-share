// WP16 AC1 blind1 — same claim as the visible test (explicit, non-derived
// order observation), different angle: numeric-looking string ids. JS engines
// special-case "array index" string keys on a plain object/Record — an
// all-digit key is iterated in ASCENDING NUMERIC order regardless of
// insertion order, which is exactly the kind of accidental "order" AC1 says
// must NOT be what callers rely on. Using ids like "10", "2", "1" in a
// deliberately non-numeric file order both exercises that trap and proves
// `order.nodes` is a real captured array, not a read of key iteration order.

import { describe, expect, it } from "vitest";

import { parseCanvas } from "../../../../../plugin/src/files/canvas-sync";

describe("WP16 AC1 blind1 — order observation survives integer-like key ids", () => {
  it("data.order.nodes keeps file order even though object key iteration would renumber it", () => {
    const content = JSON.stringify({
      nodes: [
        { id: "10", x: 0, y: 0, width: 1, height: 1, type: "text", text: "ten" },
        { id: "2", x: 1, y: 1, width: 1, height: 1, type: "text", text: "two" },
        { id: "1", x: 2, y: 2, width: 1, height: 1, type: "text", text: "one" },
      ],
      edges: [],
    });

    const data = parseCanvas(content);

    // A plain object's key iteration would yield ["1", "2", "10"] (ascending
    // integer-index order) for these exact keys — the observation must NOT.
    expect(data.order.nodes).toEqual(["10", "2", "1"]);
    expect(Object.keys(data.nodes)).not.toEqual(data.order.nodes);
  });

  it("re-parsing the same content twice yields the same explicit order both times", () => {
    const content = JSON.stringify({
      nodes: [
        { id: "10", x: 0, y: 0, width: 1, height: 1, type: "text", text: "ten" },
        { id: "2", x: 1, y: 1, width: 1, height: 1, type: "text", text: "two" },
        { id: "1", x: 2, y: 2, width: 1, height: 1, type: "text", text: "one" },
      ],
      edges: [],
    });

    const first = parseCanvas(content);
    const second = parseCanvas(content);

    expect(second.order.nodes).toEqual(first.order.nodes);
  });
});
