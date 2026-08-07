// WP27 / AC4 blind2 — the `setActiveFile` guard, attacked through the SIDE
// EFFECTS the unguarded body produces rather than through the call log.
//
// Different angle: blind1 compares the ordered `getDoc` log. This one never
// looks at `getDoc` at all. It watches the three things the unguarded body does
// downstream — it creates a document under the bare path, it schedules a disk
// write of that document's `Y.Text` over the user's canvas, and (as host) it
// republishes the file into the manifest. Any ONE of them surviving means the
// guard is in the wrong place, and none of them can be true of a guarded body.
//
// Watching effects instead of calls matters because a guard placed AFTER the
// `getDoc` would satisfy a call-log test written as "no canvas doc was returned"
// while still having created the document.

import { TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { BackgroundSync } from "../../../../../plugin/src/files/background-sync";

const CANVAS = "sprint/board.canvas";
const MARKDOWN = "sprint/notes.md";

function harness() {
  const disk = new Map<string, string>([
    [CANVAS, JSON.stringify({ nodes: [{ id: "keep" }], edges: [] })],
    [MARKDOWN, "# notes"],
  ]);
  const docs = new Map<string, { doc: Y.Doc; text: Y.Text; awareness: unknown }>();
  const vault = {
    disk,
    getAbstractFileByPath: vi.fn((p: string) => {
      if (!disk.has(p)) return null;
      const f = new TFile();
      f.path = p;
      return f;
    }),
    read: vi.fn(async (file: { path: string }) => disk.get(file.path) ?? ""),
    modify: vi.fn(async (file: { path: string }, content: string) => {
      disk.set(file.path, content);
    }),
    create: vi.fn(async (p: string, content: string) => {
      disk.set(p, content);
      return {};
    }),
    getFiles: vi.fn(() => []),
    createFolder: vi.fn(async () => ({})),
    adapter: {
      write: vi.fn(async (p: string, content: string) => {
        disk.set(p, content);
      }),
      writeBinary: vi.fn(async () => {}),
    },
  };
  const syncManager = {
    getDoc(id: string) {
      if (!docs.has(id)) {
        const doc = new Y.Doc();
        docs.set(id, { doc, text: doc.getText("content"), awareness: {} });
      }
      return docs.get(id);
    },
    releaseDoc: vi.fn(),
    waitForSync: vi.fn(async () => {}),
  };
  const manifestManager = {
    getEntries: vi.fn(() => new Map()),
    isSharedPath: vi.fn(() => true),
    updateFile: vi.fn(async () => {}),
  };
  const fileOpsManager = {
    mutePathEvents: vi.fn(),
    unmutePathEvents: vi.fn(),
    isPathMuted: vi.fn(() => false),
  };
  const bg = new BackgroundSync(
    vault as never,
    syncManager as never,
    manifestManager as never,
    fileOpsManager as never,
  );
  return { bg, vault, docs, manifestManager, disk };
}

describe("WP27 AC4 blind2 — the guard is observed through its absent side effects", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("EFFECT 1 — no document is created under the canvas path", async () => {
    const { bg, docs } = harness();

    bg.setActiveFile(CANVAS);
    bg.setActiveFile(MARKDOWN);
    await vi.advanceTimersByTimeAsync(1000);

    expect([...docs.keys()]).not.toContain(CANVAS);

    bg.destroy();
  });

  it("EFFECT 2 — the user's canvas file is not overwritten from an empty Y.Text", async () => {
    const { bg, disk } = harness();
    const before = disk.get(CANVAS) as string;

    bg.setActiveFile(CANVAS);
    bg.setActiveFile(MARKDOWN);
    await vi.advanceTimersByTimeAsync(1000);

    expect(disk.get(CANVAS)).toBe(before);
    expect(disk.get(CANVAS)).toContain("keep");

    bg.destroy();
  });

  it("EFFECT 3 — nothing about the canvas is republished into the manifest", async () => {
    const { bg, manifestManager } = harness();

    bg.setActiveFile(CANVAS);
    bg.setActiveFile(MARKDOWN);
    await vi.advanceTimersByTimeAsync(1000);

    const touched = manifestManager.updateFile.mock.calls.map(
      (call) => (call[0] as { path?: string } | undefined)?.path,
    );
    expect(touched).not.toContain(CANVAS);

    bg.destroy();
  });

  it("POSITIVE CONTROL — leaving a markdown file DOES produce all three effects", async () => {
    const { bg, docs, manifestManager } = harness();

    bg.setActiveFile(MARKDOWN);
    bg.setActiveFile(null);
    await vi.advanceTimersByTimeAsync(1000);

    expect([...docs.keys()]).toContain(MARKDOWN);
    const touched = manifestManager.updateFile.mock.calls.map(
      (call) => (call[0] as { path?: string } | undefined)?.path,
    );
    expect(touched).toContain(MARKDOWN);

    bg.destroy();
  });

  it("OVER-GUARD CONTROL — `subscribe()` is still the open R10 door", async () => {
    const { bg, docs } = harness();

    await bg.subscribe(CANVAS);
    await vi.advanceTimersByTimeAsync(1000);

    expect(docs.has(CANVAS)).toBe(true);

    bg.destroy();
  });
});
