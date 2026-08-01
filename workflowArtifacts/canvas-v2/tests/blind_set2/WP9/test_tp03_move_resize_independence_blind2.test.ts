// WP9 AC3 — same independence guarantee, but this time `pos` is ALSO a
// genuine two-way tie (A and C both move concurrently) while `size` keeps its
// single author (B). This proves size's independence holds even when pos is
// simultaneously resolving its own AC2-style race — the two registers must
// not interfere with each other's resolution.
//
// Because pos now has two concurrent authors, its exact winner is NOT
// asserted (Yjs breaks same-key ties on a random clientID) — only convergence
// and membership. size keeps a single causal author (B), so its value IS
// asserted directly.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { readPos, readSize, writePos, writeSize } from "../../../canvas/canvas-registers";

function push(from: Y.Doc, to: Y.Doc): void {
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)), "peer");
}

function record(doc: Y.Doc, id: string): Y.Map<unknown> {
  const nodes = doc.getMap<Y.Map<unknown>>("nodes");
  const existing = nodes.get(id);
  if (existing) return existing;
  const created = new Y.Map<unknown>();
  nodes.set(id, created);
  return created;
}

describe("WP9 AC3 — size independence survives a simultaneous pos race", () => {
  it("size always converges to B's submission regardless of who wins the concurrent pos race", () => {
    const a = new Y.Doc();
    writePos(record(a, "n1"), 1, 1);
    writeSize(record(a, "n1"), 10, 10);
    const b = new Y.Doc();
    push(a, b);
    const c = new Y.Doc();
    push(a, c);

    const posByA = { x: 500, y: 500 };
    const posByC = { x: -500, y: -500 };
    const sizeByB = { width: 77, height: 88 };

    writePos(record(a, "n1"), posByA.x, posByA.y);
    writePos(record(c, "n1"), posByC.x, posByC.y);
    writeSize(record(b, "n1"), sizeByB.width, sizeByB.height);

    // Full mesh merge.
    push(a, b);
    push(a, c);
    push(b, a);
    push(b, c);
    push(c, a);
    push(c, b);

    const sizes = [a, b, c].map((doc) => readSize(record(doc, "n1")));
    for (const size of sizes) expect(size).toEqual(sizeByB);

    const positions = [a, b, c].map((doc) => readPos(record(doc, "n1")));
    const first = positions[0];
    expect(first).toBeDefined();
    if (!first) throw new Error("unreachable");
    for (const pos of positions) expect(pos).toEqual(first);

    const isPosByA = first.x === posByA.x && first.y === posByA.y;
    const isPosByC = first.x === posByC.x && first.y === posByC.y;
    expect(isPosByA || isPosByC).toBe(true);
    // Not a mixture of the two pos submissions.
    expect(first).not.toEqual({ x: posByA.x, y: posByC.y });
    expect(first).not.toEqual({ x: posByC.x, y: posByA.y });

    [a, b, c].forEach((doc) => doc.destroy());
  });
});
