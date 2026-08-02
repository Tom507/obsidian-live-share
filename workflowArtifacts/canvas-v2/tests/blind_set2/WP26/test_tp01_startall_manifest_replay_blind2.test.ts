// WP26 / AC1 + AC2 blind 2 — manifest replay, attacked through the ROLE and the
// SEED direction instead of through the doc registry.
//
// Different angle: `startAll` behaves differently per role. As host it SEEDS the
// Y.Text from the file on disk; as guest it waits for a host seed and then WRITES
// the remote content to disk. Both are "sync activity" under AC2 and both are
// invisible to a test that only counts documents. This one gives the vault real
// content for the sidecar files and then asserts that neither direction moved a
// single byte: nothing of the sidecar's contents was lifted into a CRDT, and
// nothing from a CRDT landed on a sidecar path.
//
// The guest branch also matters because it is the one that can CREATE a sidecar
// file that does not exist locally, from a peer's manifest entry.
//
// The positive control is a markdown file whose bytes must make the round trip in
// the same run, so an inert harness is distinguishable from a working exclusion.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import * as Y from "yjs";

import { BackgroundSync } from "../../../../../plugin/src/files/background-sync";
import {
  SIDECAR_DIR,
  isSidecarPath,
  sidecarIndexPath,
} from "../../../../../plugin/src/files/canvas-sidecar";

const REPLICA_INDEX = sidecarIndexPath();
const REPLICA_NOTE = `${SIDECAR_DIR}/salvage/notes.md`;
const SHARED_NOTE = "team/agenda.md";

function fileFor(path: string) {
  const file = Object.create(TFile.prototype);
  file.path = path;
  file.stat = { size: 1, mtime: 1, ctime: 1 };
  return file;
}

function buildHarness(disk: Map<string, string>) {
  const docs = new Map<string, { doc: Y.Doc; text: Y.Text; awareness: any }>();
  const vault = {
    getAbstractFileByPath: vi.fn((path: string) => (disk.has(path) ? fileFor(path) : null)),
    read: vi.fn(async (file: any) => disk.get(file.path) ?? ""),
    modify: vi.fn(async () => {}),
    create: vi.fn(async () => ({})),
    getFiles: vi.fn(() => []),
    createFolder: vi.fn(async () => ({})),
    adapter: {
      write: vi.fn(async (path: string, content: string) => {
        disk.set(path, content);
      }),
      writeBinary: vi.fn(async () => {}),
    },
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
  const entries = new Map<string, any>([
    [REPLICA_INDEX, { hash: "a", size: 1, mtime: 1 }],
    [REPLICA_NOTE, { hash: "b", size: 1, mtime: 1 }],
    [SHARED_NOTE, { hash: "c", size: 1, mtime: 1 }],
  ]);
  const manifestManager = {
    getEntries: vi.fn(() => entries),
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

describe("WP26 blind2 — the host seed never lifts replica state into a CRDT", () => {
  let disk: Map<string, string>;
  let harness: ReturnType<typeof buildHarness>;

  beforeEach(() => {
    vi.useFakeTimers();
    disk = new Map<string, string>([
      [REPLICA_INDEX, '{"guid-1":"boards/plan.canvas"}'],
      [REPLICA_NOTE, "private replica scratch"],
      [SHARED_NOTE, "# Agenda"],
    ]);
    harness = buildHarness(disk);
  });

  afterEach(() => {
    harness.bg.destroy();
    vi.useRealTimers();
  });

  it("no sidecar byte appears in any Y.Text after a host replay", async () => {
    await harness.bg.startAll("host");
    await vi.advanceTimersByTimeAsync(0);

    for (const [path, handle] of harness.docs) {
      expect(isSidecarPath(path), `a doc exists for ${path}`).toBe(false);
      expect(handle.text.toString()).not.toContain("private replica scratch");
      expect(handle.text.toString()).not.toContain("guid-1");
    }
    // POSITIVE CONTROL — the ordinary note WAS seeded from disk in the same run.
    expect(harness.docs.get(SHARED_NOTE)?.text.toString()).toBe("# Agenda");
  });

  it("the sidecar files on disk are byte-identical after a host replay", async () => {
    await harness.bg.startAll("host");
    await vi.advanceTimersByTimeAsync(3000);

    expect(disk.get(REPLICA_INDEX)).toBe('{"guid-1":"boards/plan.canvas"}');
    expect(disk.get(REPLICA_NOTE)).toBe("private replica scratch");
  });
});

describe("WP26 blind2 — the guest replay never materialises replica state from a peer", () => {
  let disk: Map<string, string>;
  let harness: ReturnType<typeof buildHarness>;

  beforeEach(() => {
    vi.useFakeTimers();
    // The guest has NOTHING locally; everything would have to come from the peer.
    disk = new Map<string, string>();
    harness = buildHarness(disk);
  });

  afterEach(() => {
    harness.bg.destroy();
    vi.useRealTimers();
  });

  it("a peer that publishes sidecar entries cannot make this client create them", async () => {
    const start = harness.bg.startAll("guest");
    // Seed remote content for every replayed key, as a hostile peer would.
    for (const path of [REPLICA_INDEX, REPLICA_NOTE, SHARED_NOTE]) {
      harness.syncManager.getDoc(path).text.insert(0, `remote:${path}`);
    }
    await vi.advanceTimersByTimeAsync(3000);
    await start;
    await vi.advanceTimersByTimeAsync(3000);

    for (const path of disk.keys()) {
      expect(isSidecarPath(path), `disk gained ${path}`).toBe(false);
    }
    expect(disk.has(REPLICA_INDEX)).toBe(false);
    expect(disk.has(REPLICA_NOTE)).toBe(false);
    // POSITIVE CONTROL — the ordinary entry WAS materialised from the peer.
    expect(disk.get(SHARED_NOTE)).toBe(`remote:${SHARED_NOTE}`);
  });
});
