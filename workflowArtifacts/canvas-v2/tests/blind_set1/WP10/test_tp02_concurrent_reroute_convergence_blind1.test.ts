// WP10 / AC2 — blind counterpart 1. Different angle: exercises `from`
// instead of `to`, and one of the two concurrent submissions OMITS `end`
// while the other includes it — a torn combination that borrows `end` from
// the WRONG author (or invents a stray one that neither author submitted)
// is a mixture just like a node/side swap is.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  endpointEquals,
  readFrom,
  writeFrom,
} from "../../../../../plugin/src/canvas/canvas-registers";

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

describe("WP10 AC2 blind1 — concurrent from-reroutes converge to one submitted endpoint, end included", () => {
  it("all three replicas agree on one whole submitted `from`, never a torn end", () => {
    const a = new Y.Doc();
    writeFrom(record(a, "e2"), "seed", "top");
    const b = new Y.Doc();
    push(a, b);
    const c = new Y.Doc();
    push(a, c);

    const submittedByA = { node: "alpha", side: "left" }; // end omitted
    const submittedByB = { node: "beta", side: "right", end: "arrow" };
    writeFrom(record(a, "e2"), submittedByA.node, submittedByA.side);
    writeFrom(record(b, "e2"), submittedByB.node, submittedByB.side, submittedByB.end);

    push(b, c);
    push(a, c);
    push(c, a);
    push(c, b);
    push(a, b);
    push(b, a);

    const fromA = readFrom(record(a, "e2"));
    const fromB = readFrom(record(b, "e2"));
    const fromC = readFrom(record(c, "e2"));

    expect(fromA).toBeDefined();
    if (!fromA) throw new Error("unreachable");
    expect(fromB).toEqual(fromA);
    expect(fromC).toEqual(fromA);

    const isOneOfTheSubmitted =
      endpointEquals(fromA, submittedByA) || endpointEquals(fromA, submittedByB);
    expect(isOneOfTheSubmitted).toBe(true);

    // A torn value that takes alpha's node/side but invents beta's end (or
    // vice versa) would be a mixture just as much as a node/side swap.
    expect(fromA).not.toEqual({
      node: submittedByA.node,
      side: submittedByA.side,
      end: submittedByB.end,
    });
    expect(fromA).not.toEqual({ node: submittedByB.node, side: submittedByB.side, end: undefined });

    [a, b, c].forEach((doc) => doc.destroy());
  });
});
