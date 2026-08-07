// WP16 AC4 blind1 — same claim, different angle: syntactically VALID JSON
// whose top-level shape is wrong (a bare array instead of an object with
// `nodes`/`edges`). This does not throw during `JSON.parse` itself, so it
// exercises the `Array.isArray(parsed.nodes)` style guard rather than the
// try/catch — a different code path toward the same "never throw, degrade to
// empty" contract.

import { describe, expect, it } from "vitest";

import { parseCanvas } from "../../../../../plugin/src/files/canvas-sync";

describe("WP16 AC4 blind1 — valid JSON with the wrong top-level shape still yields empty records", () => {
  it("a bare JSON array (no nodes/edges keys at all) does not throw and yields empty output", () => {
    expect(() => parseCanvas("[]")).not.toThrow();
    const data = parseCanvas("[]");
    expect(data.nodes).toEqual({});
    expect(data.edges).toEqual({});
    expect(data.order.nodes).toEqual([]);
    expect(data.order.edges).toEqual([]);
  });

  it("a JSON object with neither nodes nor edges keys does not throw and yields empty output", () => {
    const data = parseCanvas(JSON.stringify({ unrelated: true }));
    expect(data.nodes).toEqual({});
    expect(data.edges).toEqual({});
  });
});
