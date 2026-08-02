// WP26 / AC1 + AC2 blind 2 — `syncFromManifest`, attacked one CALLER SHAPE at a
// time and with an already-present local file.
//
// Different angle: `syncFromManifest` has six call sites in `main.ts` — join,
// resume, reconnect, reload-from-host and two others — and they differ in which
// of the four optional arguments they pass. A guard that rides on one of those
// arguments (most plausibly `skipText`, which is the only one that already
// changes which entries are considered) leaks on the five call sites that do not
// pass it. Each of the four argument shapes is therefore exercised separately and
// the same invariant is asserted against each.
//
// The second difference: this test puts a replica file ALREADY ON DISK, with
// content. The `needsSync` computation then takes its other branch — hash compare
// instead of "file missing" — and the method reaches `vault.modify` rather than
// `vault.create`. An overwrite of an existing sidecar file is strictly worse than
// creating a spurious one, and it is invisible to a fixture where the file is
// absent.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import * as Y from "yjs";

import {
  SIDECAR_DIR,
  sidecarHistoryPath,
  sidecarIndexPath,
} from "../../../../../plugin/src/files/canvas-sidecar";
import { ManifestManager } from "../../../../../plugin/src/files/manifest";
import type { LiveShareSettings } from "../../../../../plugin/src/types";

const REPLICA_INDEX = sidecarIndexPath();
const REPLICA_HISTORY = sidecarHistoryPath("z9");
const LOCAL_BYTES = "{}";

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
    role: "guest",
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

function fileFor(path: string) {
  const file = Object.create(TFile.prototype);
  file.path = path;
  file.stat = { size: 2, mtime: 5 };
  return file;
}

function build() {
  const onDisk = new Map<string, string>([
    [REPLICA_INDEX, LOCAL_BYTES],
    ["team/agenda.md", "old agenda"],
  ]);
  const vault = {
    getFiles: vi.fn(() => []),
    getAllLoadedFiles: vi.fn(() => []),
    getAbstractFileByPath: vi.fn((path: string) => (onDisk.has(path) ? fileFor(path) : null)),
    read: vi.fn(async (file: any) => onDisk.get(file.path) ?? ""),
    readBinary: vi.fn(async () => new ArrayBuffer(0)),
    modify: vi.fn(async (file: any, content: string) => {
      onDisk.set(file.path, content);
    }),
    create: vi.fn(async (path: string, content: string) => {
      onDisk.set(path, content);
      return {};
    }),
    createFolder: vi.fn(async () => ({})),
  } as any;
  const manager = new ManifestManager(vault, settings());
  const doc = new Y.Doc();
  const manifest = doc.getMap<any>("files");
  (manager as any).docHandle = { doc, text: doc.getText("content"), awareness: {} };
  (manager as any).manifest = manifest;
  const docs = new Map<string, { doc: Y.Doc; text: Y.Text }>();
  (manager as any).syncManager = {
    getDoc: vi.fn((path: string) => {
      if (!docs.has(path)) {
        const d = new Y.Doc();
        d.getText("content").insert(0, `PEER-CONTENT-FOR-${path}`);
        docs.set(path, { doc: d, text: d.getText("content") });
      }
      const entry = docs.get(path)!;
      return { doc: entry.doc, text: entry.text, awareness: {} };
    }),
    waitForSync: vi.fn(async () => {}),
    releaseDoc: vi.fn(),
  };
  // A peer's manifest claims a DIFFERENT hash for the replica file, so the
  // "needs sync" branch is taken and the overwrite is genuinely attempted.
  manifest.set(REPLICA_INDEX, { hash: "peer-hash-differs", size: 99, mtime: 99 });
  manifest.set(REPLICA_HISTORY, { hash: "peer-hash", size: 99, mtime: 99, binary: true });
  manifest.set(`${SIDECAR_DIR}/incoming/notes.md`, { hash: "peer", size: 9, mtime: 9 });
  manifest.set("team/agenda.md", { hash: "peer-agenda", size: 9, mtime: 9 });
  return { manager, vault, onDisk };
}

const CALLER_SHAPES: Array<[string, Parameters<ManifestManager["syncFromManifest"]>]> = [
  ["join (no options at all)", []],
  ["reconnect (mute + unmute)", [vi.fn(), vi.fn()]],
  ["reload-from-host (with requestBinary)", [vi.fn(), vi.fn(), vi.fn()]],
  ["initial (skipText: true)", [vi.fn(), vi.fn(), vi.fn(), { skipText: true }]],
];

describe("WP26 blind2 — every syncFromManifest caller shape refuses the replica entries", () => {
  for (const [label, args] of CALLER_SHAPES) {
    describe(label, () => {
      let ctx: ReturnType<typeof build>;

      beforeEach(() => {
        ctx = build();
      });

      it("never overwrites an EXISTING replica file on disk", async () => {
        await ctx.manager.syncFromManifest(...(args as []));

        expect(ctx.onDisk.get(REPLICA_INDEX)).toBe(LOCAL_BYTES);
        for (const call of ctx.vault.modify.mock.calls) {
          expect(String(call[0]?.path ?? "").startsWith(SIDECAR_DIR)).toBe(false);
        }
      });

      it("never creates a replica file that is absent locally", async () => {
        await ctx.manager.syncFromManifest(...(args as []));

        expect(ctx.onDisk.has(`${SIDECAR_DIR}/incoming/notes.md`)).toBe(false);
        for (const call of ctx.vault.create.mock.calls) {
          expect(String(call[0]).startsWith(SIDECAR_DIR)).toBe(false);
        }
      });
    });
  }
});

describe("WP26 blind2 — POSITIVE CONTROL for the same fixture", () => {
  it("an ordinary entry whose hash differs IS overwritten from the peer", async () => {
    const ctx = build();

    await ctx.manager.syncFromManifest();

    expect(ctx.onDisk.get("team/agenda.md")).toBe("PEER-CONTENT-FOR-team/agenda.md");
  });
});
