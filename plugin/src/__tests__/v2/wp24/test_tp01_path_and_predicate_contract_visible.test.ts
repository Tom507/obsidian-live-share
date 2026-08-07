// WP24 / AC1 — the file names AC1 states, plus the path predicate WP26 will
// consume instead of writing its own.
//
// This is the one place in the suite that asserts LITERAL strings, and it is
// legitimate here because those literals have a single author: the BUILD_SPEC's
// C24 interface line (`.obsidian/liveshare/state/<guid>.yhistory`,
// `<guid>.ycheckpoint`, `index.json`). Everywhere else in this suite paths come
// from the module's own helpers, so no other test can drift with the module.
//
// `isSidecarPath` is pinned here rather than in WP26 because the Shared
// Ownership Contract §1 makes WP24 its owner and forbids WP26 from writing its
// own prefix or suffix test — if WP24 does not test it, nothing does until a
// bug ships.

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
} from "../../../files/canvas-sidecar";

const GUID = "0f2a9c6e-1b4d-47aa-9d31-6c0e2f8b5a70";

describe("WP24 AC1 — sidecar constants and path helpers", () => {
  it("pins the four constants to the literals the BUILD_SPEC states", () => {
    expect(SIDECAR_DIR).toBe(".obsidian/liveshare/state");
    expect(SIDECAR_HISTORY_EXT).toBe(".yhistory");
    expect(SIDECAR_CHECKPOINT_EXT).toBe(".ycheckpoint");
    expect(SIDECAR_INDEX_FILENAME).toBe("index.json");
  });

  it("builds the three paths as <dir>/<guid><ext> and <dir>/index.json", () => {
    expect(sidecarHistoryPath(GUID)).toBe(`.obsidian/liveshare/state/${GUID}.yhistory`);
    expect(sidecarCheckpointPath(GUID)).toBe(`.obsidian/liveshare/state/${GUID}.ycheckpoint`);
    expect(sidecarIndexPath()).toBe(".obsidian/liveshare/state/index.json");
  });

  it("keeps the helpers and the constants in agreement (no second spelling)", () => {
    expect(sidecarHistoryPath(GUID)).toBe(`${SIDECAR_DIR}/${GUID}${SIDECAR_HISTORY_EXT}`);
    expect(sidecarCheckpointPath(GUID)).toBe(`${SIDECAR_DIR}/${GUID}${SIDECAR_CHECKPOINT_EXT}`);
    expect(sidecarIndexPath()).toBe(`${SIDECAR_DIR}/${SIDECAR_INDEX_FILENAME}`);
  });

  it("distinct guids never collide on a path", () => {
    expect(sidecarHistoryPath("a")).not.toBe(sidecarHistoryPath("b"));
    expect(sidecarHistoryPath(GUID)).not.toBe(sidecarCheckpointPath(GUID));
  });
});

describe("WP24 AC1 — isSidecarPath is a directory test, not an extension test", () => {
  it("accepts every file the store itself writes", () => {
    expect(isSidecarPath(sidecarHistoryPath(GUID))).toBe(true);
    expect(isSidecarPath(sidecarCheckpointPath(GUID))).toBe(true);
    expect(isSidecarPath(sidecarIndexPath())).toBe(true);
  });

  it("accepts an unknown extension and a nested file under the directory", () => {
    // WP26's AC1 is "no file under .obsidian/liveshare/state/", not "no file
    // with one of three extensions" — an extension-driven predicate passes the
    // three lines above and fails these two.
    expect(isSidecarPath(".obsidian/liveshare/state/scratch.tmp")).toBe(true);
    expect(isSidecarPath(".obsidian/liveshare/state/sub/deep.bin")).toBe(true);
  });

  it("rejects vault content, including canvases and near-miss neighbours", () => {
    expect(isSidecarPath("Notes/Board.canvas")).toBe(false);
    expect(isSidecarPath("Notes/Board.yhistory")).toBe(false);
    expect(isSidecarPath(".obsidian/liveshare/settings.json")).toBe(false);
    expect(isSidecarPath(".obsidian/workspace.json")).toBe(false);
  });

  it("rejects a sibling whose name merely starts with the directory name", () => {
    // A bare `path.startsWith(SIDECAR_DIR)` returns true for both of these.
    expect(isSidecarPath(".obsidian/liveshare/stateful/x.md")).toBe(false);
    expect(isSidecarPath(".obsidian/liveshare/state-backup/x.md")).toBe(false);
  });

  it("rejects the directory itself and the empty path", () => {
    expect(isSidecarPath(SIDECAR_DIR)).toBe(false);
    expect(isSidecarPath("")).toBe(false);
  });

  it("normalises separators and a leading ./ or / before deciding", () => {
    expect(isSidecarPath(`./${sidecarHistoryPath(GUID)}`)).toBe(true);
    expect(isSidecarPath(`/${sidecarHistoryPath(GUID)}`)).toBe(true);
    expect(isSidecarPath(`.obsidian\\liveshare\\state\\${GUID}.yhistory`)).toBe(true);
  });
});
