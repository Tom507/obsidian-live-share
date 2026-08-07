// WP9 / AC2 — two concurrent moves of the same node converge to exactly ONE OF
// the two submitted positions on every replica, never a mixture of one
// author's x with another's y.
//
// Yjs breaks a same-key concurrent tie on `clientID`, which is `random.uint32()`
// at doc creation — so this test never asserts WHICH of the two positions wins.
// It asserts only: (a) every replica agrees, (b) the agreed value is one of the
// two submitted positions in full, and (c) it is not a torn combination.
//
// Three replicas, not two — per the WP9 test-design rules, interleaving classes
// from three peers upward are distinct even when only two of them write.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { posEquals, readPos, writePos } from "../../../canvas/canvas-registers";

/** One-way replication, as the relay would deliver it. */
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

describe("WP9 AC2 — concurrent moves converge to one submitted position, never a mixture", () => {
  it("all three replicas agree, and the agreement is one whole submitted position", () => {
    const a = new Y.Doc();
    writePos(record(a, "n1"), 0, 0);

    const b = new Y.Doc();
    push(a, b);
    const c = new Y.Doc();
    push(a, c);

    // Confirm the common starting point really did propagate.
    expect(readPos(record(b, "n1"))).toEqual({ x: 0, y: 0 });
    expect(readPos(record(c, "n1"))).toEqual({ x: 0, y: 0 });

    // A and B each move the node CONCURRENTLY — neither has seen the other's
    // write yet. C stays passive and only ever receives.
    const submittedByA = { x: 10, y: 20 };
    const submittedByB = { x: 99, y: -5 };
    writePos(record(a, "n1"), submittedByA.x, submittedByA.y);
    writePos(record(b, "n1"), submittedByB.x, submittedByB.y);

    // Full mesh merge.
    push(a, c);
    push(b, c);
    push(a, b);
    push(b, a);
    push(c, a);
    push(c, b);

    const posA = readPos(record(a, "n1"));
    const posB = readPos(record(b, "n1"));
    const posC = readPos(record(c, "n1"));

    expect(posA).toBeDefined();
    if (!posA) throw new Error("unreachable");

    // (a) every replica agrees.
    expect(posB).toEqual(posA);
    expect(posC).toEqual(posA);

    // (b) the result is a member of the submitted set.
    const encodedA: readonly [number, number] = [submittedByA.x, submittedByA.y];
    const encodedB: readonly [number, number] = [submittedByB.x, submittedByB.y];
    const encodedResult: readonly [number, number] = [posA.x, posA.y];
    const isOneOfTheSubmitted =
      posEquals(encodedResult, encodedA) || posEquals(encodedResult, encodedB);
    expect(isOneOfTheSubmitted).toBe(true);

    // (c) it is not a mixture — explicitly rule out the two torn combinations.
    expect(posA).not.toEqual({ x: submittedByA.x, y: submittedByB.y });
    expect(posA).not.toEqual({ x: submittedByB.x, y: submittedByA.y });

    [a, b, c].forEach((doc) => doc.destroy());
  });
});
