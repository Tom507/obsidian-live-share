// WP16 AC2 blind1 — same claim, different angle: TWO records appended in one
// step (not just one), so a fix that only handles "exactly one new tail
// record" is still caught. Also asserts the two new records preserve their
// OWN relative order (d before e) via compareOrd, not merely "both are new".

import { describe, expect, it } from "vitest";

import type { OrdIdEntry } from "../../../../../plugin/src/canvas/canvas-ord";
import { compareOrd } from "../../../../../plugin/src/canvas/canvas-ord";
import { deriveOrdAssignments, parseCanvas } from "../../../../../plugin/src/files/canvas-sync";

function node(id: string, n: number) {
  return { id, x: n, y: n, width: 10, height: 10, type: "text", text: id };
}

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

describe("WP16 AC2 blind1 — appending two records at once touches only those two", () => {
  it("appending 'd' and 'e' after ['a','b','c'] reassigns only d and e, in file order", () => {
    const rng = makeRng(9009);
    const before = parseCanvas(
      JSON.stringify({ nodes: [node("a", 1), node("b", 2), node("c", 3)], edges: [] }),
    );
    const baseline = deriveOrdAssignments([], before.order.nodes, "client-2", rng);
    const previous: OrdIdEntry[] = before.order.nodes.map((id) => ({ id, ord: baseline.get(id)! }));

    const after = parseCanvas(
      JSON.stringify({
        nodes: [node("a", 1), node("b", 2), node("c", 3), node("d", 4), node("e", 5)],
        edges: [],
      }),
    );

    const reassignments = deriveOrdAssignments(previous, after.order.nodes, "client-2", rng);

    expect(new Set(reassignments.keys())).toEqual(new Set(["d", "e"]));
    for (const id of ["a", "b", "c"]) {
      expect(reassignments.has(id)).toBe(false);
    }

    const cOrd = previous.find((entry) => entry.id === "c")!.ord;
    const dOrd = reassignments.get("d")!;
    const eOrd = reassignments.get("e")!;
    expect(compareOrd(cOrd, dOrd)).toBeLessThan(0);
    expect(compareOrd(dOrd, eOrd)).toBeLessThan(0);
  });
});
