// WP24 / AC1 — blind counterpart 1 to the path/predicate contract.
//
// Different angle: instead of asserting the literals one by one, this test
// reconstructs each path from its PARTS and then attacks the predicate with a
// generated adversarial corpus — every path that shares a prefix with the
// sidecar directory but is not inside it, plus the sidecar directory reached by
// three different spellings. A predicate written as `startsWith(SIDECAR_DIR)`
// or as an extension whitelist dies on different rows of that corpus.

import { describe, expect, it } from "vitest";

import {
  SIDECAR_CHECKPOINT_EXT,
  SIDECAR_DIR,
  SIDECAR_HISTORY_EXT,
  SIDECAR_INDEX_FILENAME,
  isSidecarPath,
  sidecarCheckpointPath,
  sidecarHistoryPath,
  sidecarIndexPath,
} from "../../../../../plugin/src/files/canvas-sidecar";

const GUIDS = ["a", "9f", "guid-with-dashes", "0f2a9c6e1b4d47aa9d316c0e2f8b5a70"];

describe("WP24 AC1 blind1 — the directory is one segment under .obsidian/liveshare", () => {
  it("SIDECAR_DIR decomposes into exactly the three expected segments", () => {
    expect(SIDECAR_DIR.split("/")).toEqual([".obsidian", "liveshare", "state"]);
  });

  it("the two extensions are distinct, dot-prefixed and not substrings of each other", () => {
    expect(SIDECAR_HISTORY_EXT.startsWith(".")).toBe(true);
    expect(SIDECAR_CHECKPOINT_EXT.startsWith(".")).toBe(true);
    expect(SIDECAR_HISTORY_EXT).not.toBe(SIDECAR_CHECKPOINT_EXT);
    expect(SIDECAR_CHECKPOINT_EXT.includes(SIDECAR_HISTORY_EXT)).toBe(false);
    expect(SIDECAR_INDEX_FILENAME.endsWith(".json")).toBe(true);
  });

  it("every guid produces a history/checkpoint pair that differs only in the extension", () => {
    for (const guid of GUIDS) {
      const history = sidecarHistoryPath(guid);
      const checkpoint = sidecarCheckpointPath(guid);
      expect(history.slice(0, -SIDECAR_HISTORY_EXT.length)).toBe(
        checkpoint.slice(0, -SIDECAR_CHECKPOINT_EXT.length),
      );
      expect(history.split("/").slice(0, 3).join("/")).toBe(SIDECAR_DIR);
    }
  });

  it("the index path is not guid-derived and is stable across calls", () => {
    expect(sidecarIndexPath()).toBe(sidecarIndexPath());
    for (const guid of GUIDS) expect(sidecarIndexPath()).not.toBe(sidecarHistoryPath(guid));
  });
});

describe("WP24 AC1 blind1 — adversarial corpus for isSidecarPath", () => {
  const INSIDE = [
    ".obsidian/liveshare/state/a.yhistory",
    ".obsidian/liveshare/state/a.ycheckpoint",
    ".obsidian/liveshare/state/index.json",
    ".obsidian/liveshare/state/no-extension",
    ".obsidian/liveshare/state/.hidden",
    ".obsidian/liveshare/state/nested/deep/file.bin",
  ];

  const OUTSIDE = [
    ".obsidian/liveshare/state",
    ".obsidian/liveshare/state.md",
    ".obsidian/liveshare/statement.canvas",
    ".obsidian/liveshare/state2/a.yhistory",
    ".obsidian/liveshare/",
    ".obsidian/plugins/live-share/main.js",
    "state/a.yhistory",
    "vault/.obsidian/liveshare/state/a.yhistory",
    "a.yhistory",
    "",
  ];

  it("accepts every path inside the directory, whatever it is named", () => {
    for (const path of INSIDE) expect(isSidecarPath(path), path).toBe(true);
  });

  it("rejects every near miss, including prefix-sharing siblings", () => {
    for (const path of OUTSIDE) expect(isSidecarPath(path), path).toBe(false);
  });

  it("agrees with itself across separator and prefix spellings of one file", () => {
    const canonical = ".obsidian/liveshare/state/x.yhistory";
    const spellings = [
      canonical,
      `./${canonical}`,
      `/${canonical}`,
      canonical.replace(/\//g, "\\"),
      `.\\${canonical.replace(/\//g, "\\")}`,
    ];
    for (const spelling of spellings) expect(isSidecarPath(spelling), spelling).toBe(true);
  });
});
