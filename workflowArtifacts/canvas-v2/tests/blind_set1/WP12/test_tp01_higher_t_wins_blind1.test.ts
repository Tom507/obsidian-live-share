// WP12 AC1 — same guarantee, attacked from a different angle: a quarantine
// op (on:true, q:true) competing against a plain delete op at different t
// values. Quarantine is still just an on:true entry for merge purposes — the
// winner is decided purely by t, never by whether q is set. Different ids
// and values from the visible test.

import { describe, expect, it } from "vitest";

import { mergeTombstoneEntries } from "../../../canvas/canvas-tombstone";
import type { TombstoneEntry } from "../../../canvas/canvas-tombstone";

describe("WP12 AC1 — higher t wins even when the lower-t side is a quarantine op", () => {
  it("a later plain delete (higher t) beats an earlier quarantine (lower t)", () => {
    const earlierQuarantine: TombstoneEntry = { t: 20, by: "auditor", on: true, q: true };
    const laterDelete: TombstoneEntry = { t: 33, by: "peer-x", on: true };

    expect(mergeTombstoneEntries(earlierQuarantine, laterDelete)).toEqual(laterDelete);
    expect(mergeTombstoneEntries(laterDelete, earlierQuarantine)).toEqual(laterDelete);
  });

  it("a later quarantine (higher t) beats an earlier plain delete (lower t)", () => {
    const earlierDelete: TombstoneEntry = { t: 4, by: "peer-y", on: true };
    const laterQuarantine: TombstoneEntry = { t: 15, by: "auditor", on: true, q: true };

    expect(mergeTombstoneEntries(earlierDelete, laterQuarantine)).toEqual(laterQuarantine);
    expect(mergeTombstoneEntries(laterQuarantine, earlierDelete)).toEqual(laterQuarantine);
  });
});
