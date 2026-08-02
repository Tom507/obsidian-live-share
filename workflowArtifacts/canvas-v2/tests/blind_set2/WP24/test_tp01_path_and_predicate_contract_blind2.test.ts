// WP24 / AC1 — blind counterpart 2 to the path/predicate contract.
//
// Different angle again: this one treats the helpers as FUNCTIONS and asserts
// their algebra — injectivity over a generated guid set, and the fact that
// every path a helper can produce is accepted by the predicate (a property, not
// a table). The predicate half attacks case sensitivity and depth, which
// neither the visible test nor blind1 covers: Obsidian vault paths are
// case-sensitive, and `.Obsidian/liveshare/state/x` is a DIFFERENT folder that
// the sync layer must not silently exclude.

import { describe, expect, it } from "vitest";

import {
  SIDECAR_DIR,
  SIDECAR_INDEX_FILENAME,
  isSidecarPath,
  sidecarCheckpointPath,
  sidecarHistoryPath,
  sidecarIndexPath,
} from "../../../../../plugin/src/files/canvas-sidecar";

/** 64 guids that differ only in ways a sloppy path builder would collapse. */
function guidCorpus(): string[] {
  const out: string[] = [];
  for (let i = 0; i < 32; i++) out.push(`g${i}`);
  out.push("g1.", "g1-", "g1_", "G1", "g 1", "g/1".replace("/", "-"), "0", "00");
  return out;
}

describe("WP24 AC1 blind2 — the helpers behave like functions, not like templates", () => {
  it("distinct guids never map to the same history path (injective)", () => {
    const guids = guidCorpus();
    const paths = new Set(guids.map(sidecarHistoryPath));
    expect(paths.size).toBe(new Set(guids).size);
  });

  it("history and checkpoint namespaces never overlap for any guid pair", () => {
    const histories = new Set(guidCorpus().map(sidecarHistoryPath));
    for (const guid of guidCorpus()) {
      expect(histories.has(sidecarCheckpointPath(guid))).toBe(false);
    }
  });

  it("the helpers are pure — same input, same output, no hidden counter", () => {
    for (const guid of guidCorpus().slice(0, 8)) {
      expect(sidecarHistoryPath(guid)).toBe(sidecarHistoryPath(guid));
      expect(sidecarCheckpointPath(guid)).toBe(sidecarCheckpointPath(guid));
    }
    expect(sidecarIndexPath()).toBe(`${SIDECAR_DIR}/${SIDECAR_INDEX_FILENAME}`);
  });

  it("PROPERTY: everything a helper produces is inside the sidecar directory", () => {
    for (const guid of guidCorpus()) {
      expect(isSidecarPath(sidecarHistoryPath(guid)), guid).toBe(true);
      expect(isSidecarPath(sidecarCheckpointPath(guid)), guid).toBe(true);
    }
    expect(isSidecarPath(sidecarIndexPath())).toBe(true);
  });
});

describe("WP24 AC1 blind2 — the predicate is case-sensitive and depth-aware", () => {
  it("a differently-cased directory is a different directory", () => {
    expect(isSidecarPath(".Obsidian/liveshare/state/x.yhistory")).toBe(false);
    expect(isSidecarPath(".obsidian/LiveShare/state/x.yhistory")).toBe(false);
    expect(isSidecarPath(".obsidian/liveshare/State/x.yhistory")).toBe(false);
  });

  it("the directory must be the path's prefix, not merely somewhere inside it", () => {
    expect(isSidecarPath("notes/.obsidian/liveshare/state/x.yhistory")).toBe(false);
    expect(isSidecarPath("x/.obsidian/liveshare/state/index.json")).toBe(false);
  });

  it("nesting below the directory is still inside it", () => {
    let path = SIDECAR_DIR;
    for (let depth = 1; depth <= 5; depth++) {
      path = `${path}/level${depth}`;
      expect(isSidecarPath(path), path).toBe(true);
    }
  });

  it("the directory itself, its parent and its grandparent are all outside", () => {
    expect(isSidecarPath(SIDECAR_DIR)).toBe(false);
    expect(isSidecarPath(`${SIDECAR_DIR}/`)).toBe(false);
    expect(isSidecarPath(".obsidian/liveshare")).toBe(false);
    expect(isSidecarPath(".obsidian")).toBe(false);
  });
});
