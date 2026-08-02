// WP26 / AC1 — the reachability claim about the ONE deliberate non-consumer.
//
// `BackgroundSync.subscribe()` is documented on the `skipsAutoTextSync` contract
// comment as the single place that does NOT consult the predicate: it is the
// explicit door of the announced R10 text fallback, entered only by
// `subscribeCanvasWithHandover` after a CanvasSync subscribe genuinely failed.
// Closing it for `.canvas` is WP33's job and is out of WP26's scope (charter §2).
//
// That leaves a question WP26 does have to answer: is `subscribe` reachable with
// a SIDECAR path? It is reachable from `startAll` and `onFileAdded`, so the
// answer depends entirely on those guards holding. This test pins the reachability
// property directly — no guarded entry point ever hands `subscribe` a sidecar
// path — rather than pinning `subscribe`'s own body, which WP26 must not change
// and which a later WP (or a defensive coder) may legitimately harden.
//
// Deliberately NOT asserted: what `subscribe` does when called directly with a
// sidecar path. Pinning that either way would either forbid defence-in-depth or
// mandate a change the charter puts out of scope.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { BackgroundSync } from "../../../files/background-sync";
import { SIDECAR_DIR, isSidecarPath, sidecarIndexPath } from "../../../files/canvas-sidecar";

const SIDECAR_INDEX = sidecarIndexPath();
const SIDECAR_NESTED = `${SIDECAR_DIR}/archive/notes.md`;

function createHarness(entries: Map<string, any> = new Map()) {
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
      const entry = docs.get(path);
      if (entry) {
        entry.doc.destroy();
        docs.delete(path);
      }
    },
    waitForSync: vi.fn(async () => {}),
    _docs: docs,
  } as any;
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
  const bg = new BackgroundSync(vault, syncManager, manifestManager, fileOpsManager);
  return { bg, vault, syncManager };
}

describe("WP26 AC1 — no guarded entry point routes a sidecar path into subscribe()", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("startAll, onFileAdded and onFileRenamed never call subscribe with a sidecar path", async () => {
    const entries = new Map<string, any>([
      [SIDECAR_INDEX, { hash: "s", size: 10, mtime: 1 }],
      ["notes/replay.md", { hash: "r", size: 10, mtime: 1 }],
    ]);
    const { bg } = createHarness(entries);
    const seen: string[] = [];
    const subscribe = vi
      .spyOn(bg, "subscribe")
      .mockImplementation(async (path: string) => {
        seen.push(path);
      });

    await bg.startAll("host");
    await bg.onFileAdded(SIDECAR_NESTED);
    await bg.onFileAdded("notes/created.md");
    await bg.onFileRenamed("notes/old.md", SIDECAR_INDEX);

    expect(seen.filter((path) => isSidecarPath(path))).toEqual([]);
    // POSITIVE CONTROL — the same spy DID see the ordinary paths, so the absence
    // above is an observed absence and not an unwired harness.
    expect(seen).toContain("notes/replay.md");
    expect(seen).toContain("notes/created.md");
    expect(subscribe).toHaveBeenCalled();

    bg.destroy();
  });

  it("no sidecar doc exists after driving every guarded entry point", async () => {
    const entries = new Map<string, any>([
      [SIDECAR_INDEX, { hash: "s", size: 10, mtime: 1 }],
      [SIDECAR_NESTED, { hash: "n", size: 10, mtime: 1 }],
      ["notes/replay.md", { hash: "r", size: 10, mtime: 1 }],
    ]);
    const { bg, syncManager } = createHarness(entries);

    await bg.startAll("host");
    await bg.onFileAdded(SIDECAR_INDEX);
    await bg.onFileRenamed("notes/replay.md", SIDECAR_NESTED);
    await bg.handleLocalTextModify(SIDECAR_INDEX);
    await vi.advanceTimersByTimeAsync(600);

    const leaked = [...syncManager._docs.keys()].filter((path) => isSidecarPath(path));
    expect(leaked).toEqual([]);

    bg.destroy();
  });

  it("WP33 boundary — subscribe() called directly is still the open R10 door for a .canvas", async () => {
    // Out of WP26's scope by charter §2. Pinned so that a WP26 implementation
    // cannot close it as a side effect and cannot claim it was already closed.
    const { bg, syncManager } = createHarness();

    await bg.subscribe("board.canvas");

    expect(syncManager._docs.has("board.canvas")).toBe(true);

    bg.destroy();
  });
});
