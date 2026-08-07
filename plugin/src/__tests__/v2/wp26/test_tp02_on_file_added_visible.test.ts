// WP26 / AC1 + AC2 — consumer 2 of 5: `BackgroundSync.onFileAdded`
// (`background-sync.ts:195`), the CREATE door.
//
// This is the entry point AC2's word "creating" lands on. It is reached from
// three call sites (`vault-events.ts:152`, `main.ts:233/244/265`) and from
// `control-handlers.ts:65`, i.e. also from a REMOTE file operation — so a peer
// creating a sidecar file reaches it too. The guard is at the method, not the
// callers, which is why the assertion belongs here.
//
// Discriminating input: `index.json` under the sidecar directory. `.yhistory` /
// `.ycheckpoint` are already stopped by `!isTextFile(path)` one line earlier, so
// a test using only those extensions cannot fail against an unimplemented WP26.
// Both classes appear below, but only the text-extension rows carry the proof.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { BackgroundSync } from "../../../files/background-sync";
import {
  SIDECAR_DIR,
  sidecarCheckpointPath,
  sidecarIndexPath,
} from "../../../files/canvas-sidecar";

const SIDECAR_INDEX = sidecarIndexPath();
const SIDECAR_CHECKPOINT = sidecarCheckpointPath("wp26-tp02");
const SIDECAR_DEEP_TEXT = `${SIDECAR_DIR}/a/b/c.md`;

function createVault() {
  return {
    getAbstractFileByPath: vi.fn(() => null),
    read: vi.fn(async () => ""),
    modify: vi.fn(async () => {}),
    create: vi.fn(async () => ({})),
    getFiles: vi.fn(() => []),
    createFolder: vi.fn(async () => ({})),
    adapter: { write: vi.fn(async () => {}), writeBinary: vi.fn(async () => {}) },
  } as any;
}

function createSyncManager() {
  const docs = new Map<string, { doc: Y.Doc; text: Y.Text; awareness: any }>();
  return {
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
}

function createHarness() {
  const vault = createVault();
  const syncManager = createSyncManager();
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

describe("WP26 AC1/AC2 — creating a sidecar file installs no sync of any kind", () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    vi.useFakeTimers();
    harness = createHarness();
  });

  afterEach(() => {
    harness.bg.destroy();
    vi.useRealTimers();
  });

  it("onFileAdded creates no Y.Text doc for any file under the sidecar directory", async () => {
    const { bg, syncManager } = harness;
    const getDoc = vi.spyOn(syncManager, "getDoc");

    await bg.onFileAdded(SIDECAR_INDEX);
    await bg.onFileAdded(SIDECAR_DEEP_TEXT);
    await bg.onFileAdded(SIDECAR_CHECKPOINT);
    // POSITIVE CONTROL — same instance, same method, immediately afterwards.
    await bg.onFileAdded("notes/hello.md");

    const asked = getDoc.mock.calls.map((call: any[]) => call[0]);
    expect(asked).not.toContain(SIDECAR_INDEX);
    expect(asked).not.toContain(SIDECAR_DEEP_TEXT);
    expect(asked).not.toContain(SIDECAR_CHECKPOINT);
    expect(syncManager._docs.has(SIDECAR_INDEX)).toBe(false);
    expect(syncManager._docs.has(SIDECAR_DEEP_TEXT)).toBe(false);

    expect(asked).toContain("notes/hello.md");
    expect(syncManager._docs.has("notes/hello.md")).toBe(true);
  });

  it("the backslash spelling of a sidecar path is excluded too", async () => {
    // `onFileAdded` normalises separators before it decides; a guard written
    // against the raw argument would leak on Windows.
    const { bg, syncManager } = harness;
    const backslashed = SIDECAR_INDEX.replace(/\//g, "\\");

    await bg.onFileAdded(backslashed);
    await bg.onFileAdded("notes\\hello.md");

    expect(syncManager._docs.has(SIDECAR_INDEX)).toBe(false);
    expect(syncManager._docs.has(backslashed)).toBe(false);
    // POSITIVE CONTROL — a normal backslashed path IS subscribed, canonicalised.
    expect(syncManager._docs.has("notes/hello.md")).toBe(true);
  });

  it("installs no observer and schedules no disk write for a created sidecar file", async () => {
    const { bg, vault, syncManager } = harness;

    await bg.onFileAdded(SIDECAR_INDEX);
    await vi.advanceTimersByTimeAsync(600);

    expect((bg as any).observers.has(SIDECAR_INDEX)).toBe(false);
    expect((bg as any).subscribing.has(SIDECAR_INDEX)).toBe(false);
    expect(vault.adapter.write).not.toHaveBeenCalled();
    expect(vault.create).not.toHaveBeenCalled();

    // POSITIVE CONTROL — the same harness DOES install an observer for a note.
    await bg.onFileAdded("notes/hello.md");
    expect((bg as any).observers.has("notes/hello.md")).toBe(true);
    expect(syncManager._docs.has("notes/hello.md")).toBe(true);
  });

  it("the guard does not reach outside the sidecar directory", async () => {
    // One level ABOVE `state/` and a prefix-sharing sibling are ordinary vault
    // paths as far as this predicate is concerned.
    const { bg, syncManager } = harness;
    const above = `${SIDECAR_DIR.slice(0, SIDECAR_DIR.lastIndexOf("/"))}/notes.md`;
    const sibling = `${SIDECAR_DIR}ful/notes.md`;

    await bg.onFileAdded(above);
    await bg.onFileAdded(sibling);

    expect(syncManager._docs.has(above)).toBe(true);
    expect(syncManager._docs.has(sibling)).toBe(true);
  });
});
