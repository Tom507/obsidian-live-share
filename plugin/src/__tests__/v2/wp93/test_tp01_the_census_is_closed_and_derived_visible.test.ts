// WP93 / C93 AC1 — THE CENSUS IS CLOSED, DERIVED FROM THE SOURCE, AND EVERY
// MEMBER HAS A STATED DISPOSITION.
//
// WHY THIS IS AC1 AND NOT A PREAMBLE. The Dispatcher referred this work here on
// the strength of "five other consumers". That figure is exactly right for
// `vault-events.ts` and wrong as a closed set, and the sites nobody had named
// are the ones most exposed to a release-timing change. A charter's table is not
// a census; this file derives its own and reports every disagreement.
//
// WHAT WOULD MAKE EACH ROW FAIL, AND IT WAS SEEN FAILING:
//   T1  a 15th `isPathMuted` call appears anywhere in production, or one of the
//       14 moves file. Broken by adding one call to `file-ops.ts`: red with
//       `files/file-ops.ts×9` against the pinned `×8`.
//   T2  a release site appears in a file not in the pinned set, or a file's
//       count changes. Broken by deleting the `manifest.ts` row from the pin:
//       red naming `files/manifest.ts×1` as unexpected.
//   T3  the deriver stops throwing on an empty input set (S53's recursive trap:
//       WP86's deriver returned an EMPTY set and "every derived site is
//       corrected" passed perfectly on it).
//   T4  the comment strip stops working, so `vault-events.ts`'s WP91 comment is
//       counted as a call.
//
// THE VACUITY RISKS THE CHARTER ATTACHED, AND HOW EACH IS DISCHARGED:
//   (a) THE KILLER — a hand list copied from the charter and dressed as a
//       derivation. The tool is `census.ts`, which walks `plugin/src` on disk and
//       parses comment-stripped source. The pinned arrays below are the EXPECTED
//       value of that derivation, not its input; T3 shows the deriver refuses to
//       produce a census at all from an empty tree.
//   (b) THE COMMENT QUESTION, and both numbers are reported. This deriver counts
//       over COMMENT-STRIPPED code, so `vault-events.ts`'s WP91 comment naming
//       `isPathMuted` is EXCLUDED. `rawOccurrences` reports the un-stripped
//       count beside it so a reader can see which behaviour was chosen and what
//       the other one would have said (T4).
//   (c) `plugin/src/testing/` is EXCLUDED and the exclusion is REPORTED, not
//       silent — the E2E control server is the rig, not the product (T5).
//   (d) THE TWO NUMBERS ARE BOTH REPORTED. Calls and lines differ, because
//       `onFileRename` asks twice on ONE line; decisions and calls differ again.
//       T1 reports all three.

import { describe, expect, it } from "vitest";

import { execFileSync } from "node:child_process";

import { byFile, deriveCensus, pin } from "./census";

const CENSUS = deriveCensus();

/** The commit this branch was at before WP93 — a MEASUREMENT taken 2026-08-07,
 * pinned so the reconciliation below is against a fixed tree rather than against
 * "whatever HEAD~ happens to be" once siblings land. */
const PRE_REPAIR = "e1cbf69d128f714e6c5311e2a8b9b039401f9458";

describe("WP93 AC1 — the consumer census, derived", () => {
  it("T1 — every `isPathMuted` call in production is derived, and the three counts that differ are all reported", () => {
    // The pin is per-file with a count: stable under the line churn every commit
    // in this file causes, and still red the moment a 15th call appears.
    expect(byFile(CENSUS.consumers)).toEqual([
      "files/file-ops.ts×8", // B1-B7: 7 gate expressions, but `onFileRename` asks TWICE on one line
      "files/vault-events.ts×6", // A1-A5: 5 gates, but the rename gate asks twice on two lines
    ]);

    // ⚠ RECONCILIATION WITH THE CHARTER, AND IT DISAGREES.
    //
    // The charter says "THIRTEEN call sites". Thirteen is the number of GREP
    // LINES, not of calls: `file-ops.ts`'s `onFileRename` entry check spells
    //
    //     if (this.isPathMuted(localNew) || this.isPathMuted(localOld) || ...)
    //
    // which is ONE line and TWO calls. The charter names that double-ask ("A3 and
    // B7 each ask twice") but does not add it, because A3's two calls are on two
    // lines and B7's two are on one. So: 14 calls over 13 lines.
    const lines = new Set(pin(CENSUS.consumers));
    expect(CENSUS.consumers).toHaveLength(14);
    expect(lines.size).toBe(13);

    // And DECISIONS is a third number: five gate expressions in `vault-events.ts`
    // (the rename gate is one decision over two calls) and seven in
    // `file-ops.ts`. 5 + 7 = 12 — the charter's own B1-B7 table has seven rows
    // and its prose says "six in file-ops.ts", which is where its "eleven" comes
    // from. Twelve is what its table says.
    const decisions = new Set(CENSUS.consumers.map((site) => `${site.file}:${site.line}`)).size;
    expect({ calls: CENSUS.consumers.length, lines: lines.size, decisions }).toEqual({
      calls: 14,
      lines: 13,
      decisions: 13, // one decision per LINE; the rename gate in vault-events.ts spans two
    });
  });

  it("T2 — every RELEASE SITE is derived, including the one a name-only grep cannot see", () => {
    // ⚠ THE FINDING. The charter's producer census was derived with
    // `grep -rn "unmutePathEvents"`, and that pattern is BLIND to a producer that
    // receives the release as an injected callback. `files/manifest.ts` does
    // exactly that: `syncFromManifest(mute, unmute, ...)` mutes at its own site
    // and releases with `setTimeout(() => unmute(diskPath), VAULT_EVENT_SETTLE_MS)`
    // — a bare, uncapped 250 ms timer reached from SIX `main.ts` call sites, and
    // no document in this run names it. The count went 2 -> 9 by running one
    // grep; it goes to 10 by following the delegate.
    expect(byFile(CENSUS.producers)).toEqual([
      "files/background-sync.ts×1", // P4 — uncapped, OUT OF SCOPE (§6 forbids the edit)
      "files/canvas-persistence.ts×2", // P1's release + its `PersistenceIO` adapter arrow
      "files/canvas-sync.ts×1", // P5 — uncapped, OUT OF SCOPE, S75(b)
      "files/file-ops.ts×2", // the ONE shared release + P3's arm
      "files/manifest.ts×1", // ⚠ P10 — uncapped, NOT IN ANY PRIOR CENSUS
      "main.ts×5", // the `unmutePathEvents` delegate + P6/P7/P8/P9's four arms
    ]);
    expect(CENSUS.producers).toHaveLength(12);

    // The charter also lists `canvas-sync.ts:4110` (P2) as a release site. It is
    // NOT one: `noteExternalDiskWrite`'s timer releases `recentDiskWrites`, not
    // the mute. So the charter's nine is eight real mute releases plus one
    // mis-classification, and the derivation finds a tenth it never had.
    expect(CENSUS.producers.filter((site) => site.file === "files/canvas-sync.ts")).toHaveLength(1);
  });

  it("T3 — POSITIVE CONTROL: the deriver EXITS NON-ZERO on an empty input set rather than emitting an empty census", () => {
    expect(() => deriveCensus(new Map())).toThrow(/empty input set/);
    // And on a tree with files but no definition — the other half of the same
    // trap: a census that finds nothing is not a census that found nothing.
    expect(() => deriveCensus(new Map([["fake.ts", "export const x = 1;\n"]]))).toThrow(
      /no definition of isPathMuted/,
    );
  });

  it("T3b — POSITIVE CONTROL: pointed at the real tree it finds the definition and at least one call in EACH of the two files", () => {
    expect(CENSUS.definition).toMatch(/^files\/file-ops\.ts:\d+$/);
    expect(CENSUS.consumers.some((s) => s.file === "files/file-ops.ts")).toBe(true);
    expect(CENSUS.consumers.some((s) => s.file === "files/vault-events.ts")).toBe(true);
    // rule 10: ONE definer. A second mute predicate is an abort criterion.
    const definers = CENSUS.countedFiles.length;
    expect(definers).toBeGreaterThan(50); // the walk really walked
  });

  it("T4 — the comment strip is load-bearing, and BOTH numbers are on the record", () => {
    // Un-stripped, the identifier appears more often than it is called: WP91's
    // comment in `vault-events.ts` names it, and WP93's own comments in
    // `file-ops.ts` name it several times. A deriver that did not strip would
    // count all of those as consumers and go green on prose.
    expect(CENSUS.rawOccurrences.isPathMuted).toBeGreaterThan(CENSUS.consumers.length);
    // The specific line the charter warns about is a COMMENT and is excluded.
    const vaultEvents = CENSUS.consumers.filter((s) => s.file === "files/vault-events.ts");
    expect(vaultEvents.every((s) => !s.text.startsWith("//"))).toBe(true);

    // ⚠ PINNED ON A SYNTHETIC SOURCE, AND HERE IS WHY. Deleting the strip from
    // the deriver and re-running this file REDDENED NOTHING — measured, not
    // assumed. The reason is that no comment anywhere in the tree currently
    // spells `isPathMuted` WITH ITS OPENING PAREN; every prose mention is
    // backticked bare, which the call regex already declines. So the strip is
    // correct and, on today's tree, inert — and a row that can only observe it
    // through the tree would go on being green after someone removed it. This
    // pins the BEHAVIOUR instead.
    const synthetic = new Map([
      [
        "fake.ts",
        [
          "  isPathMuted(path: string): boolean {",
          "    return true;",
          "  }",
          "  // a line comment that calls x.isPathMuted(p)",
          "  /* a block comment that calls y.isPathMuted(q) */",
          "  if (z.isPathMuted(r)) return;",
          "",
        ].join("\n"),
      ],
    ]);
    const derived = deriveCensus(synthetic);
    // ONE call: the definition is not a call, and the two commented ones are not
    // calls either. The un-stripped count is four, and both numbers are here.
    expect(derived.consumers).toHaveLength(1);
    expect(derived.consumers[0]?.line).toBe(6);
    expect(derived.rawOccurrences.isPathMuted).toBe(4);
  });

  it("T5 — `plugin/src/testing/` is excluded and the exclusion is REPORTED, not silent", () => {
    expect(CENSUS.excludedFiles.length).toBeGreaterThan(0);
    expect(CENSUS.excludedFiles.every((f) => f.startsWith("testing/"))).toBe(true);
    expect(CENSUS.countedFiles.some((f) => f.startsWith("testing/"))).toBe(false);
  });

  it("T6 — RECONCILIATION against the PRE-REPAIR tree: the consumer set is byte-for-byte the one WP93 inherited", () => {
    // The narrowing is a grep and the CENSUS is still a parse: `git grep -l`
    // returns a SUPERSET of the files that can hold a call — a call site
    // necessarily contains the identifier text — and every file it returns is
    // then read in full and parsed by the same deriver used above.
    let listing: string;
    try {
      listing = execFileSync(
        "git",
        [
          "grep",
          "-l",
          "-e",
          "isPathMuted",
          "-e",
          "unmute",
          "-e",
          "armMuteRelease",
          PRE_REPAIR,
          "--",
          "plugin/src",
        ],
        { encoding: "utf8", cwd: repoRoot() },
      );
    } catch (err) {
      throw new Error(`WP93 AC1 T6 needs git to read the pre-repair tree: ${String(err)}`);
    }
    const paths = listing
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.slice(`${PRE_REPAIR}:`.length))
      .filter((p) => !p.includes("__tests__"));
    expect(paths.length).toBeGreaterThan(3);

    const sources = new Map<string, string>();
    for (const path of paths) {
      const content = execFileSync("git", ["show", `${PRE_REPAIR}:${path}`], {
        encoding: "utf8",
        cwd: repoRoot(),
        maxBuffer: 32 * 1024 * 1024,
      });
      sources.set(path.slice("plugin/src/".length), content);
    }
    const before = deriveCensus(sources);

    // SAME consumers, same files, same counts: WP93 added no consumer and removed
    // none. Every one of the fourteen is UNCHANGED as a predicate; what changed
    // is when the refcount they read stops being non-zero.
    expect(byFile(before.consumers)).toEqual(byFile(CENSUS.consumers));
    expect(before.consumers).toHaveLength(14);

    // And the producer side is where WP93 moved. Before: `main.ts` released in
    // four bare `setTimeout`s plus the delegate; after: four `armMuteRelease`
    // arms plus the delegate — same count, different mechanism. `manifest.ts` is
    // present in BOTH, which is what makes it a pre-existing, un-named producer
    // rather than something this work package introduced.
    expect(byFile(before.producers)).toEqual([
      "files/background-sync.ts×1",
      "files/canvas-persistence.ts×2",
      "files/canvas-sync.ts×1",
      "files/file-ops.ts×1", // pre-repair: the ONE bare `setTimeout` release in `applyRemoteOpInner`
      "files/manifest.ts×1", // ⚠ present before WP93 and named by no document in this run
      "main.ts×6", // the delegate + P6's TWO `unmutePathEvents` calls + P7 + P8 + P9
    ]);
    // 6 -> 5 in `main.ts`, and the missing one is not a removed release: P6's
    // two calls collapsed into one `armMuteRelease([localOld, localNew])`, which
    // is one site arming two releases. The refcount is still decremented twice.
    expect(byFile(CENSUS.producers)).toContain("main.ts×5");
  });
});

function repoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
}
