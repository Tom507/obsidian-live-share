// WP13 / AC4 — an allocated value is immutable: the module offers no
// operation that rewrites an existing ord in place, only allocation of new
// values.
//
// This is a statement about the EXPORTED API SURFACE (see WP13 test-design
// rules), so the assertion is DYNAMIC — it scans the module's own exports —
// exactly the pattern WP9's `GEOMETRY_KEYS` pin uses
// (`v2/wp9/test_tp04_geometry_keys_pin_visible.test.ts`:
// `expect("GEOMETRY_KEYS" in CanvasRegisters).toBe(false)`). A later WP that
// adds `setOrd` / `updateOrd` / any in-place rewrite must fail this test, not
// pass it silently.

import { describe, expect, it } from "vitest";

import * as CanvasOrd from "../../../canvas/canvas-ord";

describe("WP13 AC4 — canvas-ord exports no mutating operation", () => {
  it("no export name matches a mutating-operation pattern (set/update/rewrite/mutate/edit/patch/replace/write)", () => {
    const mutatingPattern = /^(set|update|rewrite|mutate|edit|patch|replace|write)/i;
    const exportNames = Object.keys(CanvasOrd);
    const offending = exportNames.filter((name) => mutatingPattern.test(name));

    expect(offending).toEqual([]);
  });

  it("the module's only FUNCTION exports are the allocator and the two comparators", () => {
    const functionExportNames = Object.keys(CanvasOrd)
      .filter((name) => typeof (CanvasOrd as Record<string, unknown>)[name] === "function")
      .sort();

    expect(functionExportNames).toEqual(["allocateOrd", "compareOrd", "compareOrdId"]);
  });

  it("allocateOrd's own return value participates in no further mutation: calling it twice with the same inputs never changes a previously returned string", () => {
    const rng = (() => {
      let state = 42 >>> 0;
      return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    })();

    const first = CanvasOrd.allocateOrd(undefined, undefined, "client-immutable", rng);
    const firstSnapshot = String(first);

    // Allocate several more values; none of this may retroactively change
    // the string identity/content already handed back.
    CanvasOrd.allocateOrd(first, undefined, "client-after-1", rng);
    CanvasOrd.allocateOrd(first, undefined, "client-after-2", rng);

    expect(first).toBe(firstSnapshot);
  });
});
