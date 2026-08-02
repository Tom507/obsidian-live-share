// WP10 / AC3 — blind counterpart 2. Different angle: independence is
// exercised across TWO SUCCESSIVE concurrent rounds with roles reversed the
// second time, proving from/to independence is not a one-shot property of
// the register but holds every time re-routing recurs.

import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  readFrom,
  readTo,
  writeFrom,
  writeTo,
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

function fullMeshMerge(a: Y.Doc, b: Y.Doc, c: Y.Doc): void {
  push(a, c);
  push(b, c);
  push(a, b);
  push(b, a);
  push(c, a);
  push(c, b);
}

describe("WP10 AC3 blind2 — from/to independence holds across two successive concurrent rounds", () => {
  it("round 1 (A:from, B:to) and round 2 (C:from, A:to) both leave both changes intact", () => {
    const a = new Y.Doc();
    writeFrom(record(a, "e5"), "s0", "top");
    writeTo(record(a, "e5"), "e0", "bottom");
    const b = new Y.Doc();
    push(a, b);
    const c = new Y.Doc();
    push(a, c);

    // Round 1: A re-routes from, B re-routes to.
    writeFrom(record(a, "e5"), "s1", "left");
    writeTo(record(b, "e5"), "e1", "right");
    fullMeshMerge(a, b, c);

    for (const doc of [a, b, c]) {
      expect(readFrom(record(doc, "e5"))).toEqual({ node: "s1", side: "left" });
      expect(readTo(record(doc, "e5"))).toEqual({ node: "e1", side: "right" });
    }

    // Round 2: roles reversed — C re-routes from, A re-routes to. Neither
    // has seen the other's round-2 write yet; both branch from the
    // post-round-1 converged state.
    writeFrom(record(c, "e5"), "s2", "bottom", "arrow");
    writeTo(record(a, "e5"), "e2", "top", "diamond");
    fullMeshMerge(a, b, c);

    for (const doc of [a, b, c]) {
      expect(readFrom(record(doc, "e5"))).toEqual({ node: "s2", side: "bottom", end: "arrow" });
      expect(readTo(record(doc, "e5"))).toEqual({ node: "e2", side: "top", end: "diamond" });
    }

    [a, b, c].forEach((doc) => doc.destroy());
  });
});
