// WP26 / AC4 (+ AC1) — the predicate's own truth table.
//
// AC4: "Existing `.canvas` exclusion behaviour is unchanged." The natural refactor
// for this WP turns a one-line `endsWith` into a two-clause predicate, and that is
// exactly the edit that quietly widens or narrows the `.canvas` case. The table
// below is split into two FROZEN lists so that either direction of drift is a
// named failure and not a missing row:
//
//   CANVAS_TRUE   — every input that returns true today because of `.canvas`.
//                   A narrowing refactor (`lastIndexOf(".")`, a regex anchored on
//                   `/`, an extension whitelist keyed on a basename) drops one of
//                   these.
//   MUST_STAY_FALSE — near misses that return false today and are NOT sidecar
//                   paths. A widening refactor (`includes(".canvas")`,
//                   `endsWith("canvas")`, a case-insensitive compare) picks one up.
//
// The sidecar rows are built from `SIDECAR_DIR` and WP24's path helpers rather
// than from a re-spelt literal, and the sidecar near-misses are there to catch a
// `startsWith(SIDECAR_DIR)` implementation of the new clause — the composition
// must not be looser than the predicate it composes.

import { describe, expect, it } from "vitest";

import {
  SIDECAR_DIR,
  isSidecarPath,
  sidecarCheckpointPath,
  sidecarHistoryPath,
  sidecarIndexPath,
} from "../../../files/canvas-sidecar";
import { skipsAutoTextSync } from "../../../utils";

/** True today, purely because of the `.canvas` clause. Must stay true. */
const CANVAS_TRUE = [
  "board.canvas",
  "notes/board.canvas",
  "a/b/c/deep board.canvas",
  ".canvas",
  "notes/.canvas",
  "board.md.canvas",
  "spaced name.canvas",
];

/** False today, not a sidecar path. Must stay false. */
const MUST_STAY_FALSE = [
  "foo.canvas.md",
  "notcanvas",
  "canvas",
  "notes/canvas",
  "board.canvas/",
  "board.canvas/child.md",
  "board.Canvas",
  "board.CANVAS",
  "board.canvasx",
  "board.canvas.txt",
  "notes/hello.md",
  "images/photo.png",
  "",
];

/** False today AND must stay false: sidecar near misses. */
const SIDECAR_NEAR_MISSES = [
  SIDECAR_DIR,
  `${SIDECAR_DIR}/`,
  `${SIDECAR_DIR}ful/notes.md`,
  `notes/${SIDECAR_DIR}/index.json`,
  SIDECAR_DIR.slice(0, SIDECAR_DIR.lastIndexOf("/")),
  `${SIDECAR_DIR.slice(0, SIDECAR_DIR.lastIndexOf("/"))}/notes.md`,
];

/** Must become true: real files under the sidecar directory. */
const SIDECAR_TRUE = [
  sidecarIndexPath(),
  sidecarHistoryPath("abc"),
  sidecarCheckpointPath("abc"),
  `${SIDECAR_DIR}/nested/deep/file.md`,
  `${SIDECAR_DIR}/no-extension`,
  `${SIDECAR_DIR}/future.unknownext`,
];

describe("WP26 AC4 — the existing `.canvas` behaviour is bit-for-bit unchanged", () => {
  it("every path that skips auto text sync today because it is a canvas still does", () => {
    for (const path of CANVAS_TRUE) {
      expect(skipsAutoTextSync(path), `expected true for ${JSON.stringify(path)}`).toBe(true);
    }
  });

  it("no near miss of `.canvas` is picked up by the new clause", () => {
    for (const path of MUST_STAY_FALSE) {
      expect(skipsAutoTextSync(path), `expected false for ${JSON.stringify(path)}`).toBe(false);
    }
  });

  it("the `.canvas` rows are decided by the canvas clause, not by the sidecar clause", () => {
    // If any CANVAS_TRUE row were also a sidecar path, the first assertion above
    // could be satisfied by the sidecar clause alone and would stop pinning AC4.
    for (const path of CANVAS_TRUE) {
      expect(isSidecarPath(path), `${path} must not be a sidecar path`).toBe(false);
    }
  });
});

describe("WP26 AC1 — the sidecar clause is exactly as wide as WP24's predicate", () => {
  it("every real file under the sidecar directory skips auto text sync", () => {
    for (const path of SIDECAR_TRUE) {
      expect(skipsAutoTextSync(path), `expected true for ${JSON.stringify(path)}`).toBe(true);
    }
  });

  it("the directory itself and its prefix-sharing neighbours are untouched", () => {
    for (const path of SIDECAR_NEAR_MISSES) {
      expect(skipsAutoTextSync(path), `expected false for ${JSON.stringify(path)}`).toBe(false);
    }
  });

  it("the composed predicate is exactly `.canvas` OR sidecar — no wider, no narrower", () => {
    const corpus = [
      ...CANVAS_TRUE,
      ...MUST_STAY_FALSE,
      ...SIDECAR_NEAR_MISSES,
      ...SIDECAR_TRUE,
      `${SIDECAR_DIR}/board.canvas`,
      `${SIDECAR_DIR}/nested/board.canvas`,
    ];
    for (const path of corpus) {
      const expected = path.endsWith(".canvas") || isSidecarPath(path);
      expect(skipsAutoTextSync(path), `disagreement on ${JSON.stringify(path)}`).toBe(expected);
    }
  });
});
