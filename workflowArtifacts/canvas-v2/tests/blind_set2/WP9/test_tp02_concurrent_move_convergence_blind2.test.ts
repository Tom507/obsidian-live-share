// WP9 AC2 — same convergence guarantee, attacked through a relay topology: A
// and B never sync directly with each other, only through C. This is a
// distinct interleaving class from the full-mesh tests (visible + blind1):
// each writer's update reaches the other writer only after passing through a
// third party, which is exactly the shape a relay server delivers updates in
// production.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { readPos, writePos } from "../../../canvas/canvas-registers";

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

describe("WP9 AC2 — convergence holds when writers only ever meet through a relay peer", () => {
  it("A and B never sync directly; C relays both writes, and all three still agree on one whole value", () => {
    const a = new Y.Doc();
    writePos(record(a, "n1"), -7, 7);
    const b = new Y.Doc();
    push(a, b);
    const c = new Y.Doc();
    push(a, c);

    const submittedByA = { x: 3, y: 3 };
    const submittedByB = { x: -3, y: -3 };
    writePos(record(a, "n1"), submittedByA.x, submittedByA.y);
    writePos(record(b, "n1"), submittedByB.x, submittedByB.y);

    // Relay only — A and B are never pushed to each other directly.
    push(a, c);
    push(b, c);
    push(c, a);
    push(c, b);

    const posA = readPos(record(a, "n1"));
    const posB = readPos(record(b, "n1"));
    const posC = readPos(record(c, "n1"));

    expect(posA).toBeDefined();
    if (!posA) throw new Error("unreachable");
    expect(posB).toEqual(posA);
    expect(posC).toEqual(posA);

    const isSubmittedByA = posA.x === submittedByA.x && posA.y === submittedByA.y;
    const isSubmittedByB = posA.x === submittedByB.x && posA.y === submittedByB.y;
    expect(isSubmittedByA || isSubmittedByB).toBe(true);
    expect(posA).not.toEqual({ x: submittedByA.x, y: submittedByB.y });
    expect(posA).not.toEqual({ x: submittedByB.x, y: submittedByA.y });

    [a, b, c].forEach((doc) => doc.destroy());
  });
});
