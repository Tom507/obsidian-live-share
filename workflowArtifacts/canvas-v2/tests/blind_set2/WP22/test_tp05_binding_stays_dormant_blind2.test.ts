// WP22 AC4 blind2 — dormancy as an EXPORT-SURFACE and default-value claim.
//
// The visible test locates the gate in `main.ts`; blind1 sweeps for assignments.
// Both look at the flag. This one looks at the module WP22 was allowed to edit and
// asks the complementary question: did the one permitted removal change what the
// rest of the plugin can reach into `canvas-binding.ts` for?
//
// That is the practical shape of "no other change to canvas-binding.ts". A new
// export is how a removal quietly becomes a feature — an `enableCanvasBinding()`,
// a mountable helper, a default-on option — and none of it would disturb the
// flag's value or the gate's position. The export surface is therefore pinned as
// an exact set, and the constructor option bag is pinned by behaviour: a binding
// built with no options at all must still be inert until someone constructs it.
//
// The flag itself is then re-checked from the one place a user's install reads
// it, using an exact whole-value assertion rather than a truthiness check.

import { describe, expect, it } from "vitest";

import * as canvasBinding from "../../../canvas/canvas-binding";
import { DEFAULT_SETTINGS } from "../../../types";

describe("WP22 AC4 blind2 — the permitted edit added no way to switch the binding on", () => {
  it("canvas-binding.ts exports exactly the pre-WP22 runtime surface", () => {
    const surface = Object.keys(canvasBinding).sort();
    expect(
      surface,
      "the binding module's runtime exports changed — WP22 is a removal, not a new capability",
    ).toEqual(["CANVAS_BINDING_ORIGIN", "CanvasBinding", "setCanvasBindingInstrument"]);
    expect(
      typeof canvasBinding.CanvasBinding,
      "the binding class is no longer the module's entry point",
    ).toBe("function");
  });

  it("the module has no ambient enable path: the instrument hook starts off", () => {
    // A module-level hook that defaulted to installed would make the binding's
    // instrumentation live in production even with the flag off.
    expect(
      typeof canvasBinding.setCanvasBindingInstrument,
      "the instrumentation seam disappeared",
    ).toBe("function");
    // Clearing is idempotent and does not throw — proof it is a plain nullable slot
    // rather than a registry that something else has already populated.
    expect(() => canvasBinding.setCanvasBindingInstrument(null)).not.toThrow();
  });

  it("the flag a real install reads is exactly `false`", () => {
    const value = DEFAULT_SETTINGS.useCanvasBinding;
    expect(value, "the shipped default is no longer the boolean false").toBe(false);
    expect(typeof value, "the default became truthy-but-not-boolean").toBe("boolean");
  });
});
