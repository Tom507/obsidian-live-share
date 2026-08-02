// WP12 AC2 — same guarantee, attacked with a table-driven fixture set
// (including quarantine entries, which must ALSO suppress, since AC2 is
// q-agnostic: on:true suppresses regardless of q) run through all three
// consumer angles in a loop, rather than the visible test's two named
// entries.

import { describe, expect, it } from "vitest";

import { isTombstoneSuppressed } from "../../../canvas/canvas-tombstone";
import type { TombstoneEntry } from "../../../canvas/canvas-tombstone";

const reconcileShouldEmit = (entry: TombstoneEntry | undefined) => !isTombstoneSuppressed(entry);
const serialisationShouldWrite = (entry: TombstoneEntry | undefined) => !isTombstoneSuppressed(entry);
const captureShouldBlockResurrect = (entry: TombstoneEntry | undefined) => isTombstoneSuppressed(entry);

describe("WP12 AC2 — table-driven check that all three consumer angles agree, including quarantine entries", () => {
  const fixtures: Array<{ label: string; entry: TombstoneEntry | undefined; suppressed: boolean }> = [
    { label: "undefined (never deleted)", entry: undefined, suppressed: false },
    { label: "plain user delete", entry: { t: 1, by: "peer-a", on: true }, suppressed: true },
    { label: "quarantine", entry: { t: 2, by: "auditor", on: true, q: true }, suppressed: true },
    { label: "undone delete", entry: { t: 3, by: "peer-b", on: false }, suppressed: false },
    { label: "released quarantine (q lingers, on:false)", entry: { t: 4, by: "auditor", on: false, q: true }, suppressed: false },
  ];

  it.each(fixtures)("$label: all three consumers agree with isTombstoneSuppressed", ({ entry, suppressed }) => {
    expect(reconcileShouldEmit(entry)).toBe(!suppressed);
    expect(serialisationShouldWrite(entry)).toBe(!suppressed);
    expect(captureShouldBlockResurrect(entry)).toBe(suppressed);
  });
});
