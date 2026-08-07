// WP10 / AC2 — two concurrent re-routes of the same endpoint converge to
// exactly ONE OF the two submitted endpoints on every replica — never one
// author's `node` with another's `side` (or `end`).
//
// Yjs breaks a same-key concurrent tie on `clientID`, which is
// `random.uint32()` at doc creation — so this test never asserts WHICH of
// the two endpoints wins. It asserts only: (a) every replica agrees, (b) the
// agreed value is one of the two submitted endpoints IN FULL, and (c) it is
// not a torn combination of the two (Shared Ownership Contract §4).
//
// Three replicas, not two — interleaving classes from three peers upward are
// distinct even when only two of them write.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { endpointEquals, readTo, writeTo } from "../../../canvas/canvas-registers";

/** One-way replication, as the relay would deliver it. */
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

describe("WP10 AC2 — concurrent re-routes converge to one submitted endpoint, never a mixture", () => {
  it("all three replicas agree, and the agreement is one whole submitted `to` endpoint", () => {
    const a = new Y.Doc();
    writeTo(record(a, "e1"), "anchor", "top", "arrow");

    const b = new Y.Doc();
    push(a, b);
    const c = new Y.Doc();
    push(a, c);

    // Confirm the common starting point really did propagate.
    expect(readTo(record(b, "e1"))).toEqual({ node: "anchor", side: "top", end: "arrow" });
    expect(readTo(record(c, "e1"))).toEqual({ node: "anchor", side: "top", end: "arrow" });

    // A and B each re-route `to` CONCURRENTLY — neither has seen the other's
    // write yet. C stays passive and only ever receives.
    const submittedByA = { node: "nA", side: "left", end: "none" };
    const submittedByB = { node: "nB", side: "bottom", end: "arrow" };
    writeTo(record(a, "e1"), submittedByA.node, submittedByA.side, submittedByA.end);
    writeTo(record(b, "e1"), submittedByB.node, submittedByB.side, submittedByB.end);

    // Full mesh merge.
    push(a, c);
    push(b, c);
    push(a, b);
    push(b, a);
    push(c, a);
    push(c, b);

    const toA = readTo(record(a, "e1"));
    const toB = readTo(record(b, "e1"));
    const toC = readTo(record(c, "e1"));

    expect(toA).toBeDefined();
    if (!toA) throw new Error("unreachable");

    // (a) every replica agrees.
    expect(toB).toEqual(toA);
    expect(toC).toEqual(toA);

    // (b) the result is a member of the submitted set.
    const isOneOfTheSubmitted =
      endpointEquals(toA, submittedByA) || endpointEquals(toA, submittedByB);
    expect(isOneOfTheSubmitted).toBe(true);

    // (c) it is not a torn combination — rule out a representative sample of
    // the mixed combinations across the three fields (node/side/end).
    expect(toA).not.toEqual({
      node: submittedByA.node,
      side: submittedByB.side,
      end: submittedByA.end,
    });
    expect(toA).not.toEqual({
      node: submittedByB.node,
      side: submittedByA.side,
      end: submittedByB.end,
    });
    expect(toA).not.toEqual({
      node: submittedByA.node,
      side: submittedByA.side,
      end: submittedByB.end,
    });
    expect(toA).not.toEqual({
      node: submittedByB.node,
      side: submittedByB.side,
      end: submittedByA.end,
    });

    [a, b, c].forEach((doc) => doc.destroy());
  });
});
