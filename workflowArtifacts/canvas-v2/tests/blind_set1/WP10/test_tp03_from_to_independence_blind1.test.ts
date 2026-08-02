// WP10 / AC3 — blind counterpart 1. Different angle: swaps which replica
// edits which endpoint (B re-routes `from`, A re-routes `to` — the opposite
// assignment from the visible test) and varies `end` presence across the
// two edits.

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

describe("WP10 AC3 blind1 — roles swapped: B re-routes from, A re-routes to, independently", () => {
  it("B's from and A's to both land, on every replica", () => {
    const a = new Y.Doc();
    writeFrom(record(a, "e4"), "s0", "top");
    writeTo(record(a, "e4"), "e0", "bottom", "arrow");
    const b = new Y.Doc();
    push(a, b);
    const c = new Y.Doc();
    push(a, c);

    // A re-routes `to` only (end omitted this time). B re-routes `from`
    // only. Concurrent — neither has seen the other's write yet.
    writeTo(record(a, "e4"), "newEnd", "right");
    writeFrom(record(b, "e4"), "newStart", "left", "diamond");

    push(a, c);
    push(b, c);
    push(a, b);
    push(b, a);
    push(c, a);
    push(c, b);

    for (const doc of [a, b, c]) {
      expect(readFrom(record(doc, "e4"))).toEqual({ node: "newStart", side: "left", end: "diamond" });
      expect(readTo(record(doc, "e4"))).toEqual({ node: "newEnd", side: "right" });
    }

    [a, b, c].forEach((doc) => doc.destroy());
  });
});
