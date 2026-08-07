// WP27 / AC1 blind2 — the constructor read as a BOUNDARY between two keyspaces.
//
// Different angle again: instead of properties of the map, this test partitions
// a mixed corpus of 20 strings into "is a canvas doc id" and "is not", and
// compares the partition WHOLE. A per-row `not.toContain` is satisfied by an
// empty harness; a whole-partition `toEqual` names the survivors and therefore
// fails in both directions — an implementation that widened the namespace and
// one that narrowed it are both caught by the same assertion.
//
// The corpus deliberately contains near-misses that a `startsWith("__canvas")`
// or an `includes("__canvas__")` test would classify wrongly.

import { describe, expect, it } from "vitest";

import {
  EPOCH_KEY,
  GUID_KEY,
  PATH_KEY,
} from "../../../../../plugin/src/canvas/canvas-schema";
import {
  CANVAS_DOC_PREFIX,
  canvasDocId,
} from "../../../../../plugin/src/files/canvas-sync";

const GUID_A = "7c1e5b90f4a3416db2e08a6c33d19f52";
const GUID_B = "7c1e5b90f4a3416db2e08a6c33d19f53";

describe("WP27 AC1 blind2 — the canvas namespace is a boundary, not a habit", () => {
  it("the prefix is a strict prefix — nothing else in the id namespace shares it", () => {
    // `__manifest__` is the only other reserved doc id in this codebase.
    expect("__manifest__".startsWith(CANVAS_DOC_PREFIX)).toBe(false);
    expect(CANVAS_DOC_PREFIX.startsWith("__manifest__")).toBe(false);
    expect(CANVAS_DOC_PREFIX.endsWith(":")).toBe(true);
  });

  it("the whole partition, compared as one set", () => {
    const corpus = [
      canvasDocId(GUID_A),
      canvasDocId(GUID_B),
      canvasDocId("a"),
      "__canvas__", // no colon — not an id
      "__canvas_:x", // one underscore short
      "_canvas__:x", // one underscore short on the other side
      "x__canvas__:y", // prefixed, not prefix
      "boards/__canvas__:x.canvas", // a path a user could genuinely create
      "board.canvas",
      "__manifest__",
      "notes/journal.md",
      "",
    ];

    const inNamespace = corpus.filter((s) => s.startsWith(CANVAS_DOC_PREFIX));
    expect(inNamespace).toEqual([
      canvasDocId(GUID_A),
      canvasDocId(GUID_B),
      canvasDocId("a"),
    ]);
  });

  it("two guids differing in ONE character give two different docs", () => {
    expect(GUID_A).not.toBe(GUID_B);
    expect(canvasDocId(GUID_A)).not.toBe(canvasDocId(GUID_B));
    // …and neither is a prefix of the other, so a `startsWith` router cannot
    // conflate them.
    expect(canvasDocId(GUID_A).startsWith(canvasDocId(GUID_B))).toBe(false);
    expect(canvasDocId(GUID_B).startsWith(canvasDocId(GUID_A))).toBe(false);
  });

  it("the id is stable across calls and carries no ambient state", () => {
    expect(typeof canvasDocId).toBe("function");
    const first = canvasDocId(GUID_A);
    canvasDocId(GUID_B);
    canvasDocId("something else entirely");
    expect(canvasDocId(GUID_A)).toBe(first);
  });

  it("an unresolved guid never yields the bare prefix", () => {
    expect(typeof canvasDocId).toBe("function");
    for (const bad of ["", "  \t "]) {
      let produced: string | null = null;
      try {
        produced = canvasDocId(bad);
      } catch {
        produced = null;
      }
      expect(produced, "an unresolved guid produced a shared, colliding id").not.toBe(
        CANVAS_DOC_PREFIX,
      );
      expect(produced).toBeNull();
    }
  });

  it("the three meta keys are lower-case single words with no separator", () => {
    for (const key of [GUID_KEY, PATH_KEY, EPOCH_KEY]) {
      expect(key).toBe(key.toLowerCase());
      expect(key).not.toContain(".");
      expect(key).not.toContain("_");
      expect(key).not.toContain("-");
    }
  });
});
