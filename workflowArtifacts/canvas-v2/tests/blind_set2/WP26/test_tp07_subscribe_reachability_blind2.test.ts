// WP26 / AC1 blind 2 — reachability of the deliberate NON-consumer, attacked from
// the WP33 boundary rather than from the replica side.
//
// Different angle: blind 1 asks whether a replica path can reach `subscribe`. This
// one asks the complementary question — whether WP26 left the R10 text-fallback
// door exactly as wide as it found it. That door is `subscribe`'s lack of a
// `skipsAutoTextSync` check, it is documented on the predicate's own contract
// comment as the ONE deliberate omission, and closing it for `.canvas` is WP33's
// charter (WP26 charter §2 puts it out of scope explicitly).
//
// The failure this catches is a plausible and tempting one: a coder who reads
// "the exclusion is asserted at each of the exclusion consumers" as "add the check
// everywhere" bolts `skipsAutoTextSync` onto `subscribe` too, which retires the
// announced fallback and silently changes `.canvas` behaviour — an AC4 violation
// dressed up as thoroughness.
//
// So: `.canvas` through `subscribe` must still work, in both roles, and the
// guarded entry points must still refuse it. Two facts that only look
// contradictory if the distinction between the door and the entry points is lost.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import * as Y from "yjs";

import { BackgroundSync } from "../../../../../plugin/src/files/background-sync";
import { SIDECAR_DIR, isSidecarPath } from "../../../../../plugin/src/files/canvas-sidecar";

const CANVAS = "boards/fallback.canvas";
const CANVAS_BYTES = '{"nodes":[{"id":"n1"}],"edges":[]}';

function fileFor(path: string) {
  const file = Object.create(TFile.prototype);
  file.path = path;
  file.stat = { size: 1, mtime: 1, ctime: 1 };
  return file;
}

function build(role: "host" | "guest", disk: Map<string, string>) {
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
    releaseDoc: vi.fn(),
    waitForSync: vi.fn(async () => {}),
    _docs: docs,
  } as any;
  const manifestManager = {
    getEntries: vi.fn(() => new Map([[CANVAS, { hash: "c", size: 1, mtime: 1 }]])),
    isSharedPath: vi.fn(() => true),
    updateFile: vi.fn(async () => {}),
  } as any;
  const fileOpsManager = {
    mutePathEvents: vi.fn(),
    unmutePathEvents: vi.fn(),
    isPathMuted: vi.fn(() => false),
  } as any;
  const bg = new BackgroundSync(vault, syncManager, manifestManager, fileOpsManager);
  (bg as any).role = role;
  return { docs, bg };
}

describe("WP26 blind2 — the R10 text-fallback door is exactly as wide as before", () => {
  let disk: Map<string, string>;

  beforeEach(() => {
    vi.useFakeTimers();
    disk = new Map<string, string>([[CANVAS, CANVAS_BYTES]]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a host subscribe of a .canvas still seeds the Y.Text from disk", async () => {
    const ctx = build("host", disk);

    await ctx.bg.subscribe(CANVAS);

    expect(ctx.docs.get(CANVAS)?.text.toString()).toBe(CANVAS_BYTES);
    ctx.bg.destroy();
  });

  it("a guest subscribe of a .canvas still installs its observer", async () => {
    const ctx = build("guest", new Map());
    const pending = ctx.bg.subscribe(CANVAS);
    ctx.docs.get(CANVAS)?.text.insert(0, CANVAS_BYTES);
    await vi.advanceTimersByTimeAsync(3000);
    await pending;

    expect((ctx.bg as any).observers.has(CANVAS)).toBe(true);
    ctx.bg.destroy();
  });

  it("the guarded entry points still refuse the same .canvas in the same run", async () => {
    const ctx = build("host", disk);

    await ctx.bg.startAll("host");
    await ctx.bg.onFileAdded(CANVAS);
    await ctx.bg.onFileRenamed("boards/old.md", CANVAS);

    expect(ctx.docs.has(CANVAS)).toBe(false);
    ctx.bg.destroy();
  });
});

describe("WP26 blind2 — nothing in the replica directory reaches the fallback door", () => {
  it("driving every guarded entry point leaves no replica observer behind", async () => {
    vi.useFakeTimers();
    const ctx = build("host", new Map());
    // Two shapes: one the `.canvas` clause would already stop, and one — a plain
    // `.json` under the replica directory — that only the sidecar clause stops.
    for (const replica of [`${SIDECAR_DIR}/board.canvas`, `${SIDECAR_DIR}/board.json`]) {
      await ctx.bg.onFileAdded(replica);
      await ctx.bg.onFileRenamed("boards/old.md", replica);
      await ctx.bg.handleLocalTextModify(replica);
    }
    await vi.advanceTimersByTimeAsync(600);

    const observers: Map<string, unknown> = (ctx.bg as any).observers;
    expect([...observers.keys()].filter((path) => isSidecarPath(path))).toEqual([]);
    expect([...ctx.docs.keys()].filter((path) => isSidecarPath(path))).toEqual([]);

    ctx.bg.destroy();
    vi.useRealTimers();
  });
});
