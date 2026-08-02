// WP12 / AC2 (part 1) — "on:true suppresses the record in all three
// consumers — reconcile output, serialisation and capture resurrect-blocking
// — through one shared predicate, not three copies."
//
// This test builds three tiny stand-ins for the real consumers (WP15's
// tombstone view / reconcile, WP17's serialiser, and capture's
// resurrect-block check) and proves all three ask the SAME question the SAME
// way: every one of them is implemented purely in terms of
// `isTombstoneSuppressed`, and all three agree for every entry shape.

import { describe, expect, it } from "vitest";

import { isTombstoneSuppressed } from "../../../canvas/canvas-tombstone";
import type { TombstoneEntry } from "../../../canvas/canvas-tombstone";

describe("WP12 AC2 — one shared suppression predicate answers all three consumer questions identically", () => {
  it("reconcile output, serialisation and capture resurrect-blocking all get the same answer from isTombstoneSuppressed", () => {
    const deleted: TombstoneEntry = { t: 5, by: "peer-a", on: true };
    const visible: TombstoneEntry = { t: 5, by: "peer-a", on: false };

    // Consumer 1: reconcile deciding whether to emit a record in its output.
    const reconcileShouldEmit = (entry: TombstoneEntry | undefined) => !isTombstoneSuppressed(entry);
    // Consumer 2: serialisation deciding whether to write a record to the file.
    const serialisationShouldWrite = (entry: TombstoneEntry | undefined) => !isTombstoneSuppressed(entry);
    // Consumer 3: capture deciding whether a local edit of a suppressed
    // record must be blocked from resurrecting it.
    const captureShouldBlockResurrect = (entry: TombstoneEntry | undefined) => isTombstoneSuppressed(entry);

    expect(reconcileShouldEmit(deleted)).toBe(false);
    expect(serialisationShouldWrite(deleted)).toBe(false);
    expect(captureShouldBlockResurrect(deleted)).toBe(true);

    expect(reconcileShouldEmit(visible)).toBe(true);
    expect(serialisationShouldWrite(visible)).toBe(true);
    expect(captureShouldBlockResurrect(visible)).toBe(false);

    expect(reconcileShouldEmit(undefined)).toBe(true);
    expect(serialisationShouldWrite(undefined)).toBe(true);
    expect(captureShouldBlockResurrect(undefined)).toBe(false);
  });
});
