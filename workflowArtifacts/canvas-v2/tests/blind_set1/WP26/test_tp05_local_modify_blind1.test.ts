// WP26 / AC2 blind 1 — the MODIFY verb, attacked through a repeated edit stream
// rather than a single call.
//
// Different angle: `handleLocalTextModify` is idempotent-looking — it returns
// early when the disk content already equals the Y.Text — so a single call
// against an empty fixture can appear harmless for the wrong reason. Here the
// replica file is edited FIVE times with genuinely different content, exactly as
// the sidecar store would while it appends frames, and the oracle is cumulative:
// after the whole stream the sync manager must never have been asked for a
// document, no Y.Text anywhere may contain any of the five payloads, and the
// manifest must not have been told about any of it.
//
// This method is also the widest of the doors: unlike the other three
// `BackgroundSync` entry points it has NO `isTextFile` pre-filter, so extensions
// that the others reject for an older reason (`.yhistory`, `.ycheckpoint`) reach
// `getDoc` here unimpeded. Those extensions are therefore the payload rows.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import * as Y from "yjs";

import { BackgroundSync } from "../../../../../plugin/src/files/background-sync";
import {
  isSidecarPath,
  sidecarCheckpointPath,
  sidecarHistoryPath,
  sidecarIndexPath,
} from "../../../../../plugin/src/files/canvas-sidecar";

const STREAM = [
  [sidecarHistoryPath("m1"), "FRAME-0001"],
  [sidecarIndexPath(), '{"m1":"boards/one.canvas"}'],
  [sidecarHistoryPath("m1"), "FRAME-0001FRAME-0002"],
  [sidecarCheckpointPath("m1"), "CHECKPOINT-A"],
  [sidecarHistoryPath("m1"), ""],
] as const;

function fileFor(path: string) {
  const file = Object.create(TFile.prototype);
  file.path = path;
  file.stat = { size: 1, mtime: 1, ctime: 1 };
  return file;
}

function build() {
  const disk = new Map<string, string>();
  const docs = new Map<string, { doc: Y.Doc; text: Y.Text; awareness: any }>();
  const asked: string[] = [];
  const vault = {
    getAbstractFileByPath: vi.fn((path: string) => (disk.has(path) ? fileFor(path) : null)),
    read: vi.fn(async (file: any) => disk.get(file.path) ?? ""),
    modify: vi.fn(async () => {}),
    create: vi.fn(async () => ({})),
    getFiles: vi.fn(() => []),
    createFolder: vi.fn(async () => ({})),
    adapter: { write: vi.fn(async () => {}), writeBinary: vi.fn(async () => {}) },
  } as any;
  const syncManager = {
    getDoc(path: string) {
      asked.push(path);
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
    releaseDoc: vi.fn(),
    waitForSync: vi.fn(async () => {}),
    _docs: docs,
  } as any;
  const manifestManager = {
    getEntries: vi.fn(() => new Map()),
    isSharedPath: vi.fn(() => true),
    updateFile: vi.fn(async () => {}),
  } as any;
  const fileOpsManager = {
    mutePathEvents: vi.fn(),
    unmutePathEvents: vi.fn(),
    isPathMuted: vi.fn(() => false),
  } as any;
  return {
    disk,
    docs,
    asked,
    manifestManager,
    bg: new BackgroundSync(vault, syncManager, manifestManager, fileOpsManager),
  };
}

describe("WP26 blind1 — a stream of replica-file edits produces no shared state", () => {
  let ctx: ReturnType<typeof build>;

  beforeEach(async () => {
    vi.useFakeTimers();
    ctx = build();
    for (const [path, content] of STREAM) {
      ctx.disk.set(path, content);
      await ctx.bg.handleLocalTextModify(path);
    }
    await vi.advanceTimersByTimeAsync(3000);
  });

  afterEach(() => {
    ctx.bg.destroy();
    vi.useRealTimers();
  });

  it("the sync manager was never asked for a replica document", () => {
    expect(ctx.asked.filter((path) => isSidecarPath(path))).toEqual([]);
  });

  it("no document exists for any replica path", () => {
    expect([...ctx.docs.keys()].filter((path) => isSidecarPath(path))).toEqual([]);
  });

  it("none of the five payloads reached any Y.Text", () => {
    const everything = [...ctx.docs.values()].map((handle) => handle.text.toString()).join("\n");
    for (const [, content] of STREAM) {
      if (content.length === 0) continue;
      expect(everything).not.toContain(content);
    }
  });

  it("the manifest was never told about a replica file", () => {
    expect(ctx.manifestManager.updateFile).not.toHaveBeenCalled();
  });
});

describe("WP26 blind1 — POSITIVE CONTROL on the identical harness", () => {
  it("the same five-edit stream against an ordinary note DOES reach shared state", async () => {
    vi.useFakeTimers();
    const ctx = build();
    const path = "team/log.md";

    for (let i = 1; i <= 5; i++) {
      ctx.disk.set(path, `revision ${i}`);
      await ctx.bg.handleLocalTextModify(path);
    }
    await vi.advanceTimersByTimeAsync(0);

    expect(ctx.docs.get(path)?.text.toString()).toBe("revision 5");
    expect(ctx.manifestManager.updateFile).toHaveBeenCalledTimes(5);

    ctx.bg.destroy();
    vi.useRealTimers();
  });
});
