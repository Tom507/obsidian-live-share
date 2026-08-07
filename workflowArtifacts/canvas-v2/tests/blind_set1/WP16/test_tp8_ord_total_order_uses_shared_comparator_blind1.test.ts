// WP16 blind1 — same shared-constant hazard, different angle: THREE entries
// share an identical ord. When `nextOrder` matches the id-tiebreak canonical
// order exactly, nothing may be reassigned; when `nextOrder` is the REVERSE
// of that canonical order, a real (minimal) reassignment must occur. Both
// halves fail for an implementation that ignores the id tiebreak (e.g. one
// that treats any two same-ord entries as inherently ambiguous and always
// reassigns them, or one that never detects the reversal because it never
// establishes a canonical baseline order at all).

import { describe, expect, it } from "vitest";

import type { OrdIdEntry } from "../../../../../plugin/src/canvas/canvas-ord";
import { deriveOrdAssignments } from "../../../../../plugin/src/files/canvas-sync";

describe("WP16 blind1 — three ord-colliding entries: canonical order is stable, reversal is a real reorder", () => {
  it("nextOrder matching the id-tiebreak canonical order ('aaa','mmm','zzz') reassigns nothing", () => {
    const previous: OrdIdEntry[] = [
      { id: "zzz", ord: "tie" },
      { id: "mmm", ord: "tie" },
      { id: "aaa", ord: "tie" },
    ];
    const canonicalOrder = ["aaa", "mmm", "zzz"];

    const reassignments = deriveOrdAssignments(previous, canonicalOrder, "client-triple");

    expect(reassignments.size).toBe(0);
  });

  it("nextOrder reversed from the canonical id order is a real, minimal reorder", () => {
    const previous: OrdIdEntry[] = [
      { id: "aaa", ord: "tie" },
      { id: "mmm", ord: "tie" },
      { id: "zzz", ord: "tie" },
    ];
    const reversedOrder = ["zzz", "mmm", "aaa"];

    const reassignments = deriveOrdAssignments(previous, reversedOrder, "client-triple");

    // A genuine reversal of three elements is detected as a real change...
    expect(reassignments.size).toBeGreaterThan(0);
    // ...but is still minimal: never reassign every single element when a
    // strict subset can express the same resulting order (the LIS of a
    // 3-element reversal has length 1, so at most 2 of the 3 move).
    expect(reassignments.size).toBeLessThanOrEqual(2);
  });
});
