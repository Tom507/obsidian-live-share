// WP16 / AC4 (part 1) — "The existing failure behaviour is preserved: a JSON
// error yields empty records rather than throwing."
//
// Pre-existing behaviour that must not regress under the V2 rewrite. Also
// covers the new `order` field: on a parse failure there is nothing to
// observe, so the order arrays must be empty too, not merely the record maps.

import { describe, expect, it } from "vitest";

import { parseCanvas } from "../../../files/canvas-sync";

describe("WP16 AC4 — a JSON parse error yields empty records, never a throw", () => {
  it("syntactically invalid JSON returns empty nodes/edges and an empty order observation", () => {
    expect(() => parseCanvas("{not valid json")).not.toThrow();

    const data = parseCanvas("{not valid json");

    expect(data.nodes).toEqual({});
    expect(data.edges).toEqual({});
    expect(data.order.nodes).toEqual([]);
    expect(data.order.edges).toEqual([]);
  });

  it("an empty string is also handled without throwing", () => {
    expect(() => parseCanvas("")).not.toThrow();
    const data = parseCanvas("");
    expect(data.nodes).toEqual({});
    expect(data.edges).toEqual({});
  });
});
