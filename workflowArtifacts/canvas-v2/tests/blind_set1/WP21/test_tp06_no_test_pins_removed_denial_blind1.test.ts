// WP21 AC4 blind1 — the survivors hunted by the ASSERTION they make, not by the
// setter they call.
//
// The visible test scans for the injection calls (`.setCanWriteNode(`, …). A
// test can pin removed behaviour without ever calling a setter: it can assert on
// the held baseline, on the `denied` list, or on the private
// `lastWrittenContent` NOT advancing. Those are the residues a mechanical
// "delete every line that mentions the setter" pass leaves behind, and they are
// the ones that keep passing for the wrong reason afterwards.
//
// The scan therefore targets the CLAIM:
//
//   ├── a baseline that is asserted to be HELD (the removed AC4 of WP4/US2),
//   ├── an `applied.denied` / `.denied` list read from a capture result, and
//   └── a POSITIVE claim on the `LOCK DENIED:` signature.
//
// THE POLARITY RULE (the correction that keeps this scan honest). AC4 forbids a
// test "asserting a behaviour that no longer exists". An assertion that the
// `LOCK DENIED:` signature is ABSENT — `toHaveLength(0)`, `toEqual([])`,
// `toBe(false)`, `.not.…` — asserts the OPPOSITE of the removed behaviour, and
// WP21 makes that claim permanently and structurally true. It states the
// removal; it does not pin it. Flagging it would be a false positive, and a
// scan that cannot tell a positive expectation from a negative one is not
// measuring AC4 at all.
//
// The exemption is FAIL-CLOSED and is NEVER a filename or path allow-list: an
// occurrence is an offender by DEFAULT and is exonerated only by an explicitly
// recognised absence form, so an unanticipated assertion shape stays red rather
// than slipping through, and no file is ever made invisible to the scan.
//
// The removed SYMBOLS (`canWriteEntity`, `setCanWriteNode`, `setCanDeleteNode`,
// `.denied`) get no polarity analysis and no exemption whatsoever — they name
// code that no longer exists, so no assertion form makes them legitimate.
//
// Every pattern is paired with a survivor line that must NOT match, so the scan
// cannot start demanding the deletion of tests AC2 and AC3 require to stay —
// `baselineOf(...)` used to assert the baseline ADVANCED is legitimate and stays.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const TESTS_ROOT = fileURLToPath(new URL("../../", import.meta.url));

function collectTestFiles(dir: string, prefix = ""): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      found.push(...collectTestFiles(`${dir}/${entry.name}`, rel));
      continue;
    }
    if (entry.name.endsWith(".test.ts")) found.push(rel);
  }
  return found;
}

const isOwnFile = (rel: string) => /wp21/i.test(rel);

/**
 * The claims that pin removed behaviour under ANY polarity — a HELD baseline and
 * the removed symbols. No exemptions: there is no assertion form in which these
 * are legitimate after WP21.
 */
const REMOVED_CLAIMS: Array<{ pattern: RegExp; why: string }> = [
  {
    pattern: /baseline\s+(?:is\s+|was\s+)?HELD/i,
    why: "asserts the diff baseline is HELD — the removed baseline-hold on denial",
  },
  {
    pattern: /\.denied\b/,
    why: "reads or asserts the removed `denied` list of a capture pass",
  },
  {
    pattern: /\bcanWriteEntity\b/,
    why: "names the removed lock-seam gate directly",
  },
  {
    pattern: /setCan(?:Write|Delete)Node/,
    why: "injects the removed per-node lock gate",
  },
];

/**
 * The removed denial SIGNATURE, which is polarity-sensitive: only a claim that
 * it IS emitted pins removed behaviour. See THE POLARITY RULE in the header.
 */
const DENIAL_SIGNATURE = /LOCK DENIED/;

/** Absence forms that exonerate a signature occurrence. Fail-closed: this list
 * is the ONLY way out, and it is about what the assertion claims — never about
 * which file it lives in. */
const ABSENCE_EXPECTATION: RegExp[] = [
  /\.not\./,
  /\.toHaveLength\s*\(\s*0\s*\)/,
  /\.toBe\s*\(\s*(?:0|false)\s*\)/,
  /\.to(?:Strict)?Equal\s*\(\s*\[\s*\]\s*\)/,
  /\.toBeUndefined\s*\(\s*\)/,
  /\.toBeFalsy\s*\(\s*\)/,
];

/**
 * `expect(...)…;` as ONE paren-balanced unit. blind1's angle is the CLAIM, and a
 * claim written across four lines (this repo's annotated-assertion house style)
 * is invisible to a line-local classifier — so the unit, not the line, is what
 * gets its polarity read.
 */
function assertionsOf(source: string): Array<{ text: string; line: number; span: number }> {
  const units: Array<{ text: string; line: number; span: number }> = [];
  const pattern = /\bexpect\s*\(/g;
  let match: RegExpExecArray | null = pattern.exec(source);
  while (match !== null) {
    let depth = 0;
    let cursor = match.index + match[0].length - 1;
    for (; cursor < source.length; cursor += 1) {
      if (source[cursor] === "(") depth += 1;
      else if (source[cursor] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    let end = cursor;
    while (end < source.length && source[end] !== ";") end += 1;
    const text = source.slice(match.index, Math.min(end + 1, source.length));
    units.push({
      text,
      line: source.slice(0, match.index).split("\n").length,
      span: text.split("\n").length,
    });
    match = pattern.exec(source);
  }
  return units;
}

function offendersIn(rel: string, source: string): string[] {
  const offenders: string[] = [];
  const lines = source.split(/\r?\n/);

  for (const { pattern, why } of REMOVED_CLAIMS) {
    lines.forEach((line, index) => {
      if (pattern.test(line)) offenders.push(`${rel}:${index + 1} — ${why}`);
    });
  }

  const assertions = assertionsOf(source);
  lines.forEach((line, index) => {
    if (!DENIAL_SIGNATURE.test(line)) return;
    const lineNo = index + 1;
    const enclosing = assertions.filter(
      (unit) => unit.line <= lineNo && unit.line + unit.span - 1 >= lineNo,
    );
    const exonerated =
      enclosing.length > 0 &&
      enclosing.every((unit) => ABSENCE_EXPECTATION.some((p) => p.test(unit.text)));
    if (exonerated) return;
    offenders.push(`${rel}:${lineNo} — claims the removed denial signature IS emitted`);
  });

  return offenders;
}

/** Lines that survive WP21 and must never be flagged. */
const SURVIVORS = [
  "    expect(baselineOf(\"test.canvas\")).toBe(after); // clean pass advances again",
  "    expect(presence.canWriteNode(\"n1\")).toBe(true);",
  "    canvasSync.setCanWrite(() => false);",
  "    expect(applied.rejected).toHaveLength(1);",
  "      canWrite: (p) => this.canWriteCanvasPath(p),",
  // The polarity correction, pinned: an ABSENCE claim on the removed signature
  // states the removal and is not an offender.
  "    expect(warns.filter((m) => m.startsWith(\"LOCK DENIED:\"))).toHaveLength(0);",
  "    expect(denials(warns)).toEqual([]);",
];

/** Lines that MUST be flagged, so the polarity rule cannot hide a real pin. */
const MUST_BITE = [
  "    expect(warns.filter((m) => m.startsWith(\"LOCK DENIED:\"))).toHaveLength(1);",
  "    expect(warns).toContain(\"LOCK DENIED: a/b.canvas ids=[n1] (baseline held)\");",
  "    expect(baselineOf(PATH)).toBe(before); // AC4: baseline HELD",
  "    canvasSync.setCanWriteNode((_p, nodeId) => nodeId !== \"n1\");",
  "    expect(applied.denied).toEqual([\"n1\"]);",
];

describe("WP21 AC4 blind1 — no test still asserts the removed denial CLAIM", () => {
  it("the scan is wired to a real, non-trivial test tree", () => {
    const files = collectTestFiles(TESTS_ROOT);
    expect(files.length, "the scan sees no test files — it would pass vacuously").toBeGreaterThan(
      20,
    );
    expect(
      files.filter((rel) => isOwnFile(rel)).length,
      "the scan cannot see WP21's own files, so its self-exclusion is unproven",
    ).toBeGreaterThan(0);
  });

  it("no surviving assertion pins a denial, a held baseline or the removed gate", () => {
    const offenders: string[] = [];
    for (const rel of collectTestFiles(TESTS_ROOT)) {
      if (isOwnFile(rel)) continue;
      offenders.push(...offendersIn(rel, readFileSync(`${TESTS_ROOT}${rel}`, "utf8")));
    }

    expect(
      offenders.sort(),
      "these assertions pin behaviour WP21 removed; delete the owning tests and name each one in ImplementationReport_WP21.md",
    ).toEqual([]);
  });

  it("the scan still bites a positive denial claim and spares an absence claim", () => {
    for (const line of MUST_BITE) {
      expect(
        offendersIn("scratch.test.ts", line),
        `the scan went blind to a genuine pin: ${line.trim()}`,
      ).not.toEqual([]);
    }
    for (const line of SURVIVORS) {
      expect(
        offendersIn("scratch.test.ts", line),
        `a surviving assertion would be wrongly condemned: ${line.trim()}`,
      ).toEqual([]);
    }
  });
});
