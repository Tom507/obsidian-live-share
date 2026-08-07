// WP12 AC2 — same export-surface guarantee, attacked with a broader net: a
// wider regex that would also catch "delete"/"remove"/"hidden" spellings a
// re-implementation might choose, still expecting exactly one match:
// isTombstoneSuppressed.

import { describe, expect, it } from "vitest";

import * as CanvasTombstone from "../../../canvas/canvas-tombstone";

describe("WP12 AC2 — no near-duplicate suppression predicate under a broader naming net", () => {
  it("exactly one exported function matches delete|remove|hidden|suppress, and it is isTombstoneSuppressed", () => {
    const broadPattern = /delete|remove|hidden|suppress/i;
    const matching = Object.keys(CanvasTombstone).filter(
      (name) =>
        typeof (CanvasTombstone as Record<string, unknown>)[name] === "function" && broadPattern.test(name),
    );

    expect(matching).toEqual(["isTombstoneSuppressed"]);
  });
});
