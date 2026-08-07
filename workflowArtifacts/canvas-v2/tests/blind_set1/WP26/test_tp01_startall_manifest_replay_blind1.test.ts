// WP26 / AC1 + AC2 blind 1 — manifest replay, attacked as a SET PARTITION rather
// than as three individual "not called with" checks.
//
// Different angle: one manifest carrying nine entries is replayed once, and the
// oracle is the exact, sorted set of paths that acquired a document, compared
// whole. A per-path `not.toContain` can be satisfied by a harness that subscribed
// nothing at all; a whole-set `toEqual` cannot — the expected set is non-empty
// and names the survivors, so an implementation that over-excludes (a bare
// `startsWith`, or a guard on the whole `.obsidian` subtree) fails on the rows it
// wrongly dropped and an implementation that under-excludes fails on the rows it
// wrongly kept. One assertion, both directions.
//
// The corpus is also chosen so that the rows which are ALREADY excluded by the
// pre-existing `!isTextFile(path)` line (`.yhistory`, `.ycheckpoint`) sit beside
// the rows that are not (`index.json`, a `.md` under the sidecar directory). If
// only the former appeared, this test would be green against an untouched tree.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { BackgroundSync } from "../../../../../plugin/src/files/background-sync";
import {
  SIDECAR_DIR,
  sidecarCheckpointPath,
  sidecarHistoryPath,
  sidecarIndexPath,
} from "../../../../../plugin/src/files/canvas-sidecar";

const REPLAYED: Array<[string, Record<string, unknown>]> = [
  // survivors — ordinary vault content
  ["journal/2026-08-01.md", { hash: "a", size: 4, mtime: 1 }],
  ["specs/api.json", { hash: "b", size: 4, mtime: 1 }],
  [`${SIDECAR_DIR}ful/plan.md`, { hash: "c", size: 4, mtime: 1 }],
  [`${SIDECAR_DIR.slice(0, SIDECAR_DIR.lastIndexOf("/"))}/readme.md`, { hash: "d", size: 4, mtime: 1 }],
  // excluded — local replica state
  [sidecarIndexPath(), { hash: "e", size: 4, mtime: 1 }],
  [`${SIDECAR_DIR}/rescued/plan.md`, { hash: "f", size: 4, mtime: 1 }],
  [sidecarHistoryPath("q1"), { hash: "g", size: 4, mtime: 1 }],
  [sidecarCheckpointPath("q1"), { hash: "h", size: 4, mtime: 1 }],
  // excluded for an unrelated, pre-existing reason — kept honest
  ["media/cover.png", { hash: "i", size: 4, mtime: 1, binary: true }],
];

const EXPECTED_SUBSCRIBED = [
  "journal/2026-08-01.md",
  "specs/api.json",
  `${SIDECAR_DIR.slice(0, SIDECAR_DIR.lastIndexOf("/"))}/readme.md`,
  `${SIDECAR_DIR}ful/plan.md`,
].sort();

function buildHarness() {
  const docs = new Map<string, { doc: Y.Doc; text: Y.Text; awareness: any }>();
  const vault = {
    getAbstractFileByPath: vi.fn(() => null),
    read: vi.fn(async () => ""),
    modify: vi.fn(async () => {}),
    create: vi.fn(async () => ({})),
    getFiles: vi.fn(() => []),
    createFolder: vi.fn(async () => ({})),
    adapter: { write: vi.fn(async () => {}), writeBinary: vi.fn(async () => {}) },
  } as any;
  const syncManager = {
    getDoc(path: string) {
      if (!docs.has(path)) {
        const doc = new Y.Doc();
        docs.set(path, {
          doc,
          text: doc.getText("content"),
          awareness: { setLocalStateField: vi.fn(), setLocalState: vi.fn() },
        });
      }
      return docs.get(path)!;
    },
    releaseDoc(path: string) {
      docs.get(path)?.doc.destroy();
      docs.delete(path);
    },
    waitForSync: vi.fn(async () => {}),
    _docs: docs,
  } as any;
  const manifestManager = {
    getEntries: vi.fn(() => new Map(REPLAYED)),
    isSharedPath: vi.fn(() => true),
    updateFile: vi.fn(async () => {}),
  } as any;
  const fileOpsManager = {
    mutePathEvents: vi.fn(),
    unmutePathEvents: vi.fn(),
    isPathMuted: vi.fn(() => false),
  } as any;
  return {
    docs,
    vault,
    syncManager,
    bg: new BackgroundSync(vault, syncManager, manifestManager, fileOpsManager),
  };
}

describe("WP26 blind1 — manifest replay partitions the vault from the replica state", () => {
  let harness: ReturnType<typeof buildHarness>;

  beforeEach(() => {
    vi.useFakeTimers();
    harness = buildHarness();
  });

  afterEach(() => {
    harness.bg.destroy();
    vi.useRealTimers();
  });

  it("exactly the ordinary text entries acquire a document", async () => {
    await harness.bg.startAll("host");
    await vi.advanceTimersByTimeAsync(0);

    expect([...harness.docs.keys()].sort()).toEqual(EXPECTED_SUBSCRIBED);
  });

  it("exactly the same set carries an observer afterwards", async () => {
    await harness.bg.startAll("host");
    await vi.advanceTimersByTimeAsync(0);

    const observers: Map<string, unknown> = (harness.bg as any).observers;
    expect([...observers.keys()].sort()).toEqual(EXPECTED_SUBSCRIBED);
  });

  it("replaying the same manifest a second time adds nothing new", async () => {
    await harness.bg.startAll("host");
    await harness.bg.startAll("host");
    await vi.advanceTimersByTimeAsync(0);

    expect([...harness.docs.keys()].sort()).toEqual(EXPECTED_SUBSCRIBED);
  });

  it("the guest replay writes to disk only under paths it subscribed", async () => {
    // Every replayed key is given remote content FIRST, so a disk write really is
    // attempted for each of them and the absence asserted below is an observed
    // absence rather than an inert harness.
    for (const [path] of REPLAYED) {
      harness.syncManager.getDoc(path).text.insert(0, `remote for ${path}`);
    }
    // The guest branch parks on real 100 ms waits; advance the clock BEFORE
    // awaiting, or the await and the fake timers deadlock each other.
    const pending = harness.bg.startAll("guest");
    await vi.advanceTimersByTimeAsync(30000);
    await pending;
    await vi.advanceTimersByTimeAsync(3000);

    const written = [
      ...new Set(harness.vault.adapter.write.mock.calls.map((call: any[]) => String(call[0]))),
    ].sort();
    expect(written).toEqual(EXPECTED_SUBSCRIBED);
  });
});
