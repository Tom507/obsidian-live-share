// WP26 / AC1 blind 2 — the manifest MEMBERSHIP gate, attacked through
// RECONFIGURATION over time rather than through a fixed setup.
//
// Different angle: the two inputs the membership gate depends on are both mutable
// at runtime. `ManifestManager.updateSettings` swaps the shared folder while a
// session is live (`main.ts`), and `ExclusionManager.setPatterns` is re-invoked on
// every settings save (`main.ts:500`), REBUILDING the pattern array from scratch
// each time. Any implementation that adds the replica directory to that array once
// — in a constructor, in a first `setPatterns`, or by mutating `patterns` after
// the fact — is silently undone by the next settings save, and a test that
// configures once and asserts once cannot see it.
//
// So every assertion here is made AFTER a reconfiguration, and the sequence walks
// through the configurations a real user produces: set a shared folder, add
// exclude patterns, change the config directory, clear everything again.
//
// The user's own exclude patterns are also checked for the opposite failure: the
// gate must not have replaced them, only added to them.

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  SIDECAR_DIR,
  sidecarCheckpointPath,
  sidecarHistoryPath,
  sidecarIndexPath,
} from "../../../../../plugin/src/files/canvas-sidecar";
import { ExclusionManager } from "../../../../../plugin/src/files/exclusion";
import { ManifestManager } from "../../../../../plugin/src/files/manifest";
import type { LiveShareSettings } from "../../../../../plugin/src/types";

const REPLICA = [
  sidecarIndexPath(),
  sidecarHistoryPath("v4"),
  sidecarCheckpointPath("v4"),
  `${SIDECAR_DIR}/a/b/c.md`,
  `${SIDECAR_DIR}/no-extension`,
];

function settings(overrides: Partial<LiveShareSettings> = {}): LiveShareSettings {
  return {
    serverUrl: "http://localhost:3000",
    roomId: "r",
    token: "t",
    jwt: "",
    githubUserId: "",
    avatarUrl: "",
    displayName: "T",
    cursorColor: "#ff0000",
    sharedFolder: "",
    role: "host",
    encryptionPassphrase: "",
    encryptionSalt: "",
    permission: "read-write",
    requireApproval: false,
    serverPassword: "",
    clientId: "c",
    notificationsEnabled: true,
    debugLogging: false,
    debugLogPath: "d.md",
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

function vaultStub() {
  return {
    getFiles: vi.fn(() => []),
    getAllLoadedFiles: vi.fn(() => []),
    getAbstractFileByPath: vi.fn(() => null),
    read: vi.fn(async () => ""),
    readBinary: vi.fn(async () => new ArrayBuffer(0)),
    modify: vi.fn(async () => {}),
    create: vi.fn(async () => ({})),
    createFolder: vi.fn(async () => ({})),
  } as any;
}

function expectAllRefused(manager: ManifestManager, label: string) {
  for (const path of REPLICA) {
    expect(manager.isSharedPath(path), `${label}: ${path}`).toBe(false);
  }
}

describe("WP26 blind2 — the membership gate survives every reconfiguration", () => {
  let manager: ManifestManager;
  let exclusion: ExclusionManager;

  beforeEach(() => {
    manager = new ManifestManager(vaultStub(), settings());
    exclusion = new ExclusionManager();
    exclusion.setConfigDir(".vaultconfig");
    exclusion.setPatterns([]);
    manager.setExclusionManager(exclusion);
  });

  it("holds through a shared-folder change mid-session", () => {
    expectAllRefused(manager, "initial");

    manager.updateSettings(settings({ sharedFolder: ".obsidian" }));
    expectAllRefused(manager, "after sharedFolder = .obsidian");

    manager.updateSettings(settings({ sharedFolder: SIDECAR_DIR }));
    expectAllRefused(manager, "after sharedFolder = the replica dir itself");

    manager.updateSettings(settings({ sharedFolder: "" }));
    expectAllRefused(manager, "after sharedFolder cleared");
  });

  it("holds through repeated setPatterns calls, which rebuild the array each time", () => {
    for (let round = 0; round < 4; round++) {
      exclusion.setPatterns([`round-${round}/**`, "*.tmp"]);
      expectAllRefused(manager, `after setPatterns round ${round}`);
    }
  });

  it("holds through a config-directory change", () => {
    for (const dir of [".obsidian", ".vaultconfig", "", ".obsidian-mobile"]) {
      exclusion.setConfigDir(dir);
      exclusion.setPatterns([]);
      expectAllRefused(manager, `after configDir = ${JSON.stringify(dir)}`);
    }
  });

  it("does not replace the user's own exclusions — POSITIVE CONTROL", () => {
    exclusion.setConfigDir(".vaultconfig");
    exclusion.setPatterns(["drafts/**", "*.tmp"]);

    expect(manager.isSharedPath("drafts/idea.md")).toBe(false);
    expect(manager.isSharedPath("scratch.tmp")).toBe(false);
    expect(manager.isSharedPath(".vaultconfig/plugins/x/main.js")).toBe(false);
    expect(manager.isSharedPath(".trash/gone.md")).toBe(false);
    // ...and ordinary content is still shared.
    expect(manager.isSharedPath("team/agenda.md")).toBe(true);
    expect(manager.isSharedPath(`${SIDECAR_DIR}ful/report.md`)).toBe(true);
  });

  it("holds when the manager is handed a fresh ExclusionManager mid-session", () => {
    const replacement = new ExclusionManager();
    manager.setExclusionManager(replacement);
    expectAllRefused(manager, "with a never-configured replacement");

    replacement.setConfigDir(".obsidian");
    replacement.setPatterns(["*.tmp"]);
    expectAllRefused(manager, "with the replacement configured");
  });
});

describe("WP26 blind2 — a live manifest never accepts a replica key", () => {
  it("publishManifest and updateFile agree with isSharedPath after reconfiguration", async () => {
    const manager = new ManifestManager(vaultStub(), settings({ sharedFolder: ".obsidian" }));
    const doc = new Y.Doc();
    const manifest = doc.getMap<any>("files");
    (manager as any).docHandle = { doc, text: doc.getText("content"), awareness: {} };
    (manager as any).manifest = manifest;

    manager.updateSettings(settings({ sharedFolder: SIDECAR_DIR }));
    for (const path of REPLICA) {
      await manager.updateFile({ path, stat: { size: 1, mtime: 1 } } as any, "x");
    }

    expect([...manifest.keys()]).toEqual([]);

    // POSITIVE CONTROL — the same manager, same settings, an in-folder file.
    await manager.updateFile(
      { path: `${SIDECAR_DIR}ful/report.md`, stat: { size: 1, mtime: 1 } } as any,
      "x",
    );
    manager.updateSettings(settings({ sharedFolder: "" }));
    await manager.updateFile({ path: "team/agenda.md", stat: { size: 1, mtime: 1 } } as any, "x");
    expect([...manifest.keys()]).toContain("team/agenda.md");
  });
});
