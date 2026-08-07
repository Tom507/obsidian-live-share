// WP21 / AC4 — "Tests that pinned the removed denial behaviour are deleted
// deliberately and enumerated by name in the implementation report; no test is
// left asserting a behaviour that no longer exists."
//
// AC4 has two halves and only one of them is mechanical:
//
//   ├── ENUMERATION (not covered here) — that each deletion is named in
//   │      `ImplementationReport_WP21.md` is a reporting obligation under the
//   │      BUILD_SPEC §7 deletion ledger, not a property of the code. It is
//   │      checked by the ledger, not by a unit test.
//   └── NO SURVIVOR (covered here) — after the deletion, no test file may still
//          reach for the removed seam. That IS mechanical, and it is the half
//          that silently rots: a test left behind either fails forever or, worse,
//          keeps passing against a `beforeEach` that no longer wires anything.
//
// THE SCAN HAS TWO HALVES, BECAUSE THE TWO RESIDUES ARE NOT ALIKE.
//
//   ├── HALF 1 — REMOVED SYMBOLS (`canWriteEntity`, `setCanWriteNode`,
//   │      `setCanDeleteNode`, `.denied`). These name code that no longer
//   │      exists, so there is NO assertion form in which they are legitimate.
//   │      This half is an exact, unforgiving substring scan with no exemptions.
//   └── HALF 2 — THE `LOCK DENIED:` SIGNATURE. A string, not a symbol, and the
//          distinction AC4 actually draws is about what the assertion CLAIMS:
//
//            ├── a POSITIVE expectation ("the signature was emitted" —
//            │      `toHaveLength(n>0)`, `toContain`, `toMatch`, `toBe(true)`,
//            │      `toBeGreaterThan`) pins a behaviour that no longer exists
//            │      and IS an offender, and
//            └── an ABSENCE expectation ("the signature was NOT emitted" —
//                   `toHaveLength(0)`, `toEqual([])`, `toBe(false)`, `.not.`)
//                   asserts the OPPOSITE of the removed behaviour. WP21 makes
//                   that claim permanently and structurally true. It is not a
//                   pin on removed behaviour; it is a statement of the removal.
//                   It MUST NOT be flagged.
//
// The exemption is deliberately FAIL-CLOSED, and deliberately NOT a filename or
// path allow-list. An allow-list would make this scan blind to a real future
// offender in whichever file was exempted — precisely the class it exists to
// catch. Instead an occurrence is an offender by DEFAULT and is exonerated only
// by an explicitly recognised absence form, so an assertion shape nobody
// anticipated stays red rather than slipping through.
//
// Assertions are matched as PAREN-BALANCED UNITS, not as lines. This repo writes
// its annotated assertions across four lines —
//
//     expect(
//       t.warns.some((m) => m.startsWith("LOCK DENIED:")),
//       "the baseline advanced — the divergence became invisible",
//     ).toBe(true);
//
// — and a line-local classifier would never see the `toBe(true)` that makes that
// one an offender.
//
// THE SCAN IS ALSO DISCRIMINATING ACROSS SPELLINGS, and it has to be, because
// three surviving things are spelt almost identically:
//
//   ├── `presence.canWriteNode(id)` / `computeCanWriteNode(...)` — the UX lock's
//   │      own API on `canvas-presence.ts`. It STAYS (AC2) and is not matched.
//   ├── `new CanvasBinding(doc, model, { canWriteNode })` — an option on the
//   │      FROZEN `canvas-binding.ts`, which this WP does not touch (only its
//   │      main.ts wiring goes). It stays and is not matched.
//   └── `canvasSync.setCanWriteNode(...)` / `.setCanDeleteNode(...)` — the
//          removed seam on `CanvasSync`. Only these are matched, because only
//          these are gone.
//
// WP21's own test files are excluded: this file and its siblings talk ABOUT the
// removed names in order to assert their absence.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const TESTS_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Every `*.test.ts` under `src/__tests__`, as repo-ish relative paths. */
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

/** WP21's own files reference the removed names on purpose. */
const isOwnFile = (rel: string) => /(^|\/)wp21(\/|_)/i.test(rel) || /wp21/i.test(rel);

/**
 * HALF 1 — the removed SYMBOLS. Exact and unforgiving: no exemptions and no
 * assertion-shape analysis, because there is no legitimate reason for any of
 * these to appear in a test file at all. Each is anchored so the surviving
 * presence/binding spellings (`canWriteNode`, `canDeleteNode`) cannot match.
 */
const REMOVED_SYMBOL: Array<{ pattern: RegExp; why: string }> = [
  {
    pattern: /\bsetCanWriteNode\b/,
    why: "names the removed per-node lock write-gate setter on CanvasSync",
  },
  {
    pattern: /\bsetCanDeleteNode\b/,
    why: "names the removed per-node lock delete-gate setter on CanvasSync",
  },
  {
    pattern: /\bcanWriteEntity\b/,
    why: "names the removed lock-seam gate directly",
  },
  {
    pattern: /\.denied\b/,
    why: "reads the removed `denied` list of a capture pass (the baseline hold)",
  },
];

/** HALF 2 — the removed denial SIGNATURE. */
const LOCK_DENIED = /LOCK DENIED/;

/**
 * The absence forms that exonerate a `LOCK DENIED:` occurrence, applied to the
 * whole paren-balanced assertion. Anything NOT on this list stays an offender.
 */
const ABSENCE_EXPECTATION: RegExp[] = [
  /\.not\./,
  /\.toHaveLength\s*\(\s*0\s*\)/,
  /\.toBe\s*\(\s*(?:0|false)\s*\)/,
  /\.to(?:Strict)?Equal\s*\(\s*\[\s*\]\s*\)/,
  /\.toBeUndefined\s*\(\s*\)/,
  /\.toBeNull\s*\(\s*\)/,
  /\.toBeFalsy\s*\(\s*\)/,
];

const isAbsenceClaim = (assertion: string) =>
  ABSENCE_EXPECTATION.some((pattern) => pattern.test(assertion));

/**
 * Every `expect(...)…;` in a source as ONE unit, paren-balanced across newlines,
 * with the 1-based line its `expect` starts on. The matcher chain is included by
 * running on to the terminating `;`, because the matcher — not the subject — is
 * what says whether the claim is positive or negative.
 */
function assertionsOf(source: string): Array<{ text: string; line: number }> {
  const units: Array<{ text: string; line: number }> = [];
  const pattern = /\bexpect\s*\(/g;
  let match: RegExpExecArray | null = pattern.exec(source);
  while (match !== null) {
    let depth = 0;
    let cursor = match.index + match[0].length - 1; // sits on the opening paren
    for (; cursor < source.length; cursor += 1) {
      if (source[cursor] === "(") depth += 1;
      else if (source[cursor] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    let end = cursor;
    while (end < source.length && source[end] !== ";") end += 1;
    units.push({
      text: source.slice(match.index, Math.min(end + 1, source.length)),
      line: source.slice(0, match.index).split("\n").length,
    });
    match = pattern.exec(source);
  }
  return units;
}

/**
 * The offenders in one file: every removed SYMBOL, plus every `LOCK DENIED:`
 * occurrence that is not an explicit absence claim. An occurrence inside no
 * assertion at all is reported too — fail-closed, because a helper that harvests
 * the signature exists only to feed one.
 */
function offendersIn(rel: string, source: string): string[] {
  const offenders: string[] = [];
  const lines = source.split(/\r?\n/);

  for (const { pattern, why } of REMOVED_SYMBOL) {
    lines.forEach((line, index) => {
      if (pattern.test(line)) offenders.push(`${rel}:${index + 1} — ${why}`);
    });
  }

  const assertions = assertionsOf(source);
  lines.forEach((line, index) => {
    if (!LOCK_DENIED.test(line)) return;
    const lineNo = index + 1;
    const enclosing = assertions.filter(
      (unit) => unit.line <= lineNo && unit.line + unit.text.split("\n").length - 1 >= lineNo,
    );
    if (enclosing.length > 0 && enclosing.every((unit) => isAbsenceClaim(unit.text))) return;
    offenders.push(
      enclosing.length > 0
        ? `${rel}:${lineNo} — asserts the removed denial signature IS emitted`
        : `${rel}:${lineNo} — harvests the removed denial signature outside any absence claim`,
    );
  });

  return offenders;
}

describe("WP21 AC4 — no surviving test pins the removed denial behaviour", () => {
  it("the test tree is non-empty and this scan actually reaches it", () => {
    const files = collectTestFiles(TESTS_ROOT);
    expect(
      files.length,
      "the scan found no test files at all — it is passing vacuously",
    ).toBeGreaterThan(20);
    expect(
      files.some((rel) => isOwnFile(rel)),
      "the scan cannot see WP21's own files, so its self-exclusion is untested",
    ).toBe(true);
    expect(
      files.some((rel) => rel.endsWith("canvas-sync.test.ts")),
      "the scan does not reach the suite most likely to pin the removed seam",
    ).toBe(true);
  });

  it("no test file outside WP21 still reaches for the removed lock write-denial seam", () => {
    const offenders: string[] = [];
    for (const rel of collectTestFiles(TESTS_ROOT)) {
      if (isOwnFile(rel)) continue;
      offenders.push(...offendersIn(rel, readFileSync(`${TESTS_ROOT}${rel}`, "utf8")));
    }

    expect(
      offenders,
      "these tests still pin a behaviour WP21 removed; delete them and enumerate each by name in ImplementationReport_WP21.md",
    ).toEqual([]);
  });

  it("the scan condemns a positive denial claim and spares an absence claim", () => {
    // Direction 1 — WHAT MUST STILL BITE. Without this half the predicate could
    // be softened into vacuity and nothing would notice.
    const offences: Array<[string, string]> = [
      [
        "positive-single-line.test.ts",
        '    expect(warns.filter((m) => m.startsWith("LOCK DENIED:"))).toHaveLength(1);',
      ],
      [
        "positive-multi-line.test.ts",
        [
          "    expect(",
          '      t.warns.some((m) => m.startsWith("LOCK DENIED:")),',
          '      "the baseline advanced — the divergence became invisible",',
          "    ).toBe(true);",
        ].join("\n"),
      ],
      [
        "positive-contains.test.ts",
        '    expect(warns).toContain("LOCK DENIED: a/b.canvas ids=[n1] (baseline held)");',
      ],
      [
        "positive-greater-than.test.ts",
        '    expect(warns.filter((m) => m.includes("LOCK DENIED:")).length).toBeGreaterThan(0);',
      ],
      [
        "removed-setter.test.ts",
        '    canvasSync.setCanWriteNode((_p, nodeId) => nodeId !== "n1");',
      ],
      ["removed-gate.test.ts", "    // the canWriteEntity gate refuses the write"],
      ["removed-list.test.ts", "    expect(applied.denied).toEqual([]);"],
    ];
    for (const [rel, source] of offences) {
      expect(
        offendersIn(rel, source),
        `the scan went blind to a genuine offender: ${source.trim()}`,
      ).not.toEqual([]);
    }

    // Direction 2 — WHAT MUST NOT BE CONDEMNED. The UX lock's own API, the
    // frozen binding's option, the authorisation seam, WP18's rejection list —
    // and, critically, an assertion that the removed signature is ABSENT, which
    // states the removal rather than pinning it.
    const survivors: Array<[string, string]> = [
      [
        "absence-count.test.ts",
        '    expect(warns.filter((m) => m.startsWith("LOCK DENIED:"))).toHaveLength(0);',
      ],
      ["absence-empty.test.ts", "    expect(denials(warns)).toEqual([]);"],
      [
        "absence-multi-line.test.ts",
        [
          "    expect(",
          '      warns.some((m) => m.startsWith("LOCK DENIED:")),',
          '      "the removed emitter still fires",',
          "    ).toBe(false);",
        ].join("\n"),
      ],
      [
        "absence-negated.test.ts",
        '    expect(warns.join("\\n")).not.toContain("LOCK DENIED:");',
      ],
      ["ux-lock-api.test.ts", '    expect(presence.canWriteNode("n1")).toBe(true);'],
      [
        "ux-lock-pure.test.ts",
        '    expect(computeCanDeleteNode(2, PATH, "n1", states)).toBe(false);',
      ],
      ["frozen-binding.test.ts", '      canWriteNode: (_path, id) => id !== "n1",'],
      ["authorisation.test.ts", "    canvasSync.setCanWrite(() => false);"],
      ["authorisation-binding.test.ts", "      canWrite: (p) => this.canWriteCanvasPath(p),"],
      ["wp18-rejection.test.ts", "    expect(applied.rejected).toHaveLength(1);"],
    ];
    for (const [rel, source] of survivors) {
      expect(
        offendersIn(rel, source),
        `the scan would wrongly condemn a surviving line: ${source.trim()}`,
      ).toEqual([]);
    }
  });
});
