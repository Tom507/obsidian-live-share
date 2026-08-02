// WP22 / AC4 — "`useCanvasBinding` remains `false` and the binding stays dormant
// in production after this change (the flag is not flipped here)."
//
// WP22 is the one narrowly permitted edit to an otherwise frozen file, and the
// obvious way for it to go wrong is scope creep: having fixed the binding, flip
// the flag and "prove" the fix in production. That is WP40's decision, not this
// WP's, so the dormancy has to be pinned by this WP's own tests.
//
// Dormancy is a claim about production wiring, so it is checked at the two places
// where it can be broken:
//   ├── the DEFAULT itself — `DEFAULT_SETTINGS.useCanvasBinding` is `false`, read
//   │      from the module rather than from the file, and the file's literal is
//   │      checked too so a runtime override cannot mask a changed default, and
//   └── the GATE — `main.ts` constructs a `CanvasBinding` in exactly one place,
//          and that place is lexically inside `if (this.settings.useCanvasBinding)`.
//          An ungated construction is dormancy lost even with the flag `false`,
//          because the settings object is user-writable.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "../../../types";

const MAIN_SOURCE = readFileSync(new URL("../../../main.ts", import.meta.url), "utf8");
const TYPES_SOURCE = readFileSync(new URL("../../../types.ts", import.meta.url), "utf8");

/** Strip comments so a scan reads CODE, not prose (the wp5v2 / wp21 precedent). */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const MAIN_CODE = codeOf(MAIN_SOURCE);

/**
 * The brace-delimited block that starts at `marker`. Template holes (`${…}`) are
 * brace-balanced, so a plain depth walk over comment-stripped code is exact here.
 */
function blockAfter(code: string, marker: string): string {
  const at = code.indexOf(marker);
  if (at < 0) throw new Error(`marker not found in main.ts: ${marker}`);
  const open = code.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}") {
      depth--;
      if (depth === 0) return code.slice(open, i + 1);
    }
  }
  throw new Error("unterminated block");
}

describe("WP22 AC4 — the binding is still dormant in production", () => {
  it("the shipped default for `useCanvasBinding` is false", () => {
    expect(
      DEFAULT_SETTINGS.useCanvasBinding,
      "WP22 flipped `useCanvasBinding` — that is WP40's decision, not this WP's",
    ).toBe(false);
    expect(
      codeOf(TYPES_SOURCE),
      "the literal default in types.ts is no longer `useCanvasBinding: false`",
    ).toMatch(/useCanvasBinding:\s*false\s*,/);
  });

  it("main.ts constructs the binding in exactly one place, and that place is behind the flag", () => {
    const constructions = MAIN_CODE.match(/new\s+CanvasBinding\s*\(/g) ?? [];
    expect(
      constructions,
      "main.ts constructs a CanvasBinding a different number of times than the single gated site",
    ).toHaveLength(1);

    const gated = blockAfter(MAIN_CODE, "if (this.settings.useCanvasBinding) {");
    expect(
      gated,
      "the CanvasBinding construction is no longer inside the `useCanvasBinding` gate",
    ).toMatch(/new\s+CanvasBinding\s*\(/);
  });

  it("the legacy follower-apply bypass is still the flag's other consumer", () => {
    // If this gate disappeared, the binding's apply path and the legacy reconcile
    // would both be live — dormancy is about BOTH gates, not just construction.
    expect(
      MAIN_CODE,
      "the `useCanvasBinding` early-return on the remote-update path was removed",
    ).toMatch(/if\s*\(this\.settings\.useCanvasBinding\)\s*return;/);
  });
});
