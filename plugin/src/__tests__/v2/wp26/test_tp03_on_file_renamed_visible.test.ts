// WP26 / AC1 + AC2 — consumer 3 of 5: `BackgroundSync.onFileRenamed`
// (`background-sync.ts:248`, tested on `normNew`).
//
// A rename has TWO directions and they fail differently:
//
//   INTO  a sidecar path — the new path must get no doc, AND the old path's
//         teardown (timers, remoteSeq, observer, releaseDoc) must still have run,
//         because the guard is deliberately placed AFTER teardown. A guard put at
//         the top of the method passes the "no doc" half and leaks the old one.
//   OUT   of a sidecar path to a normal one — the new path MUST be subscribed.
//         This is the direction an over-broad implementation
//         (`isSidecarPath(normOld) || isSidecarPath(normNew)`) gets wrong, and it
//         is invisible to anyone who only tests the INTO direction.
//
// `onFileRenamed` does not route through `subscribe()` — it acquires its own doc —
// so it needs its own guard and therefore its own test point.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { BackgroundSync } from "../../../files/background-sync";
import { SIDECAR_DIR, sidecarIndexPath } from "../../../files/canvas-sidecar";

const SIDECAR_INDEX = sidecarIndexPath();
const SIDECAR_OTHER = `${SIDECAR_DIR}/archive/old-index.json`;

function createHarness() {
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
    getEntries: vi.fn(() => new Map()),
    isSharedPath: vi.fn(() => true),
    updateFile: vi.fn(async () => {}),
  } as any;
  const fileOpsManager = {
    mutePathEvents: vi.fn(),
    unmutePathEvents: vi.fn(),
    isPathMuted: vi.fn(() => false),
  } as any;
  const bg = new BackgroundSync(vault, syncManager, manifestManager, fileOpsManager);
  return { vault, syncManager, manifestManager, fileOpsManager, bg };
}

describe("WP26 AC1/AC2 — renaming INTO a sidecar path", () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    vi.useFakeTimers();
    harness = createHarness();
  });

  afterEach(() => {
    harness.bg.destroy();
    vi.useRealTimers();
  });

  it("creates no Y.Text doc for the new sidecar path", async () => {
    const { bg, syncManager } = harness;
    const getDoc = vi.spyOn(syncManager, "getDoc");

    await bg.onFileRenamed("notes/hello.md", SIDECAR_INDEX);

    expect(getDoc.mock.calls.map((call: any[]) => call[0])).not.toContain(SIDECAR_INDEX);
    expect(syncManager._docs.has(SIDECAR_INDEX)).toBe(false);

    // POSITIVE CONTROL — the same method, same instance, a non-sidecar target.
    await bg.onFileRenamed("notes/other.md", "notes/renamed.md");
    expect(syncManager._docs.has("notes/renamed.md")).toBe(true);
  });

  it("still tears the OLD path down — the guard sits after teardown, not before it", async () => {
    const { bg, syncManager } = harness;
    await bg.subscribe("notes/hello.md");
    expect(syncManager._docs.has("notes/hello.md")).toBe(true);
    expect((bg as any).observers.has("notes/hello.md")).toBe(true);
    const releaseDoc = vi.spyOn(syncManager, "releaseDoc");

    await bg.onFileRenamed("notes/hello.md", SIDECAR_INDEX);

    expect(releaseDoc).toHaveBeenCalledWith("notes/hello.md");
    expect(syncManager._docs.has("notes/hello.md")).toBe(false);
    expect((bg as any).observers.has("notes/hello.md")).toBe(false);
    expect(syncManager._docs.has(SIDECAR_INDEX)).toBe(false);
  });

  it("installs no observer and writes nothing to disk for a rename into the sidecar directory", async () => {
    const { bg, vault } = harness;

    await bg.onFileRenamed("notes/hello.md", SIDECAR_INDEX);
    await vi.advanceTimersByTimeAsync(600);

    expect((bg as any).observers.has(SIDECAR_INDEX)).toBe(false);
    expect((bg as any).subscribing.has(SIDECAR_INDEX)).toBe(false);
    for (const call of vault.adapter.write.mock.calls) {
      expect(String(call[0]).startsWith(SIDECAR_DIR)).toBe(false);
    }
    expect(vault.create).not.toHaveBeenCalled();
  });

  it("a sidecar-to-sidecar rename touches neither path", async () => {
    const { bg, syncManager } = harness;

    await bg.onFileRenamed(SIDECAR_INDEX, SIDECAR_OTHER);

    expect(syncManager._docs.has(SIDECAR_INDEX)).toBe(false);
    expect(syncManager._docs.has(SIDECAR_OTHER)).toBe(false);
  });
});

describe("WP26 AC1/AC4 — renaming OUT of a sidecar path is not over-guarded", () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    vi.useFakeTimers();
    harness = createHarness();
  });

  afterEach(() => {
    harness.bg.destroy();
    vi.useRealTimers();
  });

  it("moving a sidecar file out to an ordinary vault path DOES install text sync", async () => {
    // The file is no longer local replica state; it is an ordinary note now.
    // An implementation that guards on `normOld` as well as `normNew` silently
    // stops syncing it, and no INTO-direction test can see that.
    const { bg, syncManager } = harness;

    await bg.onFileRenamed(SIDECAR_INDEX, "notes/recovered.json");

    expect(syncManager._docs.has("notes/recovered.json")).toBe(true);
    expect((bg as any).observers.has("notes/recovered.json")).toBe(true);
  });

  it("moving a near-miss sibling around behaves exactly as an ordinary rename", async () => {
    const { bg, syncManager } = harness;
    const sibling = `${SIDECAR_DIR}ful/notes.md`;

    await bg.onFileRenamed("notes/hello.md", sibling);

    expect(syncManager._docs.has(sibling)).toBe(true);
  });
});
