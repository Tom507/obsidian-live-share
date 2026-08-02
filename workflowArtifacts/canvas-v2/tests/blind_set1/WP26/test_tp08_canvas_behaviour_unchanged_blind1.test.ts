// WP26 / AC4 blind 1 — "existing `.canvas` behaviour is unchanged", expressed as
// two FROZEN VERDICT LISTS rather than as a hand-written table.
//
// Different angle: AC4 is a no-regression claim, and the honest form of a
// no-regression claim is a snapshot of the verdicts as they were BEFORE the
// change, replayed afterwards. The two lists below were taken from the predicate
// as it stood at `return path.endsWith(".canvas")`. Every input in `WAS_TRUE`
// returned true then and must return true now; every input in `WAS_FALSE`
// returned false then and, because none of them is a file under the replica
// directory, must return false now. Nothing is derived from the implementation,
// so a rewrite of the predicate cannot rewrite its own oracle.
//
// The corpus is built to break the four rewrites this refactor invites:
//
//   `includes(".canvas")`         → dies on the DIRECTORY rows
//   `endsWith("canvas")`          → dies on `notcanvas`, `mycanvas`
//   basename/extension parsing    → dies on the bare `.canvas` and dotfile rows
//   a case-insensitive compare    → dies on the capitalisation rows
//
// A fifth row class covers the interaction: a `.canvas` INSIDE the replica
// directory must be true — but for the replica reason, not by accident.

import { describe, expect, it } from "vitest";

import { SIDECAR_DIR, isSidecarPath } from "../../../../../plugin/src/files/canvas-sidecar";
import { skipsAutoTextSync } from "../../../../../plugin/src/utils";

const WAS_TRUE = [
  "board.canvas",
  "a.canvas",
  "notes/board.canvas",
  "one/two/three/four/board.canvas",
  ".canvas",
  "notes/.canvas",
  "..canvas",
  "board .canvas",
  "board.md.canvas",
  "board.canvas.canvas",
  "Board.canvas",
  "БОРД.canvas",
  "board-2026.canvas",
  "board.CANVAS.canvas",
];

const WAS_FALSE = [
  "",
  "canvas",
  "notcanvas",
  "mycanvas",
  ".canvasx",
  "board.canvas ",
  "board.canvas/",
  "board.canvas/inner.md",
  "board.canvas/inner.png",
  "canvas/board.md",
  "board.Canvas",
  "board.CANVAS",
  "board.canvas.md",
  "board.canvas.txt",
  "notes/hello.md",
  "notes/data.json",
  "images/pic.png",
  ".obsidian/plugins/x/main.js",
];

describe("WP26 AC4 blind1 — the frozen TRUE list is unchanged", () => {
  it("every input that skipped auto text sync before WP26 still does", () => {
    const regressions = WAS_TRUE.filter((path) => skipsAutoTextSync(path) !== true);
    expect(regressions).toEqual([]);
  });

  it("and none of them owes its verdict to the new replica clause", () => {
    // If any row were also a replica path, the assertion above could be satisfied
    // by the new clause alone and would stop pinning AC4 at all.
    const contaminated = WAS_TRUE.filter((path) => isSidecarPath(path));
    expect(contaminated).toEqual([]);
  });
});

describe("WP26 AC4 blind1 — the frozen FALSE list is unchanged", () => {
  it("no input that did NOT skip before WP26 has started skipping", () => {
    const widened = WAS_FALSE.filter((path) => skipsAutoTextSync(path) !== false);
    expect(widened).toEqual([]);
  });

  it("and none of them is a replica path, so the list is a fair test", () => {
    const contaminated = WAS_FALSE.filter((path) => isSidecarPath(path));
    expect(contaminated).toEqual([]);
  });
});

describe("WP26 AC1 blind1 — the two clauses do not interfere", () => {
  it("a canvas inside the replica directory is skipped", () => {
    for (const tail of ["board.canvas", "deep/nested/board.canvas"]) {
      expect(skipsAutoTextSync(`${SIDECAR_DIR}/${tail}`)).toBe(true);
    }
  });

  it("a NON-canvas file inside the replica directory is skipped too", () => {
    // The row that the canvas clause cannot answer: if the replica clause were
    // absent, every one of these would be false.
    const tails = ["index.json", "abc.yhistory", "abc.ycheckpoint", "notes.md", "bare"];
    const missed = tails.filter((tail) => !skipsAutoTextSync(`${SIDECAR_DIR}/${tail}`));
    expect(missed).toEqual([]);
  });

  it("the replica clause did not inherit the canvas clause's shape", () => {
    // `endsWith`-flavoured versions of the replica test: none of these names a
    // file inside the directory, so none may skip.
    const notInside = [
      SIDECAR_DIR,
      `${SIDECAR_DIR}/`,
      `x/${SIDECAR_DIR}`,
      `x/${SIDECAR_DIR}/y.md`,
      `${SIDECAR_DIR}-backup/y.md`,
      `${SIDECAR_DIR}ful/y.md`,
    ];
    const widened = notInside.filter((path) => skipsAutoTextSync(path) !== false);
    expect(widened).toEqual([]);
  });

  it("the canvas clause did not inherit the replica clause's shape", () => {
    // Directory-flavoured versions of the canvas test.
    const notACanvasFile = ["board.canvas/", "board.canvas/child.md", "canvas/child.md"];
    const widened = notACanvasFile.filter((path) => skipsAutoTextSync(path) !== false);
    expect(widened).toEqual([]);
  });
});
