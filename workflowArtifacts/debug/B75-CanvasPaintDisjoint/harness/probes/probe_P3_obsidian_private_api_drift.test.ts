// B75 · P3 — CODE-LEVEL
//
// SURFACE: version drift between the private Obsidian Canvas API the plugin
// reaches for and the Obsidian bundle that is actually running.
//
// The plugin drives Obsidian's canvas through undocumented members
// (`canvas.wrapperEl`, `node.nodeEl`, `node.render`, `canvas.markMoved`, …).
// Every one of those is a name that can disappear in an Obsidian release
// WITHOUT a build error, a type error or a thrown exception — `canvas-adapter.ts`
// guards each access defensively, so a vanished member degrades into a silent
// "cannot do that", which is precisely how a rendering feature stops rendering.
//
// The reading is taken from the RUNNING bundle when it is available
// (`LS_OBSIDIAN_BUNDLE_DIR`, default `H:/tmp/liveshare_debug/asar1136`), and
// otherwise from `fixtures/obsidian-symbols.json`. Which source was used is
// printed, because a stale fixture is a vacuous green and the reader must be
// able to see which one this was.
//
// WHY IT CAN GO RED: point it at an Obsidian bundle that renamed any of these
// and it fires. It is the probe to re-run first after every Obsidian update.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HARNESS = fileURLToPath(new URL("../", import.meta.url));
const FIXTURE = join(HARNESS, "fixtures", "obsidian-symbols.json");
const DEFAULT_BUNDLE = "H:/tmp/liveshare_debug/asar1136";

/**
 * Every private member `plugin/src/canvas/canvas-adapter.ts` reads off an
 * Obsidian object, plus the two DOM class names the plugin's own CSS and the
 * paint census depend on. A minifier preserves these: they are property names
 * read by string identity off host objects, not local bindings.
 */
const REQUIRED = [
  "wrapperEl",
  "canvasEl",
  "nodeEl",
  "markMoved",
  "requestSave",
  "getData",
  "setData",
  "startEditing",
  "isEditing",
  "posFromEvt",
  "requestFrame",
  "canvas-node",
  "canvas-node-container",
];

function readOccurrences(): { source: string; occurrences: Record<string, number> } {
  const bundleDir = process.env.LS_OBSIDIAN_BUNDLE_DIR ?? DEFAULT_BUNDLE;
  const appJs = join(bundleDir, "app.js");
  if (existsSync(appJs)) {
    const js = readFileSync(appJs, "utf8");
    const occurrences: Record<string, number> = {};
    for (const name of REQUIRED) occurrences[name] = js.split(name).length - 1;
    return { source: `LIVE BUNDLE ${appJs}`, occurrences };
  }
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
    obsidianVersion: string;
    symbolOccurrences: Record<string, number>;
  };
  return {
    source: `FIXTURE ${FIXTURE} (Obsidian ${fixture.obsidianVersion}) — the live bundle was not at ${appJs}`,
    occurrences: fixture.symbolOccurrences,
  };
}

describe("B75 P3 — private Canvas API members vs the running Obsidian bundle", () => {
  it("every member the canvas adapter reaches for is present in the bundle", () => {
    const { source, occurrences } = readOccurrences();
    // eslint-disable-next-line no-console
    console.log(`P3 read from: ${source}`);
    const missing = REQUIRED.filter((name) => (occurrences[name] ?? 0) === 0);
    expect(
      missing,
      `these private members are ABSENT from the running Obsidian bundle, so every ` +
        `canvas-adapter path that guards on them is silently dead:\n  ${missing.join("\n  ")}\n` +
        `(read from ${source})`,
    ).toEqual([]);
  });
});
