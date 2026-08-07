// WP28 / AC2 blind2 — the copy name checked against an INDEPENDENTLY WRITTEN
// reference formatter, on an adversarial path table.
//
// Different angle: the AC gives a literal template, `<name>.conflict-<date>.canvas`.
// This file writes that template out once, from the AC text, as three lines that
// import nothing, and then demands byte agreement on a table of paths chosen to
// break naive implementations:
//
//   ├── a stem that is itself an extension-looking string (`notes.md.canvas`),
//   ├── a stem ending in a dot,
//   ├── a folder whose name contains `.canvas`,
//   ├── a hidden-file stem (`.hidden.canvas`), and
//   └── a stem that already looks like a conflict copy.
//
// The folder-containing-`.canvas` row is the one that catches the most plausible
// wrong implementation there is: `path.replace(".canvas", suffix)`, which
// replaces the FIRST occurrence and writes the archive into a folder that does
// not exist, silently failing or creating a stray directory.

import { describe, expect, it } from "vitest";

import { conflictCopyPath } from "../../../../../plugin/src/canvas/canvas-epoch";

const EXT = ".canvas";

/** The template, written from the AC text. Imports nothing. */
function referenceCopyPath(canvasPath: string, date: string): string {
  const stem = canvasPath.slice(0, canvasPath.length - EXT.length);
  return `${stem}.conflict-${date}${EXT}`;
}

const PATHS = [
  "plan.canvas",
  "boards/plan.canvas",
  "notes.md.canvas",
  "boards/trailing..canvas",
  "my.canvas.folder/board.canvas",
  "deep/my.canvas.folder/nested.canvas.folder/board.canvas",
  ".hidden.canvas",
  "boards/.hidden.canvas",
  "boards/plan.conflict-2020-01-01.canvas",
  "a/b/c/d/e/f/g/h/i/j/k.canvas",
  "боард/план.canvas",
  "boards/with space and (parens).canvas",
];

const DATE = "2026-11-11";

describe("WP28 AC2 blind2 — the copy name matches the AC's template exactly", () => {
  it.each(PATHS)("%s", (path) => {
    expect(conflictCopyPath(path, DATE)).toBe(referenceCopyPath(path, DATE));
  });

  it("a folder containing `.canvas` is never rewritten", () => {
    const out = conflictCopyPath("my.canvas.folder/board.canvas", DATE);
    expect(
      out,
      "`path.replace(\".canvas\", …)` replaced the FIRST occurrence and moved the archive " +
        "into a folder that does not exist",
    ).toBe("my.canvas.folder/board.conflict-2026-11-11.canvas");
    expect(out.startsWith("my.canvas.folder/")).toBe(true);
  });

  it("only ONE `.conflict-` marker is introduced per call", () => {
    for (const path of PATHS) {
      const out = conflictCopyPath(path, DATE);
      const introduced = out.split(".conflict-").length - path.split(".conflict-").length;
      expect(introduced, `${path} gained ${introduced} markers`).toBe(1);
    }
  });

  it("the last path segment is the only one that changes", () => {
    for (const path of PATHS) {
      const out = conflictCopyPath(path, DATE);
      const inSegments = path.split("/");
      const outSegments = out.split("/");
      expect(outSegments.length, path).toBe(inSegments.length);
      expect(outSegments.slice(0, -1), `folders moved for ${path}`).toEqual(
        inSegments.slice(0, -1),
      );
      expect(outSegments[outSegments.length - 1]).not.toBe(inSegments[inSegments.length - 1]);
    }
  });

  it("the output is stable across repeated calls and across dates", () => {
    for (const date of [DATE, "2026-11-12", "9999-12-31"]) {
      for (const path of PATHS) {
        expect(conflictCopyPath(path, date)).toBe(conflictCopyPath(path, date));
        expect(conflictCopyPath(path, date)).toBe(referenceCopyPath(path, date));
      }
    }
  });

  it("refuses inputs that are not a `.canvas` path", () => {
    for (const bad of [
      "boards/plan",
      "boards/plan.md",
      "boards/plan.canvas/",
      "boards/plancanvas",
      ".canvas",
      "",
      "   ",
    ]) {
      expect(() => conflictCopyPath(bad, DATE), `\`${bad}\` was accepted`).toThrow();
    }
  });

  it("refuses a date that is empty, padded, or carries a separator", () => {
    for (const bad of ["", "\n", " 2026-11-11", "2026-11-11 ", "x/y", "x\\y", "."]) {
      expect(
        () => conflictCopyPath("boards/plan.canvas", bad),
        `\`${JSON.stringify(bad)}\` was accepted as a date`,
      ).toThrow();
    }
  });
});
