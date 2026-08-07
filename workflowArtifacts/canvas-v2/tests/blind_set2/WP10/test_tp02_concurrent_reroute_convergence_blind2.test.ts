// WP10 / AC2 — blind counterpart 2. Different angle: ALL THREE replicas
// write `to` concurrently (not two writers plus one passive observer), so
// the convergence target is one of THREE submitted endpoints, not two —
// still never a torn mixture across any pair of them.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { endpointEquals, readTo, writeTo } from "../../../../../plugin/src/canvas/canvas-registers";

function push(from: Y.Doc, to: Y.Doc): void {
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)), "peer");
}

function record(doc: Y.Doc, id: string): Y.Map<unknown> {
  const edges = doc.getMap<Y.Map<unknown>>("edges");
  const existing = edges.get(id);
  if (existing) return existing;
  const created = new Y.Map<unknown>();
  edges.set(id, created);
  return created;
}

describe("WP10 AC2 blind2 — three-way concurrent re-routes converge to exactly one submission", () => {
  it("all three replicas agree on one of the three submitted `to` endpoints, never a mixture", () => {
    const a = new Y.Doc();
    writeTo(record(a, "e3"), "seed", "top");
    const b = new Y.Doc();
    push(a, b);
    const c = new Y.Doc();
    push(a, c);

    // A, B and C each re-route `to` CONCURRENTLY — none has seen either of
    // the other two writes yet.
    const submittedByA = { node: "gamma", side: "bottom", end: "none" };
    const submittedByB = { node: "delta", side: "top", end: "diamond" };
    const submittedByC = { node: "epsilon", side: "left" };
    writeTo(record(a, "e3"), submittedByA.node, submittedByA.side, submittedByA.end);
    writeTo(record(b, "e3"), submittedByB.node, submittedByB.side, submittedByB.end);
    writeTo(record(c, "e3"), submittedByC.node, submittedByC.side);

    // Full mesh merge.
    push(a, b);
    push(b, a);
    push(a, c);
    push(c, a);
    push(b, c);
    push(c, b);

    const toA = readTo(record(a, "e3"));
    const toB = readTo(record(b, "e3"));
    const toC = readTo(record(c, "e3"));

    expect(toA).toBeDefined();
    if (!toA) throw new Error("unreachable");

    // (a) every replica agrees.
    expect(toB).toEqual(toA);
    expect(toC).toEqual(toA);

    // (b) the result is a member of the submitted set of THREE.
    const submissions = [submittedByA, submittedByB, submittedByC];
    const isOneOfTheSubmitted = submissions.some((s) => endpointEquals(toA, s));
    expect(isOneOfTheSubmitted).toBe(true);

    // (c) it is not a torn combination that borrows fields across authors.
    expect(toA).not.toEqual({
      node: submittedByA.node,
      side: submittedByB.side,
      end: submittedByC.end,
    });
    expect(toA).not.toEqual({
      node: submittedByC.node,
      side: submittedByA.side,
      end: submittedByB.end,
    });

    [a, b, c].forEach((doc) => doc.destroy());
  });
});
