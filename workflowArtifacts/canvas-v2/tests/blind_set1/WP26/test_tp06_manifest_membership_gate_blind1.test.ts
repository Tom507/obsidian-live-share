// WP26 / AC1 + AC2 blind 1 — the manifest MEMBERSHIP gate, attacked through the
// publish path end to end instead of through `isSharedPath` directly.
//
// Different angle: `isSharedPath` is a predicate and easy to satisfy in isolation.
// The claim AC1 actually makes is about the manifest CONTENT — "no file under the
// replica directory is ever added to the manifest" — so this test publishes a
// whole vault and compares the resulting key set as one value. Every writer into
// the manifest is exercised in the same run (`publishManifest`, `updateFile`,
// `addFolder`, `renameFile`), because each of them consults membership
// separately and `renameFile` consults it not at all.
//
// `renameFile` is the interesting row: it moves an EXISTING entry and asks no
// permission. If an older session, an older plugin version or a hostile peer ever
// put a replica path into the manifest, a rename must not be able to carry it
// forward — and a rename of an ordinary file INTO the replica directory must not
// be able to smuggle one in.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import * as Y from "yjs";

import {
  SIDECAR_DIR,
  isSidecarPath,
  sidecarCheckpointPath,
  sidecarHistoryPath,
  sidecarIndexPath,
} from "../../../../../plugin/src/files/canvas-sidecar";
import { ExclusionManager } from "../../../../../plugin/src/files/exclusion";
import { ManifestManager } from "../../../../../plugin/src/files/manifest";
import type { LiveShareSettings } from "../../../../../plugin/src/types";

const VAULT_FILES = [
  "team/agenda.md",
  "media/logo.png",
  "boards/plan.canvas",
  `${SIDECAR_DIR}ful/report.md`,
  sidecarIndexPath(),
  sidecarHistoryPath("p3"),
  sidecarCheckpointPath("p3"),
  `${SIDECAR_DIR}/deep/nested/thing.md`,
];

const EXPECTED_KEYS = [
  "team/agenda.md",
  "media/logo.png",
  "boards/plan.canvas",
  `${SIDECAR_DIR}ful/report.md`,
].sort();

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

function fileFor(path: string) {
  const file = Object.create(TFile.prototype);
  file.path = path;
  file.stat = { size: 4, mtime: 11 };
  return file;
}

function build(overrides: Partial<LiveShareSettings> = {}, exclusion?: ExclusionManager) {
  const vault = {
    getFiles: vi.fn(() => VAULT_FILES.map(fileFor)),
    getAllLoadedFiles: vi.fn(() => []),
    getAbstractFileByPath: vi.fn(() => null),
    read: vi.fn(async () => "text"),
    readBinary: vi.fn(async () => new Uint8Array([9]).buffer),
    modify: vi.fn(async () => {}),
    create: vi.fn(async () => ({})),
    createFolder: vi.fn(async () => ({})),
  } as any;
  const manager = new ManifestManager(vault, settings(overrides));
  if (exclusion) manager.setExclusionManager(exclusion);
  const doc = new Y.Doc();
  const manifest = doc.getMap<any>("files");
  (manager as any).docHandle = { doc, text: doc.getText("content"), awareness: {} };
  (manager as any).manifest = manifest;
  return { manager, manifest };
}

describe("WP26 blind1 — the published manifest is exactly the vault minus the replica state", () => {
  it("with no exclusion manager configured at all", async () => {
    const { manager, manifest } = build();
    await manager.publishManifest();
    expect([...manifest.keys()].sort()).toEqual(EXPECTED_KEYS);
  });

  it("with the default config dir", async () => {
    const exclusion = new ExclusionManager();
    exclusion.setConfigDir(".obsidian");
    exclusion.setPatterns([]);
    const { manager, manifest } = build({}, exclusion);
    await manager.publishManifest();
    // The config-dir pattern removes the replica files AND the near-miss sibling.
    expect([...manifest.keys()].sort()).toEqual(
      EXPECTED_KEYS.filter((key) => !key.startsWith(".obsidian")),
    );
  });

  it("with a relocated config dir", async () => {
    const exclusion = new ExclusionManager();
    exclusion.setConfigDir(".config-obsidian");
    exclusion.setPatterns([]);
    const { manager, manifest } = build({}, exclusion);
    await manager.publishManifest();
    expect([...manifest.keys()].sort()).toEqual(EXPECTED_KEYS);
  });

  it("with a shared folder that encloses the replica directory", async () => {
    const { manager, manifest } = build({ sharedFolder: ".obsidian" });
    await manager.publishManifest();
    expect([...manifest.keys()].filter((key) => isSidecarPath(key))).toEqual([]);
    // POSITIVE CONTROL — the shared folder still publishes its own content.
    expect([...manifest.keys()]).toContain(`${SIDECAR_DIR}ful/report.md`);
  });
});

describe("WP26 blind1 — the other manifest writers agree with publishManifest", () => {
  let ctx: ReturnType<typeof build>;

  beforeEach(() => {
    ctx = build();
  });

  it("updateFile adds every ordinary file and no replica file", async () => {
    for (const path of VAULT_FILES) {
      await ctx.manager.updateFile(fileFor(path), "content");
    }
    expect([...ctx.manifest.keys()].filter((key) => isSidecarPath(key))).toEqual([]);
    expect([...ctx.manifest.keys()]).toContain("team/agenda.md");
  });

  it("addFolder refuses every folder under the replica directory", () => {
    ctx.manager.addFolder(`${SIDECAR_DIR}/one`);
    ctx.manager.addFolder(`${SIDECAR_DIR}/one/two`);
    ctx.manager.addFolder("team/one");

    expect([...ctx.manifest.keys()].filter((key) => isSidecarPath(key))).toEqual([]);
    expect([...ctx.manifest.keys()]).toContain("team/one");
  });

  it("renameFile cannot smuggle an entry into the replica directory", async () => {
    await ctx.manager.updateFile(fileFor("team/agenda.md"), "content");

    ctx.manager.renameFile("team/agenda.md", `${SIDECAR_DIR}/agenda.md`);

    expect([...ctx.manifest.keys()].filter((key) => isSidecarPath(key))).toEqual([]);
  });
});
