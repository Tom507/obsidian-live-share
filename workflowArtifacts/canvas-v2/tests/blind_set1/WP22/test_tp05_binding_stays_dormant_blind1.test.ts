// WP22 AC4 blind1 — dormancy asked as "can anything in the shipped source turn
// it on?" rather than as "is the default still false?".
//
// The visible test reads `DEFAULT_SETTINGS.useCanvasBinding` and locates the one
// gated construction site. Both are true statements about today's tree that a
// scope-creeping change could route around: a second enable site, a default
// computed rather than written, or a `settings.useCanvasBinding = true` anywhere
// in production would leave the visible assertions untouched.
//
// So this one sweeps the whole production source tree (`src/**`, tests excluded)
// for every assignment TO the flag and pins the resulting set exactly. Dormancy
// is not "nothing may write it" — the settings UI must be able to, that is the
// chartered way a tester enables it — it is "nothing may write it BUT the user's
// toggle, and never as a constant". The second oracle is a fresh settings object
// built the way `loadSettings` builds one, which is the value a first-run user
// actually gets, and the third is that WP22's own file is still only reachable
// from the gated site.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS, type LiveShareSettings } from "../../../types";

const SRC_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** Every production `.ts` file: `src/**`, minus tests and mocks. */
function productionSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__" || entry === "__mocks__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) productionSources(full, out);
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("WP22 AC4 blind1 — nothing in the shipped source enables the binding", () => {
  it("the only production writer of `useCanvasBinding` is the user's own settings toggle", () => {
    const writers: string[] = [];
    for (const file of productionSources(SRC_ROOT)) {
      const code = codeOf(readFileSync(file, "utf8"));
      // Two ways to turn it on: an assignment anywhere, or a `true` default. The
      // interface declaration (`useCanvasBinding: boolean;`) and the shipped
      // literal `useCanvasBinding: false` are a decl and a read of "off", and
      // match neither pattern.
      for (const pattern of [/useCanvasBinding\s*=\s*[^=][^;\n]*/g, /useCanvasBinding\s*:\s*true/g]) {
        for (const match of code.matchAll(pattern)) {
          writers.push(
            `${file.slice(SRC_ROOT.length).replace(/\\/g, "/")} :: ${match[0].trim()}`,
          );
        }
      }
    }
    // Exactly one, and it assigns the toggle's own value — not a constant. An
    // `= true` anywhere, or a second writer in any other module, is dormancy lost
    // regardless of what DEFAULT_SETTINGS still says.
    expect(
      writers,
      "the set of production writers of `useCanvasBinding` changed — the binding is no longer dormant by construction",
    ).toEqual(["ui/settings.ts :: useCanvasBinding = value"]);
  });

  it("the settings a first-run user gets have the binding off", () => {
    // What `loadSettings` produces before any saved data exists.
    const firstRun: LiveShareSettings = { ...DEFAULT_SETTINGS, ...{} };
    expect(
      firstRun.useCanvasBinding,
      "a fresh install would come up with the canvas binding enabled",
    ).toBe(false);
    expect(
      Object.keys(DEFAULT_SETTINGS),
      "the flag was dropped from DEFAULT_SETTINGS — dormancy became implicit",
    ).toContain("useCanvasBinding");
  });

  it("`CanvasBinding` is imported by exactly one production module, and used behind the gate", () => {
    const importers = productionSources(SRC_ROOT).filter((file) =>
      /from\s+"[^"]*canvas-binding"/.test(codeOf(readFileSync(file, "utf8"))),
    );
    const names = importers.map((f) => f.slice(SRC_ROOT.length).replace(/\\/g, "/")).sort();
    expect(
      names,
      "the binding module gained a new production importer — dormancy is a wiring property",
    ).toEqual(["canvas/canvas-model-bridge.ts", "main.ts", "testing/e2e-control.ts"]);

    const mainCode = codeOf(readFileSync(join(SRC_ROOT, "main.ts"), "utf8"));
    const gateAt = mainCode.indexOf("if (this.settings.useCanvasBinding) {");
    const constructAt = mainCode.indexOf("new CanvasBinding(");
    expect(gateAt, "the construction gate is gone from main.ts").toBeGreaterThan(-1);
    expect(
      constructAt > gateAt,
      "a CanvasBinding is constructed before (and therefore outside) the flag gate",
    ).toBe(true);
  });
});
