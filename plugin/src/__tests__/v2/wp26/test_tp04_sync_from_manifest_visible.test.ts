// WP26 / AC1 + AC2 — consumer 4 of 5: `ManifestManager.syncFromManifest`
// (`manifest.ts:174`).
//
// This is the door a REMOTE manifest walks through — join, resume, reconnect and
// reload-from-host all land here — so it is the only consumer that can create a
// sidecar file on THIS disk because some other client published one. It has three
// separate branches and the existing `.canvas` guard covers only one of them:
//
//   directory entry  (`:143`) — runs BEFORE the guard; `ensureFolder` materialises
//                     the folder. A guard added only at `:174` never sees it.
//   binary entry     (`:195`) — the guard at `:174` is `!entry.binary && …`, so a
//                     sidecar published as binary walks straight past it into
//                     `requestBinary`. `.yhistory` / `.ycheckpoint` are NOT text
//                     extensions, so `publishManifest` marks exactly the sidecar's
//                     own files binary. This is the LIKELY leak, not a corner.
//   text entry       (`:174`) — `index.json` IS a text extension and reaches the
//                     `vault.create` at `:217` with an empty string.
//
// All three are asserted, each against a positive control in the same manifest.

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  SIDECAR_DIR,
  sidecarCheckpointPath,
  sidecarHistoryPath,
  sidecarIndexPath,
} from "../../../files/canvas-sidecar";
import { ManifestManager } from "../../../files/manifest";
import type { LiveShareSettings } from "../../../types";

const SIDECAR_INDEX = sidecarIndexPath();
const SIDECAR_HISTORY = sidecarHistoryPath("wp26-tp04");
const SIDECAR_CHECKPOINT = sidecarCheckpointPath("wp26-tp04");
const SIDECAR_SUBDIR = `${SIDECAR_DIR}/archive`;

function createSettings(overrides: Partial<LiveShareSettings> = {}): LiveShareSettings {
  return {
    serverUrl: "http://localhost:3000",
    roomId: "test-room",
    token: "test-token",
    jwt: "",
    githubUserId: "",
    avatarUrl: "",
    displayName: "Test User",
    cursorColor: "#ff0000",
    sharedFolder: "",
    allowWholeVaultReconcile: false,
    role: "host",
    encryptionPassphrase: "",
    encryptionSalt: "",
    permission: "read-write",
    requireApproval: false,
    serverPassword: "",
    clientId: "test-client-id",
    notificationsEnabled: true,
    debugLogging: false,
    debugLogPath: "live-share-debug.md",
    autoReconnect: true,
    excludePatterns: [],
    readOnlyPatterns: [],
    approvalTimeoutSeconds: 60,
    showCanvasCursors: true,
    showCanvasPresence: true,
    useCanvasBinding: false,
    ...overrides,
  };
}

function createVault() {
  return {
    getFiles: vi.fn(() => []),
    getAllLoadedFiles: vi.fn(() => []),
    getAbstractFileByPath: vi.fn((): Record<string, unknown> | null => null),
    read: vi.fn(async () => ""),
    readBinary: vi.fn(async () => new ArrayBuffer(0)),
    modify: vi.fn(async () => {}),
    // Parameter signatures are declared so the recorded `mock.calls` are typed
    // (`vi.fn(async () => …)` infers a ZERO-arity mock, whose `calls[i][0]` does
    // not typecheck). Bodies, return values and arity at the call site are
    // unchanged — the arguments are ignored here exactly as before.
    create: vi.fn(async (_path: string, _data: string) => ({})),
    createFolder: vi.fn(async (_path: string) => ({})),
  };
}

function createMockSyncManager() {
  const docs = new Map<string, { doc: Y.Doc; text: Y.Text }>();
  return {
    getDoc: vi.fn((path: string) => {
      if (!docs.has(path)) {
        const doc = new Y.Doc();
        docs.set(path, { doc, text: doc.getText("content") });
      }
      const entry = docs.get(path)!;
      return { doc: entry.doc, text: entry.text, awareness: { destroy: vi.fn() } };
    }),
    // Signature declared for the same reason as `create` / `createFolder` above:
    // `waitForSync.mock.calls` is read positionally at the end of this file.
    waitForSync: vi.fn(async (_path: string) => {}),
    releaseDoc: vi.fn(),
    _docs: docs,
  };
}

function injectManifest(manager: ManifestManager) {
  const doc = new Y.Doc();
  const manifest = doc.getMap<any>("files");
  (manager as any).docHandle = { doc, text: doc.getText("content"), awareness: {} };
  (manager as any).manifest = manifest;
  return { doc, manifest };
}

describe("WP26 AC1/AC2 — syncFromManifest never materialises a sidecar path", () => {
  let vault: ReturnType<typeof createVault>;
  let manager: ManifestManager;
  let manifest: Y.Map<any>;
  let syncManager: ReturnType<typeof createMockSyncManager>;

  beforeEach(() => {
    vault = createVault();
    manager = new ManifestManager(vault as any, createSettings());
    manifest = injectManifest(manager).manifest;
    syncManager = createMockSyncManager();
    (manager as any).syncManager = syncManager;
  });

  it("a TEXT sidecar entry published by a peer is neither doc'd nor written to disk", async () => {
    manifest.set(SIDECAR_INDEX, { hash: "s", size: 10, mtime: 1 });
    manifest.set("notes/keep.md", { hash: "k", size: 10, mtime: 1 });

    const synced = await manager.syncFromManifest();

    expect(syncManager.getDoc.mock.calls.map((call) => call[0])).not.toContain(SIDECAR_INDEX);
    for (const call of vault.create.mock.calls) {
      expect(String(call[0]).startsWith(SIDECAR_DIR)).toBe(false);
    }
    // POSITIVE CONTROL — the ordinary entry in the same manifest IS materialised.
    expect(vault.create).toHaveBeenCalledWith("notes/keep.md", "");
    expect(synced).toBe(1);
  });

  it("a BINARY sidecar entry is not requested — the existing guard's `!entry.binary` misses it", async () => {
    manifest.set(SIDECAR_HISTORY, { hash: "h", size: 10, mtime: 1, binary: true });
    manifest.set(SIDECAR_CHECKPOINT, { hash: "c", size: 10, mtime: 1, binary: true });
    manifest.set("images/photo.png", { hash: "p", size: 10, mtime: 1, binary: true });

    const requestBinary = vi.fn();
    const synced = await manager.syncFromManifest(undefined, undefined, requestBinary);

    expect(requestBinary).not.toHaveBeenCalledWith(SIDECAR_HISTORY);
    expect(requestBinary).not.toHaveBeenCalledWith(SIDECAR_CHECKPOINT);
    // POSITIVE CONTROL — an ordinary binary entry IS still requested.
    expect(requestBinary).toHaveBeenCalledWith("images/photo.png");
    expect(synced).toBe(1);
  });

  it("a DIRECTORY entry under the sidecar directory creates no folder", async () => {
    // The directory branch sits BEFORE the text guard, so a guard bolted onto
    // `:174` alone leaves this open.
    manifest.set(SIDECAR_SUBDIR, { hash: "", size: 0, mtime: 0, directory: true });
    manifest.set("shared/empty", { hash: "", size: 0, mtime: 0, directory: true });

    const synced = await manager.syncFromManifest();

    for (const call of vault.createFolder.mock.calls) {
      expect(String(call[0]).startsWith(SIDECAR_DIR)).toBe(false);
    }
    // POSITIVE CONTROL — an ordinary empty-folder entry IS created.
    expect(vault.createFolder).toHaveBeenCalledWith("shared/empty");
    expect(synced).toBe(1);
  });

  it("the exclusion is not gated on the skipText option", async () => {
    // Only one of the six `syncFromManifest` call sites passes `skipText`; the
    // other five are join / resume / reconnect / reload-from-host. A guard that
    // rides on `skipText` leaks on all five.
    manifest.set(SIDECAR_INDEX, { hash: "s", size: 10, mtime: 1 });
    manifest.set(SIDECAR_HISTORY, { hash: "h", size: 10, mtime: 1, binary: true });

    const requestBinary = vi.fn();
    await manager.syncFromManifest(undefined, undefined, requestBinary, { skipText: true });

    expect(syncManager.getDoc.mock.calls.map((call) => call[0])).not.toContain(SIDECAR_INDEX);
    expect(requestBinary).not.toHaveBeenCalled();
    expect(vault.create).not.toHaveBeenCalled();
  });

  it("never mutes, unmutes or waits for sync on a sidecar path", async () => {
    manifest.set(SIDECAR_INDEX, { hash: "s", size: 10, mtime: 1 });
    manifest.set("notes/keep.md", { hash: "k", size: 10, mtime: 1 });

    const mute = vi.fn();
    const unmute = vi.fn();
    await manager.syncFromManifest(mute, unmute);

    expect(mute).not.toHaveBeenCalledWith(SIDECAR_INDEX);
    expect(syncManager.waitForSync.mock.calls.map((call) => call[0])).not.toContain(SIDECAR_INDEX);
    // POSITIVE CONTROL.
    expect(mute).toHaveBeenCalledWith("notes/keep.md");
  });
});
