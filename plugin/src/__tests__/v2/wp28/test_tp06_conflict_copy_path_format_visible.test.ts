// WP28 / AC2 — the `<name>.conflict-<date>.canvas` FORMAT.
//
// WP28 owns this format and WP30 imports it; the Shared Ownership Contract §1
// says in as many words that "WP30 never formats a conflict name itself". So the
// format is a deliverable, not an implementation detail, and it is pinned here
// as a whole string rather than by a `toContain("conflict")`.
//
// The two mistakes that actually happen:
//
//   ├── APPENDING instead of REPLACING — `plan.canvas.conflict-2026-08-02.canvas`
//   │      or `plan.canvas.conflict-2026-08-02`. Obsidian keys the canvas view on
//   │      the `.canvas` extension, so the second one is not a canvas at all and
//   │      the first is a file the user cannot tell from a backup of a backup.
//   └── LOSING THE DIRECTORY — `plan.conflict-….canvas` written at the vault root
//          instead of beside the board. The user opens the folder they were
//          working in and their work is not there.
//
// `date` is a PARAMETER because a pure core may not read a clock (BUILD_SPEC §3:
// the `reconcile-plan.ts` precedent). That also makes the format testable without
// freezing time.

import { describe, expect, it } from "vitest";

import { conflictCopyPath } from "../../../canvas/canvas-epoch";

describe("WP28 AC2 — `conflictCopyPath` produces `<name>.conflict-<date>.canvas`", () => {
  it("replaces the extension and keeps the folder", () => {
    expect(conflictCopyPath("boards/plan.canvas", "2026-08-02")).toBe(
      "boards/plan.conflict-2026-08-02.canvas",
    );
  });

  it("a vault-root canvas stays at the vault root", () => {
    expect(conflictCopyPath("plan.canvas", "2026-08-02")).toBe("plan.conflict-2026-08-02.canvas");
  });

  it("a deeply nested canvas keeps every segment of its folder", () => {
    expect(conflictCopyPath("a/b/c/d/board.canvas", "2026-01-01")).toBe(
      "a/b/c/d/board.conflict-2026-01-01.canvas",
    );
  });

  it("only the TRAILING `.canvas` is replaced — dotted names survive intact", () => {
    expect(conflictCopyPath("boards/my.big.board.canvas", "2026-08-02")).toBe(
      "boards/my.big.board.conflict-2026-08-02.canvas",
    );
    expect(conflictCopyPath("boards/plan.canvas.canvas", "2026-08-02")).toBe(
      "boards/plan.canvas.conflict-2026-08-02.canvas",
    );
  });

  it("spaces and unicode in the name are carried through untouched", () => {
    expect(conflictCopyPath("team notes/Retro – Q3.canvas", "2026-08-02")).toBe(
      "team notes/Retro – Q3.conflict-2026-08-02.canvas",
    );
  });

  it("the result is never the source path, and always ends in `.canvas`", () => {
    for (const path of [
      "plan.canvas",
      "boards/plan.canvas",
      "a/b/c.canvas",
      "boards/plan.canvas.canvas",
    ]) {
      const out = conflictCopyPath(path, "2026-08-02");
      expect(out).not.toBe(path);
      expect(out.endsWith(".canvas")).toBe(true);
      expect(out).toContain(".conflict-2026-08-02.canvas");
      expect(
        out.split("/").slice(0, -1).join("/"),
        `the archive for ${path} was written outside its own folder`,
      ).toBe(path.split("/").slice(0, -1).join("/"));
    }
  });

  it("distinct dates give distinct copies, so a second conflict cannot overwrite the first", () => {
    const first = conflictCopyPath("boards/plan.canvas", "2026-08-02");
    const second = conflictCopyPath("boards/plan.canvas", "2026-08-03");
    expect(first).not.toBe(second);
  });

  it("is deterministic — the same inputs give the same path", () => {
    expect(conflictCopyPath("boards/plan.canvas", "2026-08-02")).toBe(
      conflictCopyPath("boards/plan.canvas", "2026-08-02"),
    );
  });

  it("refuses a path that is not a `.canvas`", () => {
    for (const bad of ["notes/journal.md", "plan", "plan.canvasx", "boards/plan.CANVAS", ""]) {
      expect(
        () => conflictCopyPath(bad, "2026-08-02"),
        `\`${bad}\` was accepted — the archive would not be a canvas`,
      ).toThrow();
    }
  });

  it("refuses a blank date — an unnamed archive is not findable", () => {
    for (const bad of ["", "   ", "\t"]) {
      expect(() => conflictCopyPath("boards/plan.canvas", bad)).toThrow();
    }
  });

  it("refuses a date carrying a path separator — the copy cannot escape its folder", () => {
    for (const bad of ["2026/08/02", "../../etc", "a\\b"]) {
      expect(
        () => conflictCopyPath("boards/plan.canvas", bad),
        `\`${bad}\` was accepted as a date — the archive lands outside the board's folder`,
      ).toThrow();
    }
  });

  it("refuses a non-string path or date rather than stringifying it", () => {
    expect(() => conflictCopyPath(undefined as never, "2026-08-02")).toThrow();
    expect(() => conflictCopyPath("boards/plan.canvas", undefined as never)).toThrow();
    expect(() => conflictCopyPath(7 as never, "2026-08-02")).toThrow();
  });
});
