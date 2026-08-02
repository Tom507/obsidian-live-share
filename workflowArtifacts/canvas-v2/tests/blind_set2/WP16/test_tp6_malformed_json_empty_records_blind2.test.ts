// WP16 AC4 blind2 — same claim, different angle: `nodes`/`edges` present but
// holding the WRONG TYPE (a string, a number) rather than an array. Same
// "never throw, degrade to empty" contract, exercised through yet another
// branch of the type guard.

import { describe, expect, it } from "vitest";

import { parseCanvas } from "../../../../../plugin/src/files/canvas-sync";

describe("WP16 AC4 blind2 — nodes/edges holding a non-array value still yields empty records", () => {
  it("nodes as a string and edges as a number both degrade to empty rather than throwing", () => {
    const content = JSON.stringify({ nodes: "not-an-array", edges: 42 });
    expect(() => parseCanvas(content)).not.toThrow();

    const data = parseCanvas(content);
    expect(data.nodes).toEqual({});
    expect(data.edges).toEqual({});
    expect(data.order.nodes).toEqual([]);
    expect(data.order.edges).toEqual([]);
  });

  it("a null top-level value does not throw and yields empty output", () => {
    expect(() => parseCanvas("null")).not.toThrow();
    const data = parseCanvas("null");
    expect(data.nodes).toEqual({});
    expect(data.edges).toEqual({});
  });
});
