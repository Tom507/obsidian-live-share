// WP9 / AC3 — a concurrent move and resize of the same node both survive: the
// winner of `pos` and the winner of `size` are decided independently.
//
// Unlike AC2, this is NOT a same-key tie: `pos` has exactly one concurrent
// writer (A) and `size` has exactly one concurrent writer (B), so pinning the
// exact resulting value is legitimate here — each register has a single
// causal author, not a same-key race.
//
// Three replicas: A moves, B resizes, C stays passive and only observes the
// merge — proving the independence holds for a bystander too, not just for
// the two authors.

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

describe("WP9 AC3 — concurrent move and resize both survive, decided independently", () => {
  it("the mover's pos and the resizer's size both land, on every replica", () => {
    const a = new Y.Doc();
    writePos(record(a, "n1"), 0, 0);
    writeSize(record(a, "n1"), 100, 100);
    const b = new Y.Doc();
    push(a, b);
    const c = new Y.Doc();
    push(a, c);

    // A moves only. B resizes only. Concurrent — neither has seen the other's
    // write when it makes its own.
    writePos(record(a, "n1"), 50, 60);
    writeSize(record(b, "n1"), 200, 150);

    // Full mesh merge.
    push(a, c);
    push(b, c);
    push(a, b);
    push(b, a);
    push(c, a);
    push(c, b);

    for (const doc of [a, b, c]) {
      expect(readPos(record(doc, "n1"))).toEqual({ x: 50, y: 60 });
      expect(readSize(record(doc, "n1"))).toEqual({ width: 200, height: 150 });
    }

    [a, b, c].forEach((doc) => doc.destroy());
  });
});
