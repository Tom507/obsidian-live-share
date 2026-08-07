// WP89 / AC2 — THE FALSIFIED-PREMISE CENSUS, DERIVED FROM THE TREE.
//
// The premise is *"an open canvas ignores external file writes"*. WP87 measured
// the opposite on two live instances: the write REBUILDS the open view, for a
// change to any card. The claim sat in the tree as a comment for months and
// THREE work packages reasoned from it. A comment several work packages read as
// a map is a specification with no test behind it, and the deliverable here is
// not "fix N comments" — it is to retire the class, by deriving the sites from
// the tree so a new occurrence cannot join the set unnoticed.
//
// ⚠ THIS DETECTOR DOES NOT STRIP COMMENTS, AND THAT INVERTS WP87's AC2 RULE.
// WP87's census ran over comment-STRIPPED source, because a detector that counts
// a mention in prose measures the prose — and that reddened three tests in this
// run. Here THE TARGET IS THE PROSE. The census therefore runs over raw source,
// and its reverse assertion is correspondingly different: a module known to
// carry no such claim must yield zero, and the real tree must yield a
// known-present member.
//
// S53 — THE RECURSIVE VACUITY, and it is the reason for `deriveSites`' throw.
// WP86's census deriver returned an EMPTY set and "every derived site is
// corrected" passed perfectly on it. After a repair, *"the class is empty"* and
// *"the deriver went blind"* produce the same output, so the deriver must be
// unable to report success on an empty input. It throws instead, and the
// corrections deliberately KEEP THE ORIGINAL SENTENCE VISIBLE, which means the
// pattern still finds every site after the repair — the deriver's own liveness
// is therefore observable at all times rather than only before it.
//
// S88/S99/S100 — WHAT THIS TEST DELIBERATELY DOES NOT DO. It does not compare
// the tree against a pinned pre-repair blob, and it does not attribute edits by
// grepping for a work-package token. Both are the "census over TEXT" family that
// has cost this run more false reds and false greens than any product defect,
// and `wp93/test_tp01` T6 (which does read the live working copy) reddened
// twice during B60's own break table with a sibling mid-save. The pre/post
// reconciliation lives in the implementation report as a measurement, not here
// as a test that a sibling's keystroke can flip.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * The premise, as a family of shapes rather than as one string.
 *
 * Matching only the literal `external write` finds ZERO in `canvas-sync.ts` and
 * would report the whole item closed — that is the filed item's own error and
 * the single failure this AC exists to prevent. Each alternative below is an
 * "X ignores external Y writes" shape; none of them is a hand-written list of
 * the sites, and a new site written in any of these shapes joins the set.
 */
const PREMISE =
  /\b(?:ignores|ignore|never (?:sees|reloads|re-reads))\b[^\n]{0,60}\bexternal\b[^\n]{0,40}\b(?:file|\.canvas|canvas)\b[^\n]{0,20}\bwrites?\b/i;

/** A site counts as corrected when its own comment block says so. */
const MARKER = "WP89-CORRECTED";

function productionSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Tests are not production sources. `testing/` is the E2E control surface
      // and ships in the bundle, so it stays in.
      if (entry === "__tests__" || entry === "node_modules") continue;
      productionSources(full, out);
    } else if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

export interface PremiseSite {
  file: string;
  line: number;
  text: string;
  corrected: boolean;
}

/**
 * The contiguous `//` comment block a line belongs to, as a line range.
 *
 * A correction is a note appended to the SAME block as the sentence it corrects,
 * so "is this site corrected?" is a question about the block, not about the one
 * matching line.
 */
function commentBlock(lines: string[], index: number): [number, number] {
  const isComment = (i: number) => i >= 0 && i < lines.length && /^\s*(\/\/|\*|\/\*)/.test(lines[i]);
  let start = index;
  while (isComment(start - 1)) start--;
  let end = index;
  while (isComment(end + 1)) end++;
  return [start, end];
}

export function deriveSites(): PremiseSite[] {
  const sites: PremiseSite[] = [];
  for (const file of productionSources(SRC)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((text, i) => {
      if (!PREMISE.test(text)) return;
      const [start, end] = commentBlock(lines, i);
      sites.push({
        file: file.slice(SRC.length).replace(/\\/g, "/"),
        line: i + 1,
        text: text.trim(),
        corrected: lines.slice(start, end + 1).some((l) => l.includes(MARKER)),
      });
    });
  }
  // S53: an empty derivation is INDISTINGUISHABLE from a repaired tree, so it is
  // never allowed to be reported as one. Exiting here rather than returning [] is
  // the whole of the third-deriver pattern.
  if (sites.length === 0) {
    throw new Error(
      "WP89 AC2 deriver produced an EMPTY census. That is a blind deriver, not a clean tree — " +
        "the corrections keep the original sentence, so every site must still match.",
    );
  }
  return sites;
}

describe("WP89 AC2 — the falsified premise, derived from the tree and corrected in place", () => {
  it("T1 the deriver is LIVE — positive control, half one: a known-present member is found", () => {
    // Half one of the two-halved control. If the pattern ever stops matching,
    // every assertion below goes green by finding nothing, so liveness is
    // asserted FIRST and against a site named explicitly.
    const sites = deriveSites();
    expect(
      sites.map((s) => s.file),
      "the deriver no longer sees `canvas-sync.ts` — it has gone blind",
    ).toContain("files/canvas-sync.ts");
    expect(sites.map((s) => s.file)).toContain("main.ts");
    expect(sites.length, "the census collapsed to a handful — the pattern narrowed").toBeGreaterThanOrEqual(8);
  });

  it("T2 the deriver DISCRIMINATES — positive control, half two: a clean module yields zero", () => {
    // Half two. A pattern that matched everything would satisfy T1 and prove
    // nothing. `canvas-shadow.ts` is a pure module that makes no claim about
    // Obsidian's reload behaviour at all.
    const sites = deriveSites();
    expect(
      sites.filter((s) => s.file === "canvas/canvas-shadow.ts"),
      "the pattern matched a module that carries no such claim",
    ).toEqual([]);
    expect(sites.filter((s) => s.file === "canvas/reconcile-plan.ts")).toEqual([]);
  });

  it("T3 EVERY derived site is corrected in place", () => {
    const uncorrected = deriveSites().filter((s) => !s.corrected);
    expect(
      uncorrected.map((s) => `${s.file}:${s.line} ${s.text}`),
      "a site asserts the falsified premise with no correction beside it. " +
        "Do not delete the sentence — three work packages reasoned from it. " +
        `Append a ${MARKER} note to the same comment block stating what was ` +
        "measured, where the measurement lives, and the ACTUAL reason the code " +
        "beneath it is right.",
    ).toEqual([]);
  });

  it("T4 the detector reads RAW source, comments included — asserted, not assumed", () => {
    // WP87's census stripped comments and this one must not: the target IS the
    // comment. Asserted by construction — every site the deriver returns is
    // inside a `//` block, so a comment-stripping detector would return none.
    const sites = deriveSites();
    expect(sites.length).toBeGreaterThan(0);
    for (const site of sites) {
      const line = readFileSync(join(SRC, site.file), "utf8").split("\n")[site.line - 1];
      expect(line.trimStart().startsWith("//"), `${site.file}:${site.line} is not a comment`).toBe(
        true,
      );
    }
  });

  it("T5 the positive controls of the census are NOT reworded", () => {
    // A census whose positive control moves has no control. These four carry
    // WP87's CORRECTED statement and are the fixed points the corrections above
    // cite; they are pinned verbatim and are not part of the derived set.
    const deferral = readFileSync(join(SRC, "canvas/canvas-editing-deferral.ts"), "utf8");
    const main = readFileSync(join(SRC, "main.ts"), "utf8");
    expect(deferral).toContain('*"Obsidian never reloads a canvas from an external write."* Measured on both');
    expect(deferral).toContain("nothing an external write could destroy");
    expect(main).toContain('*"Obsidian never reloads a canvas from an external write."* It was');
    expect(main).toContain("involved at all: an external write to the `.canvas` while a card's");
  });
});
