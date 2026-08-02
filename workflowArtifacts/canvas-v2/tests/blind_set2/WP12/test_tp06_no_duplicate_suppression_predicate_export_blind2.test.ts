// WP12 AC2 — same export-surface guarantee, attacked by pinning the whole
// exported function-name set that contains "Suppress" (must be exactly one
// member) AND independently checking the predicate's arity, rather than the
// visible/blind1 tests' regex-scan angle.

import { describe, expect, it } from "vitest";

import * as CanvasTombstone from "../../../canvas/canvas-tombstone";

describe("WP12 AC2 — suppression predicate identity is pinned in the module's exported surface", () => {
  it("exactly one exported member name contains the substring 'Suppress'", () => {
    const names = Object.keys(CanvasTombstone);
    const withSuppressInName = names.filter((n) => n.includes("Suppress"));
    expect(withSuppressInName).toEqual(["isTombstoneSuppressed"]);
  });

  it("isTombstoneSuppressed is a function that takes exactly one parameter", () => {
    expect(typeof CanvasTombstone.isTombstoneSuppressed).toBe("function");
    expect((CanvasTombstone.isTombstoneSuppressed as (...args: unknown[]) => unknown).length).toBe(1);
  });
});
