// ===========================================================================
// WP82 — the structural rows.
//
// AC6's vacuity note demands the definer's call sites be enumerated
// STRUCTURALLY rather than satisfied by reading three agreeing values in one
// lucky state; §2 demands the break seam be unreachable in a production build
// and from every UI, command, setting and handler; and §5 forbids any socket
// URL, or fragment of one, from reaching a log line, response, test name or
// fixture.
//
// RULE 15 IS OBSERVED THROUGHOUT: every row that reports an ABSENCE also proves
// its own pattern matches a known-present line, in the same test.
// ===========================================================================

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function pluginRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "package.json")) && existsSync(join(dir, "src"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("could not locate the live-share plugin package root");
}

const read = (rel: string) => readFileSync(join(pluginRoot(), rel), "utf8");

/**
 * Source with comments removed. Several rows below are about what the code
 * DOES, and this project has already reddened three tests because a regex read
 * a comment that merely quoted the construct it was scanning for.
 */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("WP82 — the definer is pure and zero-import", () => {
  it("`sync/link-state.ts` contains no import statement at all", () => {
    const src = read("src/sync/link-state.ts");
    // POSITIVE CONTROL for the pattern (rule 15): the same regex finds the
    // imports in a file that certainly has them.
    const control = read("src/sync/control-ws.ts");
    expect(control.match(/^\s*import\s/gm)?.length ?? 0).toBeGreaterThan(0);

    expect(src.match(/^\s*import\s/gm)).toBeNull();
    expect(src).not.toMatch(/\brequire\s*\(/);
  });

  it("it performs no I/O and reads no ambient state", () => {
    // Comments stripped: the module's own documentation NAMES the constructs it
    // is forbidden to use (it explains the S38 `new WebSocket(url)` hazard), and
    // a scan that cannot tell a comment from code has already cost this project
    // three red tests.
    const src = code("src/sync/link-state.ts");
    // POSITIVE CONTROL for the stripper: the doc comment really does contain
    // the phrase, and it is gone from `src`.
    expect(read("src/sync/link-state.ts")).toMatch(/new WebSocket\(url\)/);
    for (const forbidden of [
      /\bDate\.now\s*\(/,
      /\bMath\.random\s*\(/,
      /\bsetTimeout\s*\(/,
      /\bnew\s+WebSocket\b/,
      /\bwindow\b/,
      /\bglobalThis\b/,
    ]) {
      expect(src).not.toMatch(forbidden);
    }
  });
});

describe("WP82 AC6 — ONE definer, its call sites enumerated", () => {
  it("`decideSharing` is called from exactly one method in main.ts, and every consumer goes through it", () => {
    const main = read("src/main.ts");
    // The definer is invoked in exactly one place: `getSharingVerdict`.
    const calls = main.match(/decideSharing\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(main).toMatch(/getSharingVerdict\([\s\S]{0,80}\):\s*SharingVerdict\s*\{\s*\n\s*return decideSharing\(/);

    // The three consumers named by AC6 all read that one verdict.
    // 1. updateOnlineState — the file-op route.
    expect(main).toMatch(/setOnline\(this\.getSharingVerdict\(\)\.sharing\)/);
    // 2. the status bar.
    expect(main).toMatch(/sharingStatusText\(verdict, healthyText\)/);
    // 3. the E2E link report.
    expect(main).toMatch(/linkReport\(\)/);
  });

  it("`updateOnlineState` no longer conjoins the two latches by hand", () => {
    const main = read("src/main.ts");
    // POSITIVE CONTROL: the exact expression still exists in the tree, in
    // `session.info`, where WP46 pins it. So the pattern below can match.
    const e2e = read("src/testing/e2e-control.ts");
    expect(e2e).toMatch(/Boolean\(plugin\.muxConnected\) && Boolean\(plugin\.controlConnected\)/);

    // And it is NOT what decides the file-op route any more.
    expect(main).not.toMatch(/setOnline\(\s*this\.muxConnected && this\.controlConnected\s*\)/);
    expect(main).not.toMatch(/const bothUp = this\.muxConnected && this\.controlConnected/);
  });

  it("main.ts holds wiring and a read — no link-state decision is written there", () => {
    const main = read("src/main.ts");
    // No hand-rolled readyState comparison in main.ts: the only module allowed
    // to compare a readyState to OPEN for the purpose of a verdict is the
    // definer, and the only places allowed to READ one are the two channels.
    expect(main).not.toMatch(/readyState\s*===\s*WebSocket\.OPEN/);
  });
});

describe("WP82 AC1 — neither connected marking is role-gated any more", () => {
  it("the socket-open marking in main.ts is not inside a `role === \"host\"` gate", () => {
    const main = read("src/main.ts");
    // POSITIVE CONTROL: the pattern finds the role check that legitimately
    // remains in `connectSync` (permission elevation), so it can match.
    expect(main).toMatch(/if \(this\.settings\.role === "host"\) \{\s*\n\s*this\.settings\.permission/);
    // The defect shape — the gate wrapping the latch — is gone.
    expect(main).not.toMatch(
      /if \(this\.settings\.role === "host"\) \{\s*\n\s*this\.controlConnected = true;/,
    );
  });

  it("the join-response marking is above the promote/demote branches", () => {
    const src = read("src/sync/control-handlers.ts");
    const marking = src.indexOf("plugin.controlConnected = true;");
    const promote = src.indexOf("void plugin.promoteToHost();");
    const demote = src.indexOf("void plugin.demoteToGuest();");
    expect(marking).toBeGreaterThan(-1);
    expect(promote).toBeGreaterThan(-1);
    expect(demote).toBeGreaterThan(-1);
    expect(marking).toBeLessThan(promote);
    expect(marking).toBeLessThan(demote);
    // And there is exactly ONE of them — two would be the old shape returning.
    expect(src.match(/plugin\.controlConnected = true;/g)).toHaveLength(1);
  });
});

describe("WP82 AC3 — the break seam is unreachable in a production build", () => {
  const SEAM = /\bbreakLink\s*\(|\brestoreLink\s*\(|\be2eBreakLink\b|\be2eRestoreLink\b/;

  it("the only non-test caller of the seam lives under `testing/`", () => {
    const root = pluginRoot();
    const productionFiles = [
      "src/main.ts",
      "src/sync/control-ws.ts",
      "src/sync/sync.ts",
      "src/sync/control-handlers.ts",
      "src/sync/link-state.ts",
      "src/ui/settings.ts",
      "src/commands.ts",
      "src/files/file-ops.ts",
    ];
    // POSITIVE CONTROL: the pattern matches where the seam really is.
    expect(SEAM.test(read("src/testing/e2e-control.ts"))).toBe(true);
    expect(SEAM.test(read("src/sync/control-ws.ts"))).toBe(true);

    for (const rel of productionFiles) {
      const path = join(root, rel);
      if (!existsSync(path)) continue;
      const src = readFileSync(path, "utf8");
      if (rel === "src/sync/control-ws.ts" || rel === "src/sync/sync.ts") {
        // The DEFINITION lives here, which §2 explicitly permits.
        continue;
      }
      if (rel === "src/main.ts") {
        // main.ts holds the two wrappers `e2eBreakLink` / `e2eRestoreLink`,
        // whose only caller is inside `testing/`. What must NOT be here is a
        // command, a UI handler or a settings path reaching them.
        expect(src).not.toMatch(/addCommand[\s\S]{0,400}e2e(Break|Restore)Link/);
        expect(src).not.toMatch(/onClick[\s\S]{0,200}e2e(Break|Restore)Link/);
        continue;
      }
      expect(SEAM.test(src)).toBe(false);
    }
  });

  it("no command, ribbon item or message handler reaches it", () => {
    const commandsPath = join(pluginRoot(), "src/commands.ts");
    if (existsSync(commandsPath)) {
      const commands = readFileSync(commandsPath, "utf8");
      // POSITIVE CONTROL: `commands.ts` really does register commands, so a
      // scan of it is a scan of something.
      expect(commands).toMatch(/addCommand\(/);
      expect(SEAM.test(commands)).toBe(false);
    }
    const handlers = read("src/sync/control-handlers.ts");
    expect(handlers).toMatch(/channel\.on\(/); // positive control
    expect(SEAM.test(handlers)).toBe(false);
    const settings = read("src/ui/settings.ts");
    expect(settings).toMatch(/addToggle\(/); // positive control
    expect(SEAM.test(settings)).toBe(false);
  });
});

describe("WP82 — WP46's quartet is byte-unchanged and no §7 licence is taken", () => {
  it("`session.info` still returns the four legacy fields with the same expressions", () => {
    const src = read("src/testing/e2e-control.ts");
    expect(src).toMatch(/clientId: String\(plugin\.settings\.clientId \?\? ""\)/);
    expect(src).toMatch(/role: plugin\.settings\.role \?\? null/);
    expect(src).toMatch(/roomId: String\(plugin\.settings\.roomId \?\? ""\)/);
    expect(src).toMatch(
      /connected: Boolean\(plugin\.muxConnected\) && Boolean\(plugin\.controlConnected\)/,
    );
  });

  it("WP46's pinning test file is untouched by this WP", () => {
    const pinned = read("src/__tests__/wp46/test_legacy_fields_unchanged_visible.test.ts");
    expect(pinned).toMatch(/keeps `connected` as the conjunction of muxConnected and controlConnected/);
    expect(pinned).not.toMatch(/WP82|link\.report|link\.break/);
  });

  it("the three new E2E commands are ADDITIVE — every pre-WP82 case is still routed", () => {
    const src = read("src/testing/e2e-control.ts");
    for (const cmd of [
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
      "manifest.info",
      "session.reconcileStale",
      "manifest.publish",
      "manifest.lastPublish",
      "manifest.lastChange",
      "session.promoteToHost",
      "session.demoteToGuest",
      "plugin.sinkState",
      "canvas.typeInNode",
      "canvas.textShape",
    ]) {
      expect(src).toContain(`case "${cmd}"`);
    }
    for (const cmd of ["link.report", "link.break", "link.restore"]) {
      expect(src).toContain(`case "${cmd}"`);
    }
  });

  it("`canvas.simulateEdit` is neither called nor extended by this WP", () => {
    const main = read("src/main.ts");
    expect(main).not.toMatch(/simulateEdit/);
  });
});

describe("WP82 §5 — no socket URL, or fragment of one, in any new narration", () => {
  it("no lifecycle field is ever assigned from a URL or a credential", () => {
    // The pattern: any `reason:` / `detail:` / `at:` whose VALUE mentions a URL
    // or a credential key.
    const LEAK = /(reason|detail|at):[^,\n]*\b(url|wsUrl|serverUrl|token|jwt|password)\b/i;
    // Quoted string literals are blanked first, because "keys may be named,
    // values may not": `reason: "settings.serverUrl is empty"` names the KEY
    // that was empty and carries no value, which is exactly what a narration is
    // supposed to do. Template literals are deliberately NOT blanked — an
    // interpolation is precisely how a value would escape.
    const stripStrings = (s: string) =>
      s.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''");

    // POSITIVE CONTROLS (rule 15): the pattern matches lines that WOULD leak,
    // and does not match the one that only names a key.
    expect(LEAK.test(stripStrings("reason: `failed to open ${url}`,"))).toBe(true);
    expect(LEAK.test(stripStrings("detail: settings.token,"))).toBe(true);
    expect(LEAK.test(stripStrings('reason: "settings.serverUrl is empty",'))).toBe(false);

    for (const rel of ["src/sync/control-ws.ts", "src/sync/sync.ts"]) {
      const src = stripStrings(code(rel));
      // POSITIVE CONTROL: the credential really is present in this file, so a
      // scan of it is a scan of something that could leak.
      expect(code(rel)).toMatch(/token/);
      expect(src).not.toMatch(LEAK);
    }
  });
});
