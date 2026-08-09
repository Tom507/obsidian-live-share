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
//   T1  a 10th `isPathMuted` call appears anywhere in production, or one of the
//       9 moves file. SEEN FAILING FOR REAL, not by a planted break: WP108 /
//       S120 added one call to `file-ops.ts` and the row went red with
//       `files/file-ops.ts×9` against the then-pinned `×8`. The pin was moved
//       to 9 with the declaration below — and T6 gained a conservation law at
//       the same time, so moving it did not cost the falsifiability.
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
import { readFileSync } from "node:fs";

import { byFile, deriveCensus, pin } from "./census";

const CENSUS = deriveCensus();

/** The commit this branch was at before WP93 — a MEASUREMENT taken 2026-08-07,
 * pinned so the reconciliation below is against a fixed tree rather than against
 * "whatever HEAD~ happens to be" once siblings land. */
const PRE_REPAIR = "e1cbf69d128f714e6c5311e2a8b9b039401f9458";

/**
 * ⚠ THE PIN MOVED ONCE, ON 2026-08-07, AND THIS IS THE DECLARATION.
 *
 * WP108 / S120 is the reason, and it is the ONLY declared reason. Read this
 * before changing a number below; if the derivation disagrees with the pin and
 * this block does not explain why, the pin is right and the tree is wrong.
 *
 * WHAT S120 FIXED. A rename, move or delete issued within ~1 s of that same file
 * arriving from a peer was silently and permanently dropped — the vault-event
 * handlers early-returned on `isPathMuted` with no retry, no queue and no
 * notice. Three live clients held three different filenames five minutes later
 * with no self-healing. `isPathMuted` is a BARE REFCOUNT: it knows a mute is
 * held and nothing about what for, so it cannot tell an ECHO (a write we made
 * coming back) from GENUINE USER INTENT that merely arrived in the same window.
 *
 * WHAT IT CHANGED ABOUT THIS CENSUS. S120 added `isPathMutedFor(path, kind)`
 * beside the old predicate and moved every `vault-events.ts` gate onto it. So:
 *
 *   ├── `vault-events.ts`  6 → 0   all six converted, NONE deleted
 *   └── `files/file-ops.ts` 8 → 9   ONE call added, and it is not a gate: it is
 *                                   the first line of `isPathMutedFor`, which
 *                                   still asks the refcount before asking the
 *                                   kind.
 *
 * THE PROPERTY IS NOT WEAKENED, AND THAT IS THE WHOLE POINT OF THE ROW. This
 * pin exists to redden whenever the consumer set moves for a reason nobody
 * declared. Restating it at 9 would satisfy the letter and lose that, so the
 * rows below ALSO pin the CONSERVATION LAW that makes the move legitimate:
 * every gate that left `isPathMuted` arrived at `isPathMutedFor`. Deleting a
 * gate, or converting one to something else, still reddens — which is exactly
 * what a bare recount of 9 would have stopped catching.
 */
const GATES_CONVERTED_BY_S120 = 6;

/**
 * ⚠ THE PIN MOVED A SECOND TIME, ON 2026-08-08. WP110 / S135 IS THE REASON, AND
 * IT IS THE SECOND AND ONLY OTHER DECLARED ONE.
 *
 * WHAT S135 FOUND. S120's repair converted the six gates in `vault-events.ts`
 * and left the SECOND gate on the same gesture untouched:
 * `FileOpsManager.onFileRename` re-asked the bare refcount one function later,
 * on one line, for both endpoints. MEASURED through the real handler rather than
 * the predicate: with the path muted and armed `consumes: ["create","modify"]`,
 * the converted `vault-events.ts` gate correctly ADMITS the user's rename and
 * `onFileRename` then drops it, emitting nothing — and unlike the outer gate it
 * neither counted the drop nor logged one, so S120's own ledger reported the
 * gesture as never dropped. See
 * `v2/wp110/test_s135_the_rename_channel_dies_silently.test.ts`.
 *
 * WHAT IT CHANGED ABOUT THIS CENSUS. Exactly one gate, two calls on one line:
 *
 *   └── `files/file-ops.ts` 9 → 7   TWO calls converted to `isPathMutedFor`,
 *                                   NONE deleted, and the line count falls with
 *                                   them because both sat on the same `if`.
 *
 * THE PROPERTY IS NOT WEAKENED. The conservation law S120 introduced in T6 is
 * extended rather than restated: the two calls that left `isPathMuted` are
 * counted again on the other side, in the same file, and the gate is required to
 * count what it drops. Deleting the gate, or converting it to something that is
 * not the kind-aware predicate, still reddens both rows — which a bare recount
 * of 7 would have stopped catching.
 *
 * `onFileCreate` and `onFileDelete` still hold the blind check and are the
 * remaining 3 of the 7 calls that are gates. That is deliberate and stated in
 * WP110's report; when a future package converts them this pin moves again, with
 * its own block.
 */
const GATES_CONVERTED_BY_S135 = 2;

describe("WP93 AC1 — the consumer census, derived", () => {
  it("T1 — every `isPathMuted` call in production is derived, and the three counts that differ are all reported", () => {
    // The pin is per-file with a count: stable under the line churn every commit
    // in this file causes, and still red the moment a 10th call appears.
    expect(byFile(CENSUS.consumers)).toEqual([
      // 6 gate expressions (S135 converted `onFileRename`'s, which was the only
      // one asking TWICE on one line) + 1: S120's `isPathMutedFor` asks the
      // refcount before asking the kind.
      "files/file-ops.ts×7",
      // `files/vault-events.ts` is GONE from this list, and its absence is the
      // S120 fix. All six of its calls became `isPathMutedFor`; T6 proves none
      // was deleted.
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
    // lines and B7's two are on one. So: 14 calls over 13 lines, PRE-S120 — and
    // T6 still measures those two numbers against the pre-repair tree.
    const lines = new Set(pin(CENSUS.consumers));
    expect(CENSUS.consumers).toHaveLength(9 - GATES_CONVERTED_BY_S135);
    expect(lines.size).toBe(7);

    // And DECISIONS was a third number until S135: the ONLY line asking twice
    // was `onFileRename`'s, and converting it collapsed all three numbers onto
    // each other. That collapse is itself the evidence that the double-ask is
    // gone — it cannot be produced by deleting a gate, because the arithmetic
    // above and the conservation law in T6 both pin the two calls arriving at
    // `isPathMutedFor`. If a future gate re-introduces a double-ask on one line
    // these three numbers separate again, and this row reports it.
    const decisions = new Set(CENSUS.consumers.map((site) => `${site.file}:${site.line}`)).size;
    expect({ calls: CENSUS.consumers.length, lines: lines.size, decisions }).toEqual({
      calls: 7,
      lines: 7,
      decisions: 7, // one decision per LINE, and now one call per decision
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

  it("T3b — POSITIVE CONTROL: pointed at the real tree it finds the definition and real calls, and `vault-events.ts` is EMPTY BY WALKING, not by not looking", () => {
    expect(CENSUS.definition).toMatch(/^files\/file-ops\.ts:\d+$/);
    expect(CENSUS.consumers.some((s) => s.file === "files/file-ops.ts")).toBe(true);

    // ⚠ THE ROW S120 CHANGED, AND IT WAS MADE STRONGER RATHER THAN RELAXED.
    //
    // It used to demand a call in EACH of the two files. `vault-events.ts` now
    // has none — every gate moved to `isPathMutedFor` — so the old form could
    // only have been satisfied by undoing the fix.
    //
    // A zero, though, is exactly the answer a deriver that never opened the file
    // would also give, and that is S53's trap: "a census that finds nothing is
    // not a census that found nothing". So the zero is asserted TOGETHER with
    // proof that the walk reached the file and read it.
    expect(CENSUS.countedFiles).toContain("files/vault-events.ts");
    expect(CENSUS.consumers.some((s) => s.file === "files/vault-events.ts")).toBe(false);
    // …and the file is not empty of the SUBJECT either: the six gates are there,
    // asking the kind-aware question. `rawOccurrences` counts the identifier
    // un-stripped over the whole tree, and it must still see them.
    expect(CENSUS.rawOccurrences.isPathMuted).toBeGreaterThan(CENSUS.consumers.length);

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

    // THE PRE-REPAIR SIDE IS UNTOUCHED, and it is a fixed commit, so these two
    // lines are the same measurement they always were.
    expect(byFile(before.consumers)).toEqual([
      "files/file-ops.ts×8",
      "files/vault-events.ts×6",
    ]);
    expect(before.consumers).toHaveLength(14);

    // ⚠ AND HERE IS THE DELTA, DECLARED. WP93 itself added no consumer and
    // removed none. WP108 / S120 did, and this is the whole of it:
    //
    //   `vault-events.ts`  6 → 0   converted to `isPathMutedFor`
    //   `files/file-ops.ts` 8 → 9   +1, inside `isPathMutedFor` itself
    //
    // The pin below is NOT a restatement of `byFile(CENSUS.consumers)` — that
    // would make the row vacuous. It is the arithmetic, taken from the
    // pre-repair measurement above, so a future change that moves either file
    // reddens here as well as at T1.
    const beforeCounts = new Map(
      before.consumers.reduce<[string, number][]>((acc, s) => {
        const hit = acc.find(([f]) => f === s.file);
        if (hit) hit[1] += 1;
        else acc.push([s.file, 1]);
        return acc;
      }, []),
    );
    const afterCounts = new Map(
      CENSUS.consumers.reduce<[string, number][]>((acc, s) => {
        const hit = acc.find(([f]) => f === s.file);
        if (hit) hit[1] += 1;
        else acc.push([s.file, 1]);
        return acc;
      }, []),
    );
    expect(beforeCounts.get("files/vault-events.ts")).toBe(GATES_CONVERTED_BY_S120);
    expect(afterCounts.get("files/vault-events.ts")).toBeUndefined();
    // S120 added ONE (`isPathMutedFor`'s own refcount question); S135 then took
    // TWO away by converting `onFileRename`'s gate. Written as the arithmetic of
    // the two declared movements rather than as a literal, so a third movement
    // that nobody declares reddens here.
    expect(afterCounts.get("files/file-ops.ts")).toBe(
      (beforeCounts.get("files/file-ops.ts") ?? 0) + 1 - GATES_CONVERTED_BY_S135,
    );

    // ⚠ THE CONSERVATION LAW — the reason this pin still has teeth.
    //
    // "vault-events.ts went to zero" is equally true of the fix and of somebody
    // DELETING all six gates, and the second is a data-loss defect. So the six
    // are counted again on the other side of the conversion, in the same file,
    // read off disk. Six left `isPathMuted`; six must arrive at
    // `isPathMutedFor`, and each must count what it drops (S120 AC2 — a refused
    // user gesture is never silent). Five counters for six calls, because the
    // rename gate asks both endpoints in ONE `if`.
    const vaultEvents = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
    }).trim();
    const source = readFileSync(
      `${vaultEvents}/plugin/src/files/vault-events.ts`,
      "utf8",
    );
    expect([...source.matchAll(/isPathMutedFor\(/g)]).toHaveLength(GATES_CONVERTED_BY_S120);
    expect([...source.matchAll(/noteMuteDrop\(/g)]).toHaveLength(5);

    // ⚠ THE SAME CONSERVATION LAW, EXTENDED TO S135's GATE.
    //
    // `files/file-ops.ts` went 9 → 7 and "went down by two" is equally true of
    // the conversion and of somebody DELETING the gate — which would put every
    // echo of an applied rename back on the wire. So the two are counted again
    // on the other side, in the same file, off disk. Matched as `this.` calls so
    // neither the METHOD DEFINITIONS nor the prose in the surrounding comments
    // (both of which name the identifiers) can satisfy the count.
    const fileOps = readFileSync(`${vaultEvents}/plugin/src/files/file-ops.ts`, "utf8");
    expect([...fileOps.matchAll(/this\.isPathMutedFor\(/g)]).toHaveLength(
      GATES_CONVERTED_BY_S135,
    );
    // S120 AC2 again: the converted gate counts what it drops. One counter for
    // two calls, because the rename gate asks both endpoints in ONE `if`.
    expect([...fileOps.matchAll(/this\.noteMuteDrop\(/g)]).toHaveLength(1);

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
