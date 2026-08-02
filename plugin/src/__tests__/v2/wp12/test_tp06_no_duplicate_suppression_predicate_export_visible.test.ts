// WP12 / AC2 (part 2) — pin the SINGLE suppression predicate's identity in
// the module's own exported surface, so a later WP that quietly
// re-implements "is this record deleted" under a different name is caught by
// this test rather than discovered in production (Shared Ownership Contract
// §1: "The tombstone suppression predicate is WP12's and only WP12's").
//
// Dynamic on purpose — the pattern is the same one WP13's
// `test_tp07_no_mutating_export_visible.test.ts` uses to pin its own exported
// surface: scan the module's actual exports rather than hand-listing them.

import { describe, expect, it } from "vitest";

import * as CanvasTombstone from "../../../canvas/canvas-tombstone";

describe("WP12 AC2 — the module exports exactly one suppression predicate", () => {
  it("exactly one exported function matches an 'is this record deleted/suppressed' naming pattern, and it is isTombstoneSuppressed", () => {
    const suppressionPattern = /suppress|isdeleted|isremoved|ishidden|shouldhide|shouldsuppress/i;
    const matching = Object.keys(CanvasTombstone).filter(
      (name) =>
        typeof (CanvasTombstone as Record<string, unknown>)[name] === "function" &&
        suppressionPattern.test(name),
    );

    expect(matching).toEqual(["isTombstoneSuppressed"]);
  });
});
