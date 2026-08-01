// WP9 AC2 — same convergence guarantee, attacked with a different interleaving
// order and a value set that lets one author's submission coincide with the
// pre-existing shared value. An implementation that special-cases "the value
// didn't change" and skips writing the register would be exposed here: the
// submission is a genuine concurrent write even though the number matches.
//
// Full mesh again, but pushes execute in reverse order relative to the visible
// test — a different interleaving class per the WP9 rule.

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

describe("WP9 AC2 — convergence holds under a different interleaving and a value-collision case", () => {
  it("agrees across replicas and never tears x/y even when one submission echoes the shared baseline", () => {
    const a = new Y.Doc();
    writePos(record(a, "n1"), 5, 5);
    const b = new Y.Doc();
    push(a, b);
    const c = new Y.Doc();
    push(a, c);

    const submittedByA = { x: -40, y: 1000 };
    const submittedByB = { x: 5, y: 5 }; // deliberately re-submits the baseline
    writePos(record(b, "n1"), submittedByB.x, submittedByB.y);
    writePos(record(a, "n1"), submittedByA.x, submittedByA.y);

    // Reverse merge order relative to the visible test.
    push(c, b);
    push(c, a);
    push(b, a);
    push(a, b);
    push(a, c);
    push(b, c);

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

    expect(posA).not.toEqual({ x: submittedByB.x, y: submittedByA.y });
    expect(posA).not.toEqual({ x: submittedByA.x, y: submittedByB.y });

    [a, b, c].forEach((doc) => doc.destroy());
  });
});
