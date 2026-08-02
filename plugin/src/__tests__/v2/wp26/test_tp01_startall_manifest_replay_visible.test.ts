// WP26 / AC1 + AC2 — consumer 1 of 5: `BackgroundSync.startAll` (manifest replay,
// `background-sync.ts:72`).
//
// Why this point needs its own test even though four other entry points guard the
// same predicate: `startAll` is the REPLAY door. Every path a peer ever published
// walks through it on join, resume, reconnect and reload-from-host, so a sidecar
// entry that a legacy or hostile peer put in the manifest is materialised here
// even though this client never created it locally.
//
// The discriminating input is `sidecarIndexPath()` — `.../index.json`. That
// matters: `"json"` IS in `TEXT_EXTENSIONS` while `"yhistory"` and `"ycheckpoint"`
// are not, so a `.yhistory` entry is already stopped one line earlier by
// `!isTextFile(path)` and a test built only on `.yhistory` would be GREEN against
// a completely unimplemented WP26. `index.json` is the row that actually bites.
//
// AC2 is a NEGATIVE claim ("no sync activity, no doc creation"), so every
// assertion of absence here is paired with a POSITIVE CONTROL on the same
// harness, same call, same manifest: a markdown entry that MUST still get its
// doc. A harness that simply never wired sync up would fail the control.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { BackgroundSync } from "../../../files/background-sync";
import {
  SIDECAR_DIR,
  sidecarHistoryPath,
  sidecarIndexPath,
} from "../../../files/canvas-sidecar";

const SIDECAR_INDEX = sidecarIndexPath();
const SIDECAR_HISTORY = sidecarHistoryPath("wp26-tp01");
// A text-extension file at an arbitrary depth under the sidecar directory: the
// exclusion is a DIRECTORY claim, not an extension whitelist.
const SIDECAR_NESTED_TEXT = `${SIDECAR_DIR}/legacy/scratch.md`;

function createVault() {
  return {
    getAbstractFileByPath: vi.fn(() => null),
    read: vi.fn(async () => ""),
    modify: vi.fn(async () => {}),
    create: vi.fn(async () => ({})),
    getFiles: vi.fn(() => []),
    createFolder: vi.fn(async () => ({})),
    adapter: {
      write: vi.fn(async () => {}),
      writeBinary: vi.fn(async () => {}),
    },
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

function createManifestManager(entries: Map<string, any>) {
  return {
    getEntries: vi.fn(() => entries),
    isSharedPath: vi.fn(() => true),
    updateFile: vi.fn(async () => {}),
  } as any;
}

function createFileOpsManager() {
  return {
    mutePathEvents: vi.fn(),
    unmutePathEvents: vi.fn(),
    isPathMuted: vi.fn(() => false),
  } as any;
}

describe("WP26 AC1/AC2 — startAll (manifest replay) never subscribes a sidecar path", () => {
  let vault: ReturnType<typeof createVault>;
  let syncManager: ReturnType<typeof createSyncManager>;
  let fileOpsManager: ReturnType<typeof createFileOpsManager>;
  let bg: BackgroundSync;

  beforeEach(() => {
    vi.useFakeTimers();
    vault = createVault();
    syncManager = createSyncManager();
    fileOpsManager = createFileOpsManager();
  });

  afterEach(() => {
    bg?.destroy();
    vi.useRealTimers();
  });

  function start(entries: Map<string, any>) {
    const manifestManager = createManifestManager(entries);
    bg = new BackgroundSync(vault, syncManager, manifestManager, fileOpsManager);
    return bg.startAll("host");
  }

  it("creates no Y.Text doc for a sidecar entry replayed from the manifest", async () => {
    const entries = new Map<string, any>([
      [SIDECAR_INDEX, { hash: "s1", size: 12, mtime: 1 }],
      [SIDECAR_NESTED_TEXT, { hash: "s2", size: 12, mtime: 1 }],
      // The positive control lives in the SAME manifest and the SAME call.
      ["notes/hello.md", { hash: "n1", size: 5, mtime: 1 }],
    ]);
    const getDoc = vi.spyOn(syncManager, "getDoc");

    await start(entries);

    // Absence observed at the seam that would have been called.
    const asked = getDoc.mock.calls.map((call: any[]) => call[0]);
    expect(asked).not.toContain(SIDECAR_INDEX);
    expect(asked).not.toContain(SIDECAR_NESTED_TEXT);
    expect(syncManager._docs.has(SIDECAR_INDEX)).toBe(false);
    expect(syncManager._docs.has(SIDECAR_NESTED_TEXT)).toBe(false);

    // POSITIVE CONTROL — the harness really is wired up.
    expect(asked).toContain("notes/hello.md");
    expect(syncManager._docs.has("notes/hello.md")).toBe(true);
  });

  it("installs no observer and performs no disk write for a sidecar entry", async () => {
    const entries = new Map<string, any>([
      [SIDECAR_INDEX, { hash: "s1", size: 12, mtime: 1 }],
      [SIDECAR_HISTORY, { hash: "s2", size: 12, mtime: 1 }],
      ["notes/hello.md", { hash: "n1", size: 5, mtime: 1 }],
    ]);

    await start(entries);
    await vi.advanceTimersByTimeAsync(0);

    const observers: Map<string, unknown> = (bg as any).observers;
    expect(observers.has(SIDECAR_INDEX)).toBe(false);
    expect(observers.has(SIDECAR_HISTORY)).toBe(false);
    // POSITIVE CONTROL — an observer IS installed for the ordinary entry.
    expect(observers.has("notes/hello.md")).toBe(true);

    for (const call of vault.adapter.write.mock.calls) {
      expect(String(call[0]).startsWith(SIDECAR_DIR)).toBe(false);
    }
  });

  it("does not weaken the replay guard for near-miss siblings of the sidecar directory", async () => {
    // `.../stateful/...` shares a prefix with the sidecar directory but is not
    // inside it; a `startsWith(SIDECAR_DIR)` implementation would swallow it.
    const sibling = `${SIDECAR_DIR}ful/notes.md`;
    const entries = new Map<string, any>([
      [sibling, { hash: "x", size: 5, mtime: 1 }],
      [SIDECAR_INDEX, { hash: "s", size: 5, mtime: 1 }],
    ]);

    await start(entries);

    expect(syncManager._docs.has(sibling)).toBe(true);
    expect(syncManager._docs.has(SIDECAR_INDEX)).toBe(false);
  });
});
