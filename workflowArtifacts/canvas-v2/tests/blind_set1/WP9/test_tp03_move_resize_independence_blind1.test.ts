// WP9 AC3 — same independence guarantee, attacked through a relay topology (A
// and B never sync directly, only through C) and a different value set,
// including a shrink (negative delta) rather than a grow.

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

describe("WP9 AC3 — move/resize independence holds through a relay-only topology", () => {
  it("A's move and B's shrink both land on every replica, relayed only through C", () => {
    const a = new Y.Doc();
    writePos(record(a, "n1"), 300, 300);
    writeSize(record(a, "n1"), 400, 400);
    const b = new Y.Doc();
    push(a, b);
    const c = new Y.Doc();
    push(a, c);

    writePos(record(a, "n1"), -10, -20);
    writeSize(record(b, "n1"), 40, 25);

    // Relay only — A and B never sync directly with each other.
    push(a, c);
    push(b, c);
    push(c, a);
    push(c, b);

    for (const doc of [a, b, c]) {
      expect(readPos(record(doc, "n1"))).toEqual({ x: -10, y: -20 });
      expect(readSize(record(doc, "n1"))).toEqual({ width: 40, height: 25 });
    }

    [a, b, c].forEach((doc) => doc.destroy());
  });
});
