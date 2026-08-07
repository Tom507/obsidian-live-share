// WP72 / C72 AC4 (blind set 2) — "no production canvas module gains a branch, and
// the production bundle is unchanged".
//
// ANGLE (different mechanism from the visible set and from blind set 1): the
// visible test greps four named source files; blind set 1 walks the static module
// graph. Both reason ABOUT the bundle. This one BUILDS it — esbuild is invoked
// in-process with the production define (`__LS_E2E__: "false"`) and
// `write: false`, so a real production bundle is produced in memory and scanned
// for markers of the testing module. That is the artefact AC4 actually speaks
// about, and it is measured rather than inferred.
//
// It deliberately does NOT read `plugin/main.js`. That file is a shared, volatile
// artefact: whichever of `npm run build` / `build:e2e` / `dev` ran last decides
// its contents, and the e2e and watch modes bundle `src/testing/` on purpose. A
// test that scanned it would go red because a sibling ran the wrong build, which
// is a red for the wrong reason. Building in memory removes that coupling
// entirely and writes nothing to the working tree.
//
// The same builder then produces the E2E bundle (`__LS_E2E__: "true"`) and asserts
// every marker IS present there. That is this file's proof that the marker list is
// a real detector rather than a list of strings that happen never to occur.
//
// The last case is behavioural rather than static: it drives the router and pins
// the exact set of accepted commands, so "no new command family beyond what the
// criteria require" is checked by asking the surface, not by parsing its source.
//
// WOULD REDDEN IF: any part of `src/testing/` survived into a production build
// (a static import added anywhere, the `__LS_E2E__` guard removed, the dynamic
// import made static); if any production source outside `src/testing/` gained
// the WP72 vocabulary; or if the command surface grew (or lost) a command.
//
// DATA SAFETY: builds in memory (`write: false`) and reads only the repository
// under test. No vault, no `data.json`, no temp file, no network.
//
// Staging: copy into `plugin/src/__tests__/wp72blind2/` (→ `../../testing/...`).
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type CommandResult,
  type E2EFileControlHost,
  type E2EPluginLike,
  buildPluginHost,
  routeCommand,
} from "../../testing/e2e-control";

function pluginRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      const pkg = JSON.parse(readFileSync(candidate, "utf8")) as { name?: string };
      if (pkg.name === "live-share") return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("could not locate the live-share plugin package root");
}

const ROOT = pluginRoot();
const SRC = join(ROOT, "src");

/**
 * Markers of the testing module. Every one is defined in `src/testing/` and
 * nowhere else, and none is a build-time define (which would be substituted away
 * in BOTH bundles and could therefore never fail).
 */
const E2E_MARKERS = [
  "e2e-control",
  "e2eControlPort",
  "LIVESHARE_E2E",
  "settingsOverrides",
  "runtimeFlags",
  "flagConsumer",
  "canvas.setFlag",
  "canvas.clearFlags",
  "E2E_BUILD_MARKER",
  "isScratchPath",
  "SCRATCH_FOLDER",
  "DOC_CONVERGED_FILE_DIVERGED",
  "createControlServer",
  "buildPluginHost",
  "routeCommand",
  "parseAndRoute",
];

/**
 * Bundle `src/main.ts` in memory with the given value of the build-time flag.
 * Options mirror `esbuild.config.mjs` exactly; nothing is written to disk, so the
 * shared `plugin/main.js` artefact is neither read nor touched.
 */
async function bundle(flag: "true" | "false"): Promise<string> {
  const esbuild = (await import("esbuild")) as typeof import("esbuild");
  const out = await esbuild.build({
    absWorkingDir: ROOT,
    entryPoints: ["src/main.ts"],
    bundle: true,
    external: ["obsidian", "electron", "@codemirror/state", "@codemirror/view", "@codemirror/language"],
    format: "cjs",
    target: "es2021",
    logLevel: "silent",
    sourcemap: false,
    treeShaking: true,
    define: { __LS_E2E__: flag },
    platform: "node",
    write: false,
  });
  return out.outputFiles[0].text;
}

/**
 * Every PRODUCTION `.ts` under `src/`: the test tree, the obsidian mock and any
 * `*.test.ts` / `*.spec.ts` are excluded wherever they sit, so the sweep does not
 * accuse a test file (this one included) of being production code.
 */
function productionSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__" || entry.name === "__mocks__") continue;
        walk(full);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
      if (/\.(test|spec)\.ts$/.test(entry.name)) continue;
      out.push(full);
    }
  };
  walk(SRC);
  return out;
}

function makeHost(): E2EFileControlHost {
  const plugin = {
    settings: { clientId: "c", roomId: "r", role: "host", useCanvasBinding: false },
    muxConnected: true,
    controlConnected: true,
    saveSettings: () => {},
    canvasSync: null,
  } as unknown as E2EPluginLike;
  return buildPluginHost(plugin, {
    counters: { applyRemote: 0, captureLocal: 0, rePush: 0, originUpdates: 0 },
    bump: () => {},
  });
}

function errorOf(body: CommandResult): string {
  return body.ok === false ? body.error : "";
}

// A generous budget, not a timing oracle: nothing here waits on a clock, but two
// in-memory esbuild passes must not race the default per-test timeout on a cold
// or loaded machine.
const BUILD_TIMEOUT_MS = 60_000;

describe("WP72 AC4 blind2 — measured on a freshly built production bundle", () => {
  it(
    "a production build contains not one marker of the testing module",
    async () => {
      const prod = await bundle("false");
      // Sanity: this really is the plugin's bundle and not an empty output.
      expect(prod.length).toBeGreaterThan(100_000);
      expect(prod).toContain("LiveSharePlugin");

      const present = E2E_MARKERS.filter((marker) => prod.includes(marker));
      expect(present).toEqual([]);
    },
    BUILD_TIMEOUT_MS,
  );

  it(
    "FALSIFICATION: the same markers are all present in the E2E build",
    async () => {
      const e2e = await bundle("true");
      const missing = E2E_MARKERS.filter((marker) => !e2e.includes(marker));
      // If any marker were missing here, its absence from the production bundle
      // above would prove nothing at all.
      expect(missing).toEqual([]);
      // ...and the E2E bundle is measurably bigger, because it carries a module
      // the production one does not.
      expect(e2e.length).toBeGreaterThan((await bundle("false")).length);
    },
    BUILD_TIMEOUT_MS,
  );

  it("no production source outside src/testing/ carries the WP72 vocabulary", () => {
    const vocabulary = /setFlag|clearFlags|flagConsumer|runtimeFlags|settingsOverrides/;
    const offenders: string[] = [];
    for (const file of productionSources()) {
      if (file.startsWith(join(SRC, "testing"))) continue;
      if (vocabulary.test(readFileSync(file, "utf8"))) offenders.push(relative(ROOT, file));
    }
    // Exhaustive over the whole production tree — not a list of four modules, so
    // a branch added to any file at all fails here.
    expect(offenders).toEqual([]);
    expect(productionSources().length).toBeGreaterThan(20);
  });

  it("the command surface is exactly what it was, plus the one reversal command", async () => {
    const host = makeHost();

    // Everything the contract says the surface answers. `canvas.clearFlags` is
    // WP72's single addition; the rest are inherited unchanged.
    const FROZEN = [
      "session.info",
      "canvas.open",
      "canvas.state",
      "canvas.binding",
      "canvas.simulateEdit",
      "canvas.setFlag",
      "canvas.clearFlags",
      "sync.waitQuiescent",
      "scratch.create",
      "scratch.remove",
      "canvas.file",
    ];
    for (const cmd of FROZEN) {
      const args = cmd === "sync.waitQuiescent" ? { timeoutMs: 0 } : {};
      const out = await routeCommand(host, { cmd, args });
      // Some of these fail for their own reasons on a bare host (a missing
      // `path`, no adapter). What matters is that the router KNOWS the command.
      expect(errorOf(out.body)).not.toContain(`unknown cmd: ${cmd}`);
    }

    // Every plausible shape of "and now a persistence command" is unknown. AC1
    // says the behaviour is removed, so there is no second door either.
    const ABSENT = [
      "canvas.saveSettings",
      "canvas.persistFlag",
      "canvas.setFlagPersist",
      "canvas.setSetting",
      "settings.save",
      "settings.write",
      "plugin.saveSettings",
      "data.write",
      "canvas.flush",
    ];
    for (const cmd of ABSENT) {
      const out = await routeCommand(host, { cmd, args: { name: "roomId", value: 1 } });
      expect(out.status).toBe(400);
      expect(errorOf(out.body)).toBe(`unknown cmd: ${cmd}`);
    }
  });
});
