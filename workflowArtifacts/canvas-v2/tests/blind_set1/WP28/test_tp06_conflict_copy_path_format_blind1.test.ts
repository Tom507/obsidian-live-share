// WP28 / AC2 blind1 — `conflictCopyPath` attacked as an INJECTIVE FUNCTION over
// a generated corpus, with an explicit inverse.
//
// Different angle: rather than checking a handful of expected strings, generate
// 60 (path, date) pairs, map them all, and assert three algebraic properties at
// once —
//
//   ├── every image is a `.canvas` in the SAME folder as its source,
//   ├── the map is INJECTIVE (no two distinct inputs collide), and
//   └── it is INVERTIBLE: stripping `.conflict-<date>.canvas` gives back the
//          original stem, so nothing was silently trimmed, lower-cased,
//          normalised or truncated on the way through.
//
// Injectivity is the property with teeth. An implementation that slugifies the
// stem (spaces to dashes, unicode stripped) produces a perfectly plausible name
// and quietly maps two different boards' conflicts onto ONE file — the second
// conflict overwrites the first, and the work that was archived first is the work
// that is lost.

import { describe, expect, it } from "vitest";

import { conflictCopyPath } from "../../../../../plugin/src/canvas/canvas-epoch";

const STEMS = [
  "plan",
  "Plan",
  "plan copy",
  "plan-copy",
  "plan_copy",
  "plan.copy",
  "PLAN",
  "Retro – Nov",
  "Rétro",
  "рабочий",
  "board (1)",
  "board [2]",
  "a",
  "x".repeat(120),
  "2026-08-02",
  "conflict",
  "plan.conflict-2020-01-01",
];

const FOLDERS = ["", "boards/", "a/b/c/", "team notes/", "архив/"];
const DATES = ["2026-08-02", "2026-01-01", "20260802", "2026-08-02T09-30-00"];

function allPaths(): string[] {
  const out: string[] = [];
  for (const folder of FOLDERS) for (const stem of STEMS) out.push(`${folder}${stem}.canvas`);
  return out;
}

function folderOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "" : path.slice(0, cut + 1);
}

describe("WP28 AC2 blind1 — the conflict-copy name is a well-behaved function", () => {
  it("every image is a `.canvas` in its source's own folder", () => {
    for (const path of allPaths()) {
      const out = conflictCopyPath(path, "2026-08-02");
      expect(out.endsWith(".canvas"), out).toBe(true);
      expect(folderOf(out), `${path} was archived outside its own folder`).toBe(folderOf(path));
      expect(out).not.toBe(path);
    }
  });

  it("is INJECTIVE across the whole corpus — no two boards share a copy", () => {
    const seen = new Map<string, string>();
    for (const date of DATES) {
      for (const path of allPaths()) {
        const out = conflictCopyPath(path, date);
        const key = `${out}`;
        const previous = seen.get(key);
        expect(
          previous,
          `\`${path}\` (${date}) collides with \`${previous}\` on \`${out}\` — the second ` +
            "conflict overwrites the first archive",
        ).toBeUndefined();
        seen.set(key, `${path} @ ${date}`);
      }
    }
    expect(seen.size).toBe(DATES.length * allPaths().length);
  });

  it("is INVERTIBLE — the original stem comes back verbatim", () => {
    for (const date of DATES) {
      for (const path of allPaths()) {
        const out = conflictCopyPath(path, date);
        const suffix = `.conflict-${date}.canvas`;
        expect(out.endsWith(suffix), `${out} does not carry the expected suffix`).toBe(true);
        const recovered = `${out.slice(0, out.length - suffix.length)}.canvas`;
        expect(
          recovered,
          `\`${path}\` came back as \`${recovered}\` — something was trimmed, cased or slugified`,
        ).toBe(path);
      }
    }
  });

  it("the date appears exactly once, in the suffix", () => {
    const out = conflictCopyPath("boards/2026-08-02.canvas", "2026-08-02");
    expect(out).toBe("boards/2026-08-02.conflict-2026-08-02.canvas");
    expect(out.split("2026-08-02")).toHaveLength(3);
  });

  it("applying it twice nests rather than replacing — no silent idempotence", () => {
    const once = conflictCopyPath("boards/plan.canvas", "2026-08-02");
    const twice = conflictCopyPath(once, "2026-08-03");
    expect(twice).toBe("boards/plan.conflict-2026-08-02.conflict-2026-08-03.canvas");
    expect(twice).not.toBe(once);
  });

  it("refuses every non-canvas input in the corpus", () => {
    for (const stem of STEMS.slice(0, 8)) {
      for (const ext of ["", ".md", ".json", ".canvas.md", ".Canvas"]) {
        expect(() => conflictCopyPath(`boards/${stem}${ext}`, "2026-08-02")).toThrow();
      }
    }
  });

  it("refuses a date that would move the copy or break the name", () => {
    for (const bad of ["", " ", "a/b", "a\\b", "..", "  2026-08-02  "]) {
      expect(
        () => conflictCopyPath("boards/plan.canvas", bad),
        `\`${bad}\` was accepted as a date`,
      ).toThrow();
    }
  });
});
