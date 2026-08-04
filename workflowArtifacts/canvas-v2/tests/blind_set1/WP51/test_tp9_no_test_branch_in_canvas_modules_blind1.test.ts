// WP51 AC4 — blind set 1 (structural).
//
// Angle: a whole-tree sweep instead of a named-file check. Everything under
// `plugin/src/` that is NOT `testing/` and NOT a test is production code, and
// none of it may carry the stale-view surface — including files a named list
// would not have thought to mention (`files/`, `sync/`, `ui/`, a module added
// after this test was written).
//
// The sweep also enforces the direction of the dependency: production may not
// import `testing/`, and the one exception — `main.ts`'s dead-code branch — is
// pinned by count rather than waved through.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { RUNTIME_FLAG_READERS, STALE_VIEW_FLAG } from "../../testing/e2e-control";

const SRC = fileURLToPath(new URL("../../", import.meta.url));

/** Every `.ts` under `plugin/src/`, excluding tests, mocks and `testing/`. */
function productionFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === "__tests__" || entry === "__mocks__" || entry === "testing") continue;
        walk(full);
      } else if (entry.endsWith(".ts")) {
        out.push(full);
      }
    }
  };
  walk(SRC);
  return out;
}

const TOKENS = [
  STALE_VIEW_FLAG,
  "staleView",
  "StaleView",
  "runtimeFlags",
  "RUNTIME_FLAG_READERS",
  "canvas.flags",
  "canvas.save",
  "canvas.setFlag",
  "CanvasSaveChannel",
  "byInstance",
  "sha256After",
];

describe("WP51 AC4 (blind1) — nothing outside `testing/` knows about the surface", () => {
  it("the sweep actually found the production tree", () => {
    const files = productionFiles();
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.endsWith(`${sep}main.ts`))).toBe(true);
    expect(files.some((f) => f.includes(`${sep}canvas${sep}`))).toBe(true);
    // …and it excluded the module that IS allowed to hold the surface.
    expect(files.some((f) => f.includes(`${sep}testing${sep}`))).toBe(false);
  });

  it("POSITIVE CONTROL: the surface exists, in `testing/e2e-control.ts` only", () => {
    const control = readFileSync(join(SRC, "testing", "e2e-control.ts"), "utf8");
    for (const token of [STALE_VIEW_FLAG, "canvas.flags", "canvas.save"]) {
      expect(control, `the surface is missing ${token}`).toContain(token);
    }
    expect(RUNTIME_FLAG_READERS[STALE_VIEW_FLAG]).toBeTruthy();
  });

  it.each(TOKENS)("no production file contains `%s`", (token) => {
    const offenders = productionFiles().filter((f) => readFileSync(f, "utf8").includes(token));
    expect(offenders.map((f) => relative(SRC, f))).toEqual([]);
  });

  it("no production file imports from `testing/` except `main.ts`'s dead-code branch", () => {
    const importers = productionFiles().filter((f) =>
      /(?:from|import\()\s*["'][^"']*testing\//.test(readFileSync(f, "utf8")),
    );
    expect(importers.map((f) => relative(SRC, f))).toEqual(["main.ts"]);
  });

  it("`main.ts` reaches the testing module exactly once, inside the `__LS_E2E__` guard", () => {
    const main = readFileSync(join(SRC, "main.ts"), "utf8");
    expect(main.split("./testing/e2e-control").length - 1).toBe(1);
    const guardIndex = main.indexOf("__LS_E2E__)");
    const importIndex = main.indexOf('import("./testing/e2e-control")');
    expect(guardIndex).toBeGreaterThan(-1);
    expect(importIndex).toBeGreaterThan(guardIndex);
  });

  it("the WP6 chaos suites this scenario rides on are untouched", () => {
    const wp6 = join(SRC, "__tests__", "v2", "wp6");
    const files = readdirSync(wp6).sort();
    expect(files).toContain("chaos_cascade.test.ts");
    expect(files).toContain("chaos_degraded_adapter.test.ts");
    const cascade = readFileSync(join(wp6, "chaos_cascade.test.ts"), "utf8");
    const degraded = readFileSync(join(wp6, "chaos_degraded_adapter.test.ts"), "utf8");
    for (const source of [cascade, degraded]) {
      expect(source).not.toContain(STALE_VIEW_FLAG);
      expect(source).not.toContain("canvas.save");
      expect(source).not.toMatch(/it\.skip|describe\.skip|it\.todo/);
    }
  });
});
