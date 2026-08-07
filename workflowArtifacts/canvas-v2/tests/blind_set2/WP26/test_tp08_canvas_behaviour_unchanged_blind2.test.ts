// WP26 / AC4 blind 2 — "existing `.canvas` behaviour is unchanged", attacked as a
// GENERATED differential against a reference implementation of the old predicate.
//
// Different angle: blind 1 freezes two hand-picked lists. This one keeps a
// verbatim copy of the pre-WP26 body as a reference function and then generates
// several hundred paths from a grammar of prefixes, stems, separators and
// suffixes. For every generated path the rule is:
//
//     skipsAutoTextSync(p)  ===  legacyPredicate(p) || isSidecarPath(p)
//
// and, separately and more strictly, the two directions are checked apart so a
// failure names WHICH way the predicate drifted:
//
//   * legacy true  → still true            (no narrowing of the canvas case)
//   * legacy false, not replica → false    (no widening onto anything else)
//
// A generated corpus reaches inputs no author writes down: empty segments, a stem
// that is itself the extension, trailing separators inside deep paths, and the
// replica directory embedded at every position. `legacyPredicate` is a copy, not
// an import, so it cannot follow the implementation when the implementation moves.

import { describe, expect, it } from "vitest";

import { SIDECAR_DIR, isSidecarPath } from "../../../../../plugin/src/files/canvas-sidecar";
import { skipsAutoTextSync } from "../../../../../plugin/src/utils";

/** Verbatim copy of `skipsAutoTextSync`'s body as of the WP26 charter. */
function legacyPredicate(path: string): boolean {
  return path.endsWith(".canvas");
}

const PREFIXES = [
  "",
  "notes/",
  "a/b/c/",
  ".obsidian/",
  ".obsidian/liveshare/",
  `${SIDECAR_DIR}/`,
  `${SIDECAR_DIR}ful/`,
  `${SIDECAR_DIR}/deep/`,
  `x/${SIDECAR_DIR}/`,
];

const STEMS = ["board", "canvas", ".canvas", "not", "", "my.board", "BOARD", "b o a r d"];

const SUFFIXES = [
  ".canvas",
  ".Canvas",
  ".CANVAS",
  ".canvas.md",
  ".md",
  ".json",
  ".yhistory",
  "canvas",
  "",
  "/",
  ".canvas/",
  ".canvas/inner.md",
];

function corpus(): string[] {
  const out = new Set<string>();
  for (const prefix of PREFIXES) {
    for (const stem of STEMS) {
      for (const suffix of SUFFIXES) {
        out.add(`${prefix}${stem}${suffix}`);
      }
    }
  }
  out.add(SIDECAR_DIR);
  out.add(`${SIDECAR_DIR}/`);
  out.add("");
  return [...out];
}

const CORPUS = corpus();

describe("WP26 AC4 blind2 — a generated differential against the pre-WP26 predicate", () => {
  it("the corpus is large enough and covers both verdicts of the old predicate", () => {
    expect(CORPUS.length).toBeGreaterThan(300);
    expect(CORPUS.some((path) => legacyPredicate(path))).toBe(true);
    expect(CORPUS.some((path) => !legacyPredicate(path))).toBe(true);
    expect(CORPUS.some((path) => isSidecarPath(path))).toBe(true);
  });

  it("NO NARROWING — everything the old predicate skipped is still skipped", () => {
    const lost = CORPUS.filter((path) => legacyPredicate(path) && !skipsAutoTextSync(path));
    expect(lost).toEqual([]);
  });

  it("NO WIDENING — nothing outside the replica directory has started skipping", () => {
    const gained = CORPUS.filter(
      (path) => !legacyPredicate(path) && !isSidecarPath(path) && skipsAutoTextSync(path),
    );
    expect(gained).toEqual([]);
  });

  it("COMPLETE — every file under the replica directory now skips", () => {
    const missed = CORPUS.filter((path) => isSidecarPath(path) && !skipsAutoTextSync(path));
    expect(missed).toEqual([]);
  });

  it("the whole corpus satisfies the composed rule exactly", () => {
    const disagreements = CORPUS.filter(
      (path) => skipsAutoTextSync(path) !== (legacyPredicate(path) || isSidecarPath(path)),
    );
    expect(disagreements).toEqual([]);
  });
});

describe("WP26 AC4 blind2 — the predicate is still a pure function of its argument", () => {
  it("repeated calls agree with each other", () => {
    for (const path of CORPUS) {
      const first = skipsAutoTextSync(path);
      expect(skipsAutoTextSync(path)).toBe(first);
      expect(skipsAutoTextSync(path)).toBe(first);
    }
  });

  it("call order does not change any verdict", () => {
    const forward = CORPUS.map((path) => skipsAutoTextSync(path));
    const backward = [...CORPUS].reverse().map((path) => skipsAutoTextSync(path));
    expect(backward.reverse()).toEqual(forward);
  });
});
