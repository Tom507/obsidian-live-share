// WP26 / AC1 + AC2 — consumer 5 of 5: the SECOND, independent gate.
//
// `skipsAutoTextSync` is not the only predicate a sidecar path meets. AC1's first
// verb is "added to the manifest", and manifest MEMBERSHIP is decided by
// `ManifestManager.isSharedPath` (`manifest.ts:319-329`), which consults
// `ExclusionManager.isExcluded` (`manifest.ts:321`). That gate is unrelated to
// the canvas text-sync skip — it is the user/config exclusion list — but a
// sidecar path meets both, and it is the ONLY gate standing between a local
// sidecar file and `publishManifest`.
//
// Why it is not already covered by accident: `ExclusionManager.setPatterns`
// prepends `` `${configDir}/**` ``, and the sidecar directory happens to live
// under `.obsidian`, so with the DEFAULT config dir the sidecar is already
// excluded. That coincidence is exactly what makes a naive test here vacuous.
// Three configurations break the coincidence and are the discriminating rows:
//
//   1. no `ExclusionManager` set at all       → `isSharedPath` returns true today
//   2. a NON-default `configDir`               → `.myconfig/**` misses `.obsidian/…`
//      (`app.vault.configDir` is user-settable; `main.ts:327` forwards whatever
//      Obsidian reports, and `SIDECAR_DIR` is a fixed literal that does not follow it)
//   3. `sharedFolder` pointing into `.obsidian` → re-admits the whole subtree
//
// AC1 says "ever". None of these three may leak.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import * as Y from "yjs";

import {
  SIDECAR_DIR,
  sidecarCheckpointPath,
  sidecarHistoryPath,
  sidecarIndexPath,
} from "../../../files/canvas-sidecar";
import { ExclusionManager } from "../../../files/exclusion";
import { ManifestManager } from "../../../files/manifest";
import type { LiveShareSettings } from "../../../types";

const SIDECAR_INDEX = sidecarIndexPath();
const SIDECAR_HISTORY = sidecarHistoryPath("wp26-tp06");
const SIDECAR_CHECKPOINT = sidecarCheckpointPath("wp26-tp06");
const SIDECAR_PATHS = [SIDECAR_INDEX, SIDECAR_HISTORY, SIDECAR_CHECKPOINT];

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

function mockFile(path: string) {
  const file = Object.create(TFile.prototype);
  file.path = path;
  file.stat = { size: 3, mtime: 7 };
  return file;
}

function createVault(files: string[] = []) {
  return {
    getFiles: vi.fn(() => files.map(mockFile)),
    getAllLoadedFiles: vi.fn(() => []),
    getAbstractFileByPath: vi.fn((): Record<string, unknown> | null => null),
    read: vi.fn(async () => "content"),
    readBinary: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
    modify: vi.fn(async () => {}),
    create: vi.fn(async () => ({})),
    createFolder: vi.fn(async () => ({})),
  };
}

function injectManifest(manager: ManifestManager) {
  const doc = new Y.Doc();
  const manifest = doc.getMap<any>("files");
  (manager as any).docHandle = { doc, text: doc.getText("content"), awareness: {} };
  (manager as any).manifest = manifest;
  return manifest;
}

describe("WP26 AC1 — a sidecar path is never a shared path", () => {
  it("is excluded when NO ExclusionManager has been installed", () => {
    const manager = new ManifestManager(createVault() as any, createSettings());

    for (const path of SIDECAR_PATHS) {
      expect(manager.isSharedPath(path), path).toBe(false);
    }
    // POSITIVE CONTROL — nothing else became unshared.
    expect(manager.isSharedPath("notes/hello.md")).toBe(true);
    expect(manager.isSharedPath("board.canvas")).toBe(true);
  });

  it("is excluded when the vault's config dir is NOT the default `.obsidian`", () => {
    // `SIDECAR_DIR` is a fixed literal; it does not follow `app.vault.configDir`.
    // The `${configDir}/**` pattern therefore stops covering it.
    const manager = new ManifestManager(createVault() as any, createSettings());
    const exclusion = new ExclusionManager();
    exclusion.setConfigDir(".obsidian-work");
    exclusion.setPatterns([]);
    manager.setExclusionManager(exclusion);

    for (const path of SIDECAR_PATHS) {
      expect(manager.isSharedPath(path), path).toBe(false);
    }
    // POSITIVE CONTROL — the configured exclusions still work as before.
    expect(manager.isSharedPath(".obsidian-work/plugins/foo/main.js")).toBe(false);
    expect(manager.isSharedPath("notes/hello.md")).toBe(true);
  });

  it("is excluded even when `sharedFolder` points into the config directory", () => {
    const manager = new ManifestManager(
      createVault() as any,
      createSettings({ sharedFolder: ".obsidian" }),
    );

    for (const path of SIDECAR_PATHS) {
      expect(manager.isSharedPath(path), path).toBe(false);
    }
    // POSITIVE CONTROL — the shared folder itself still admits its own content.
    expect(manager.isSharedPath(".obsidian/snippets/theme.css")).toBe(true);
  });

  it("keeps excluding the default-config-dir case that already worked (characterisation)", () => {
    const manager = new ManifestManager(createVault() as any, createSettings());
    const exclusion = new ExclusionManager();
    exclusion.setConfigDir(".obsidian");
    exclusion.setPatterns([]);
    manager.setExclusionManager(exclusion);

    for (const path of SIDECAR_PATHS) {
      expect(manager.isSharedPath(path), path).toBe(false);
    }
    expect(manager.isSharedPath(".trash/deleted.md")).toBe(false);
  });

  it("does not swallow near-miss siblings of the sidecar directory", () => {
    const manager = new ManifestManager(
      createVault() as any,
      createSettings({ sharedFolder: ".obsidian" }),
    );

    expect(manager.isSharedPath(`${SIDECAR_DIR}ful/notes.md`)).toBe(true);
    // The directory itself names no file; the predicate's contract stops there.
    expect(manager.isSharedPath(".obsidian/liveshare/notes.md")).toBe(true);
  });
});

describe("WP26 AC2 — no sidecar entry ever reaches the published manifest", () => {
  let manifest: Y.Map<any>;

  beforeEach(() => {
    manifest = new Y.Doc().getMap<any>("files");
  });

  it("publishManifest writes every ordinary file and no sidecar file", async () => {
    const vault = createVault([...SIDECAR_PATHS, "notes/hello.md", "board.canvas"]);
    const manager = new ManifestManager(vault as any, createSettings());
    manifest = injectManifest(manager);

    await manager.publishManifest();

    for (const path of SIDECAR_PATHS) {
      expect(manifest.has(path), path).toBe(false);
    }
    // POSITIVE CONTROL — the publish really ran.
    expect(manifest.has("notes/hello.md")).toBe(true);
    expect(manifest.has("board.canvas")).toBe(true);
  });

  it("updateFile refuses to add a sidecar entry", async () => {
    const manager = new ManifestManager(createVault() as any, createSettings());
    manifest = injectManifest(manager);

    await manager.updateFile(mockFile(SIDECAR_INDEX), '{"guid":"abc"}');
    expect(manifest.has(SIDECAR_INDEX)).toBe(false);

    // POSITIVE CONTROL.
    await manager.updateFile(mockFile("notes/hello.md"), "hello");
    expect(manifest.has("notes/hello.md")).toBe(true);
  });

  it("addFolder refuses to add a directory inside the sidecar directory", () => {
    const manager = new ManifestManager(createVault() as any, createSettings());
    manifest = injectManifest(manager);

    manager.addFolder(`${SIDECAR_DIR}/archive`);
    expect(manifest.has(`${SIDECAR_DIR}/archive`)).toBe(false);

    // POSITIVE CONTROL.
    manager.addFolder("shared/empty");
    expect(manifest.has("shared/empty")).toBe(true);
  });
});
