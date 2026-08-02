// WP26 / AC1 + AC2 blind 1 — `syncFromManifest`, attacked through its RETURN
// VALUE and its side-effect log instead of through per-call spies.
//
// Different angle: `syncFromManifest` returns the number of entries it acted on.
// That single integer spans all three of its branches (directory, binary, text)
// at once, so a manifest built with a known partition turns the whole method into
// one arithmetic oracle: `synced` must equal the count of NON-replica entries,
// no matter which branch each of them takes. An implementation that plugs the
// text branch and leaves the binary or directory branch open produces a number
// that is too large, and it does so without any spy having to name the leak in
// advance.
//
// The second oracle is a complete ordered log of everything the method did to the
// outside world (folder creates, file creates, file modifies, binary requests).
// Nothing in that log may name a path under the replica directory, and the log
// must be non-empty — the same run has to prove it is capable of doing work.

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  SIDECAR_DIR,
  isSidecarPath,
  sidecarCheckpointPath,
  sidecarHistoryPath,
  sidecarIndexPath,
} from "../../../../../plugin/src/files/canvas-sidecar";
import { ManifestManager } from "../../../../../plugin/src/files/manifest";
import type { LiveShareSettings } from "../../../../../plugin/src/types";

const REPLICA_ENTRIES: Array<[string, Record<string, unknown>]> = [
  [sidecarIndexPath(), { hash: "1", size: 1, mtime: 1 }],
  [sidecarHistoryPath("k1"), { hash: "2", size: 1, mtime: 1, binary: true }],
  [sidecarCheckpointPath("k1"), { hash: "3", size: 1, mtime: 1, binary: true }],
  [`${SIDECAR_DIR}/rescue/notes.md`, { hash: "4", size: 1, mtime: 1 }],
  [`${SIDECAR_DIR}/blob.bin`, { hash: "5", size: 1, mtime: 1, binary: true }],
  [`${SIDECAR_DIR}/archive`, { hash: "", size: 0, mtime: 0, directory: true }],
  [`${SIDECAR_DIR}/archive/deep`, { hash: "", size: 0, mtime: 0, directory: true }],
];

const ORDINARY_ENTRIES: Array<[string, Record<string, unknown>]> = [
  ["team/agenda.md", { hash: "a", size: 1, mtime: 1 }],
  ["team/notes.json", { hash: "b", size: 1, mtime: 1 }],
  ["media/logo.png", { hash: "c", size: 1, mtime: 1, binary: true }],
  ["team/empty-folder", { hash: "", size: 0, mtime: 0, directory: true }],
  [`${SIDECAR_DIR}ful/report.md`, { hash: "d", size: 1, mtime: 1 }],
];

function settings(): LiveShareSettings {
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
  };
}

describe("WP26 blind1 — syncFromManifest acts on ordinary entries only", () => {
  let log: string[];
  let manager: ManifestManager;
  let manifest: Y.Map<any>;
  let requestBinary: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    log = [];
    const vault = {
      getFiles: vi.fn(() => []),
      getAllLoadedFiles: vi.fn(() => []),
      getAbstractFileByPath: vi.fn(() => null),
      read: vi.fn(async () => ""),
      readBinary: vi.fn(async () => new ArrayBuffer(0)),
      modify: vi.fn(async (file: any) => {
        log.push(`modify:${file.path}`);
      }),
      create: vi.fn(async (path: string) => {
        log.push(`create:${path}`);
        return {};
      }),
      createFolder: vi.fn(async (path: string) => {
        log.push(`folder:${path}`);
        return {};
      }),
    } as any;
    manager = new ManifestManager(vault, settings());
    const doc = new Y.Doc();
    manifest = doc.getMap<any>("files");
    (manager as any).docHandle = { doc, text: doc.getText("content"), awareness: {} };
    (manager as any).manifest = manifest;
    const docs = new Map<string, { doc: Y.Doc; text: Y.Text }>();
    (manager as any).syncManager = {
      getDoc: vi.fn((path: string) => {
        log.push(`getDoc:${path}`);
        if (!docs.has(path)) {
          const d = new Y.Doc();
          docs.set(path, { doc: d, text: d.getText("content") });
        }
        const entry = docs.get(path)!;
        return { doc: entry.doc, text: entry.text, awareness: {} };
      }),
      waitForSync: vi.fn(async () => {}),
      releaseDoc: vi.fn(),
    };
    requestBinary = vi.fn((path: string) => {
      log.push(`binary:${path}`);
    });
    // Interleaved so no implementation can pass by an ordering accident.
    const rows = [...REPLICA_ENTRIES];
    ORDINARY_ENTRIES.forEach((row, index) => rows.splice(index * 2, 0, row));
    for (const [path, entry] of rows) manifest.set(path, entry);
  });

  it("the synced count equals the number of ordinary entries, exactly", async () => {
    const synced = await manager.syncFromManifest(undefined, undefined, requestBinary);
    expect(synced).toBe(ORDINARY_ENTRIES.length);
  });

  it("nothing the method did names a path inside the replica directory", async () => {
    await manager.syncFromManifest(undefined, undefined, requestBinary);

    const offenders = log.filter((line) => isSidecarPath(line.slice(line.indexOf(":") + 1)));
    expect(offenders).toEqual([]);
    // ...and the run was not simply inert.
    expect(log.length).toBeGreaterThan(ORDINARY_ENTRIES.length);
  });

  it("every ordinary entry still produced its own effect", async () => {
    await manager.syncFromManifest(undefined, undefined, requestBinary);

    expect(log).toContain("create:team/agenda.md");
    expect(log).toContain("create:team/notes.json");
    expect(log).toContain("binary:media/logo.png");
    expect(log).toContain("folder:team/empty-folder");
    expect(log).toContain(`create:${SIDECAR_DIR}ful/report.md`);
  });
});
