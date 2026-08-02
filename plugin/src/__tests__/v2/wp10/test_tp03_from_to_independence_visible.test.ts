// WP10 / AC3 — concurrent re-routing of `from` on one replica and `to` on
// another leaves both changes intact.
//
// Unlike AC2, this is NOT a same-key tie: `from` has exactly one concurrent
// writer (A) and `to` has exactly one concurrent writer (B), so pinning the
// exact resulting value is legitimate here — each register has a single
// causal author, not a same-key race (Shared Ownership Contract §4).
//
// Three replicas: A re-routes `from`, B re-routes `to`, C stays passive and
// only observes the merge — proving the independence holds for a bystander
// too, not just for the two authors.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { readFrom, readTo, writeFrom, writeTo } from "../../../canvas/canvas-registers";

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

describe("WP10 AC3 — concurrent from-reroute and to-reroute both survive, decided independently", () => {
  it("A's from and B's to both land, on every replica", () => {
    const a = new Y.Doc();
    writeFrom(record(a, "e1"), "start", "top");
    writeTo(record(a, "e1"), "end", "bottom");
    const b = new Y.Doc();
    push(a, b);
    const c = new Y.Doc();
    push(a, c);

    // A re-routes `from` only. B re-routes `to` only. Concurrent — neither
    // has seen the other's write when it makes its own.
    writeFrom(record(a, "e1"), "newStart", "left", "arrow");
    writeTo(record(b, "e1"), "newEnd", "right", "none");

    // Full mesh merge.
    push(a, c);
    push(b, c);
    push(a, b);
    push(b, a);
    push(c, a);
    push(c, b);

    for (const doc of [a, b, c]) {
      expect(readFrom(record(doc, "e1"))).toEqual({ node: "newStart", side: "left", end: "arrow" });
      expect(readTo(record(doc, "e1"))).toEqual({ node: "newEnd", side: "right", end: "none" });
    }

    [a, b, c].forEach((doc) => doc.destroy());
  });
});
