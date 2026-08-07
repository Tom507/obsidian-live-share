// ===========================================================================
// WP88 AC1 — the route census, derived from the tree by REACHABILITY, with the
// mandatory reverse assertion (S53) and a positive control for every absence
// and presence claim (rule 15 and its cousin).
// ===========================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  deriveCensus,
  deriveConnectivityBranches,
  deriveResumeCatch,
  parseUnits,
  productionSources,
} from "./route-census";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, "..", "..");
const MAIN_SRC = readFileSync(join(SRC_ROOT, "main.ts"), "utf8");

/**
 * The PINNED disposition of every production unit that reaches
 * `SessionManager.endSession`. A new member cannot join unnoticed: the test
 * fails on any derived id that is not in this table.
 *
 *  - `user`          — the user asked. LEGITIMATE, and AC5's anti-lobotomy control.
 *  - `authoritative` — the relay or the host ANSWERED: kicked, join denied,
 *                      `session-end` broadcast. These are positive statements
 *                      from the other side, i.e. the exact opposite of the
 *                      local, negative, momentary evidence WP88 forbids acting
 *                      on. Legitimate, and NOT WP88's subject.
 *  - `start-join`    — `startSession` / `joinSession` / `joinWithInvite` failed
 *                      before a session existed. Recorded by the charter as the
 *                      same SHAPE with nobody owning it; a session that never
 *                      started has no identity worth retaining, so it is out of
 *                      WP88's scope by decision rather than by oversight.
 *  - `plumbing`      — the seam itself, or a unit that only forwards.
 *  - `registers`     — it does not call the destruction; it REGISTERS a handler
 *                      that can. This class exists because the deriver is a
 *                      name-based call graph and therefore OVER-approximates:
 *                      `connectSync` calls `registerControlHandlers`, which
 *                      installs the `kicked` / `session-end` / join-denied
 *                      handlers, so `connectSync` is transitively "reaching"
 *                      without any of its own branches reaching anything.
 *                      Over-approximation is the SAFE direction — it cannot
 *                      hide a route — and the precise statement about
 *                      `connectSync`'s four connectivity branches is made
 *                      structurally, per branch, further down.
 */
const DISPOSITION: Record<
  string,
  "user" | "authoritative" | "start-join" | "plumbing" | "registers"
> = {
  "main.ts#endSession": "plumbing",
  "main.ts#abortSession": "plumbing",
  "main.ts#startSession": "start-join",
  "main.ts#joinSession": "start-join",
  "main.ts#joinWithInvite": "start-join",
  "main.ts#showRibbonMenu": "user",
  "session/commands.ts#registerCommands": "user",
  "ui/settings.ts#display": "user",
  "sync/control-handlers.ts#registerControlHandlers": "authoritative",
  "main.ts#connectSync": "registers",
  "main.ts#resumeSession": "registers",
  "main.ts#onload": "registers",
  "main.ts#rearmSharing": "registers",
  "testing/e2e-control.ts#rearmSharing": "registers",
};

describe("WP88 AC1 — the census is derived, not written", () => {
  const sources = productionSources(SRC_ROOT);
  const census = deriveCensus(sources, ["endSession"]);

  it("parses a non-trivial number of units — an empty parse is not an empty census (S53)", () => {
    // WP86's deriver returned an empty set and every downstream assertion
    // passed on it. This is the floor that makes that impossible here.
    expect(census.unitCount).toBeGreaterThan(200);
  });

  it("REVERSE ASSERTION — the deriver finds NOTHING in a module with no such path", () => {
    const innocent = `
      export class Innocent {
        add(a: number, b: number) { return a + b; }
        describe() { return this.add(1, 2); }
      }
    `;
    const empty = deriveCensus([{ file: "innocent.ts", src: innocent }], ["endSession"]);
    expect(empty.unitCount).toBeGreaterThan(0); // it DID parse the module
    expect(empty.reaching).toEqual([]); // and found nothing
  });

  it("POSITIVE CONTROL — on the real tree it finds a member known to exist", () => {
    // `main.ts#endSession` calls `this.sessionManager.endSession()` at a line
    // the charter measured by hand. If the deriver cannot find THAT, it cannot
    // be trusted about anything it fails to find.
    expect(census.reaching).toContain("main.ts#endSession");
    expect(census.reaching).toContain("main.ts#abortSession");
  });

  it("every derived unit is dispositioned — a new route cannot join unnoticed", () => {
    const undisposed = census.reaching.filter((id) => !(id in DISPOSITION));
    expect(undisposed).toEqual([]);
  });

  it("the census is COMPLETE relative to the charter — and it found more than the charter listed", () => {
    // The charter enumerated seven rows. Reachability finds the three
    // `authoritative` sites in `control-handlers.ts` and the two user
    // affordances in `commands.ts` / `settings.ts` as well — carried up.
    expect(census.reaching).toContain("sync/control-handlers.ts#registerControlHandlers");
    expect(census.reaching).toContain("session/commands.ts#registerCommands");
    expect(census.reaching).toContain("ui/settings.ts#display");
  });

  // -------------------------------------------------------------------------
  // The five connectivity routes: SEVERED. Each asserted in its own row, with
  // the paired positive assertion that something else happens instead — an
  // absence alone would pass on a build where the branch was deleted.
  // -------------------------------------------------------------------------

  it("E1 / E2 / E3 / E4 — no connectivity branch inside connectSync reaches the destruction", () => {
    const branches = deriveConnectivityBranches(MAIN_SRC);
    // The deriver found all three branch bodies — without this the next three
    // assertions would pass vacuously on an empty list.
    expect(branches.map((b) => b.route).sort()).toEqual(["E1", "E2/E3", "E4"]);
    for (const branch of branches) {
      expect(branch.body).not.toMatch(/\bendSession\s*\(/);
      // The paired POSITIVE assertion: it halts instead.
      expect(branch.body).toMatch(/\bhaltSharing\s*\(/);
    }
  });

  it("E5 — the plugin-load resume's bare catch no longer reaches the destruction", () => {
    const body = deriveResumeCatch(MAIN_SRC);
    expect(body).not.toBeNull();
    expect(body as string).not.toMatch(/\babortSession\s*\(/);
    expect(body as string).not.toMatch(/\bendSession\s*\(/);
    expect(body as string).toMatch(/\bhaltSharing\s*\(/);
  });

  it("`connectSync` reaches the destruction ONLY by registering handlers — never by its own branches", () => {
    // The honest unit-level statement, and it is weaker than "connectSync is
    // not in the set" ON PURPOSE: a name-based graph cannot tell REGISTERING a
    // handler from CALLING it, and pretending otherwise would be a claim the
    // instrument cannot support. What it CAN say precisely is which edge put
    // the unit in the set.
    const edges = census.edges.filter((e) => e.from === "main.ts#connectSync").map((e) => e.callee);
    expect(edges.length).toBeGreaterThan(0); // it IS in the set — no vacuous pass
    expect(edges).not.toContain("endSession");
    expect(edges).not.toContain("abortSession");
    expect(edges).toContain("registerControlHandlers");

    const resumeEdges = census.edges
      .filter((e) => e.from === "main.ts#resumeSession")
      .map((e) => e.callee);
    expect(resumeEdges.length).toBeGreaterThan(0);
    expect(resumeEdges).not.toContain("endSession");
    expect(resumeEdges).not.toContain("abortSession");
  });

  it("`haltSharing` itself reaches nothing destructive — transitively", () => {
    const halt = parseUnits("main.ts", MAIN_SRC).find((u) => u.name === "haltSharing");
    expect(halt).toBeDefined();
    // The seam it must not reach, at any depth: its own reachability census.
    const haltCensus = deriveCensus(
      [{ file: "main.ts", src: (halt as { body: string }).body }],
      ["endSession", "abortSession", "cleanupSession"],
    );
    expect(haltCensus.reaching).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Rule 15 — the absence claim, with its pattern, its tool and its positive
  // control, restated as an executable assertion rather than as prose.
  // -------------------------------------------------------------------------

  it("rule 15 — no inherited test ASSERTS the destruction (pattern + positive control)", () => {
    // Pattern: the LITERAL `endSession`. Tool: `String.includes`, i.e. a fixed
    // substring, never a regex with a `.` wildcard (`grep -o` is forbidden by
    // the charter for having produced two false hits in this run).
    const testSources = productionTestSources();
    const hits = testSources.filter(
      (s) => s.src.includes("endSession") && !s.file.startsWith("wp88/"),
    );
    // POSITIVE CONTROL: the detector finds the one known-present occurrence.
    expect(hits.map((h) => h.file)).toEqual([
      "wp82/test_ac1_connected_marking_is_role_independent_visible.test.ts",
    ]);
    // And it is a no-op stub on a fake plugin, not an assertion.
    expect(hits[0].src).toMatch(/async endSession\(\)\s*\{\s*\}/);
  });
});

function productionTestSources(): { file: string; src: string }[] {
  const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
  const root = join(SRC_ROOT, "__tests__");
  const out: { file: string; src: string }[] = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      const relPath = rel ? `${rel}/${entry}` : entry;
      if (statSync(abs).isDirectory()) walk(abs, relPath);
      else if (entry.endsWith(".ts")) out.push({ file: relPath, src: readFileSync(abs, "utf8") });
    }
  };
  walk(root, "");
  return out;
}
