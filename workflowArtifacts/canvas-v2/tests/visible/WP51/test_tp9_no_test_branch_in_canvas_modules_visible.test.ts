// WP51 / C51 AC4 — "the scenario … adds NO TEST-ONLY BRANCH to any production
// canvas module".
//
// This is a claim about the shape of the tree, so the oracle is the tree. The
// whole stale-view surface must live in `plugin/src/testing/e2e-control.ts`,
// which the production build tree-shakes out; `plugin/src/canvas/**`,
// `plugin/src/files/canvas-sync.ts` and `plugin/src/main.ts` (wiring only, no
// logic — charter §3) must be reachable by the scenario without gaining one
// `if` that exists for the rig's benefit.
//
// The positive control at the top matters: without it a tree where WP51 was
// never implemented would pass this file trivially, and the assertion would be
// unable to fail.
//
// Staging: copy into `plugin/src/__tests__/wp51/` (one level deep → `../../`).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  RUNTIME_FLAG_READERS,
  STALE_VIEW_FLAG,
} from "../../testing/e2e-control";

/** `plugin/src/` — this file is staged one level deep under `src/__tests__/`. */
const SRC = fileURLToPath(new URL("../../", import.meta.url));

const CONTROL = join(SRC, "testing", "e2e-control.ts");
const MAIN = join(SRC, "main.ts");
const CANVAS_DIR = join(SRC, "canvas");
const CANVAS_SYNC = join(SRC, "files", "canvas-sync.ts");

const read = (p: string) => readFileSync(p, "utf8");
const canvasModules = (): string[] =>
  readdirSync(CANVAS_DIR)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join(CANVAS_DIR, f));

/** Tokens that only a WP51-aware production module could contain. */
const WP51_TOKENS = [
  STALE_VIEW_FLAG.toLowerCase(),
  "staleview",
  "runtimeflag",
  "canvas.flags",
  "canvas.save",
  "canvas.setflag",
  "savechannel",
  "installstaleviewgate",
  "runtime_flag_readers",
  "buildpluginhost",
  "e2econtrolhost",
];

/**
 * The ONLY non-comment lines in `main.ts` that may mention e2e, pinned as
 * measured on the batch baseline. `E2ECrypto` is end-to-end encryption and is
 * unrelated; the rest is the pre-existing flag-gated bootstrap (WP4).
 */
const MAIN_E2E_ALLOWLIST = [
  'import { E2ECrypto } from "./sync/crypto";',
  "declare const __LS_E2E__: boolean;",
  'if (typeof __LS_E2E__ !== "undefined" && __LS_E2E__) {',
  'void import("./testing/e2e-control")',
  "this.testControlHandle = m.maybeStartE2EControlServer(this);",
  '.catch((err) => this.logger.error("e2e", "control server failed to start", err));',
  "let e2e: E2ECrypto | undefined;",
  "e2e = new E2ECrypto(this.settings.encryptionPassphrase, this.settings.encryptionSalt);",
  "await e2e.init();",
  "this.syncManager.setE2E(e2e ?? null);",
  "this.controlChannel = new ControlChannel(this.settings, e2e);",
];

/** Non-comment lines of `source` matching `/e2e/i`, trimmed. */
function codeLinesMentioningE2E(source: string): string[] {
  return source
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /e2e/i.test(l))
    .filter((l) => !l.startsWith("//") && !l.startsWith("*") && !l.startsWith("/*"));
}

describe("WP51 AC4 — the surface lives in the testing module and nowhere else", () => {
  it("POSITIVE CONTROL: the stale-view surface really is in `testing/e2e-control.ts`", () => {
    const control = read(CONTROL);
    expect(control).toContain(STALE_VIEW_FLAG);
    expect(control).toContain("canvas.flags");
    expect(control).toContain("canvas.save");
    expect(Object.keys(RUNTIME_FLAG_READERS)).toContain(STALE_VIEW_FLAG);
  });

  it.each(WP51_TOKENS)("no canvas module mentions `%s`", (token) => {
    for (const file of [...canvasModules(), CANVAS_SYNC]) {
      expect(read(file).toLowerCase(), `${file} mentions ${token}`).not.toContain(token);
    }
  });

  it.each(WP51_TOKENS)("`main.ts` does not mention `%s`", (token) => {
    expect(read(MAIN).toLowerCase()).not.toContain(token);
  });

  it("no production canvas module imports anything from `testing/`", () => {
    for (const file of [...canvasModules(), CANVAS_SYNC]) {
      const source = read(file);
      expect(source, `${file} imports from testing/`).not.toMatch(/from\s+["'][^"']*testing\//);
      expect(source, `${file} dynamically imports testing/`).not.toMatch(
        /import\(\s*["'][^"']*testing\//,
      );
    }
  });

  it("every e2e mention inside a canvas module is a comment, never a branch", () => {
    for (const file of [...canvasModules(), CANVAS_SYNC]) {
      expect(codeLinesMentioningE2E(read(file)), `${file} has an e2e code path`).toEqual([]);
    }
  });

  it("`main.ts` gains no e2e code line beyond the pre-existing WP4 bootstrap", () => {
    // A test-only conditional such as `if (this.e2eStaleView) return;` inside
    // `reconcileLiveCanvas` shows up here as an extra entry.
    expect(codeLinesMentioningE2E(read(MAIN)).sort()).toEqual([...MAIN_E2E_ALLOWLIST].sort());
  });

  it("`main.ts` still reaches the testing module exactly once, through the dead-code branch", () => {
    const main = read(MAIN);
    expect(main.split("./testing/e2e-control").length - 1).toBe(1);
    expect(main.split("maybeStartE2EControlServer").length - 1).toBe(1);
    expect(main.split("__LS_E2E__").length - 1).toBe(4);
  });

  it("the two WP6 seams are reused by name, not reinvented under a new one", () => {
    // C6 AC1 'view apply artificially delayed' and C6 AC2 'adapter unavailable'.
    const control = read(CONTROL);
    expect(control).toContain("delayed");
    expect(control).toContain("unavailable");
    // …and the chaos suites they come from are untouched by this WP.
    const cascade = join(SRC, "__tests__", "v2", "wp6", "chaos_cascade.test.ts");
    const degraded = join(SRC, "__tests__", "v2", "wp6", "chaos_degraded_adapter.test.ts");
    expect(read(cascade)).toContain("WP6 AC1");
    expect(read(degraded)).toContain("WP6 AC3");
  });
});
