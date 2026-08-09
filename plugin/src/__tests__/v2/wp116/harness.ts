// WP116 / S159 — the rig for the rename-pairing rows.
//
// WHAT IS REAL HERE, BECAUSE PARTIAL TEST DOUBLES HAVE COST THIS PROJECT SIX
// PACKAGES AND THE RULE IS NOW "drive the real object, or state exactly which
// paths your double does not exercise":
//
//   ├── `LiveSharePlugin.prototype.processManifestChange` — the SHIPPED body,
//   │      invoked with a fake `this` (the `v2/ux01` + `v2/wp85` precedent). The
//   │      rename arm, the hash reads, the pairer, `decideManifestRename`, the
//   │      `vault.rename` sink, the removal loop and the delegation to
//   │      `cleanupStaleFiles` are all executed, not transcribed.
//   ├── `LiveSharePlugin.prototype.cleanupStaleFiles` — also the shipped body,
//   │      also off the prototype. Its six evidence floors decide for
//   │      themselves whether anything is trashed; no row stubs it out.
//   ├── BOTH `ManifestManager`s — real, over one real `Y.Doc`, and the manifest
//   │      hashes are computed by the real `publishManifest` from the host
//   │      vault's real content rather than hand-poked into the map. What the
//   │      guest reads is what a host actually emits.
//   └── `files/rename-identity.ts` and `files/manifest-removal-decision.ts` —
//          pure modules, called directly, never re-implemented.
//
// WHAT IS A DOUBLE, AND EXACTLY WHICH PATHS IT DOES NOT EXERCISE:
//
//   ├── `vault` — an in-memory store returning real `TFile` instances. It
//   │      implements `read`/`readBinary`/`rename`/`create`/`createFolder`/
//   │      `getFiles`/`getAllLoadedFiles`/`getAbstractFileByPath`/`adapter.exists`
//   │      with real path bookkeeping, so `rename` really moves the entry and a
//   │      later `getAbstractFileByPath` really sees it. NOT exercised: Obsidian's
//   │      own link rewriting, its file cache, its `trash` semantics (a trashed
//   │      file is removed from the store), and case-insensitive path collision.
//   ├── `backgroundSync` — records calls. NOT exercised: subscription,
//   │      `Y.Doc` creation, or any content transfer. Every row below is about
//   │      WHICH FILE THE ROUTE MOVES OR TRASHES, which happens entirely inside
//   │      `processManifestChange`; nothing asserted here depends on what
//   │      `backgroundSync` would have done afterwards.
//   ├── `fileOpsManager` — records mute/release calls. NOT exercised: the mute
//   │      window itself (WP93's territory) or vault-event suppression.
//   └── `syncManager` — supplies one shared `Y.Doc` per room. NOT exercised: the
//          websocket, awareness, or any real sync.

import { TFile, TFolder } from "obsidian";
import { vi } from "vitest";
import * as Y from "yjs";

import { ManifestManager } from "../../../files/manifest";
import LiveSharePlugin from "../../../main";
import { hashContent, normalizeLineEndings } from "../../../utils";
import { DEFAULT_SETTINGS, type LiveShareSettings, type ManifestChangeDisposition } from "../../../types";

export const HOST_ID = "wp116-host";
export const GUEST_ID = "wp116-guest";
export const ROOT = "_liveshare-test";

/** An in-memory vault that returns real `TFile`s and really moves them. */
export class FakeVault {
  readonly files = new Map<string, string>();
  readonly folders = new Set<string>();
  readonly renames: { from: string; to: string }[] = [];
  readonly trashed: string[] = [];
  readonly configDir = ".obsidian";

  constructor(seed: Record<string, string> = {}) {
    for (const [path, content] of Object.entries(seed)) this.write(path, content);
  }

  write(path: string, content: string): void {
    this.files.set(path, content);
    const cut = path.lastIndexOf("/");
    if (cut > 0) this.folders.add(path.slice(0, cut));
  }

  private handle(path: string): TFile {
    const file = new TFile();
    file.path = path;
    const content = this.files.get(path) ?? "";
    file.stat = { size: Buffer.byteLength(content, "utf8"), mtime: 1, ctime: 1 };
    return file;
  }

  getFiles(): TFile[] {
    return [...this.files.keys()].map((p) => this.handle(p));
  }

  getAllLoadedFiles(): (TFile | TFolder)[] {
    // Folders are returned WITHOUT children so `publishManifest`'s empty-folder
    // arm never fires: these rows are about files, and a directory placeholder
    // entry (hash `""`) would add a second, unrelated pairing story.
    return this.getFiles();
  }

  getAbstractFileByPath(path: string): TFile | TFolder | null {
    if (this.files.has(path)) return this.handle(path);
    if (this.folders.has(path)) {
      const folder = new TFolder();
      folder.path = path;
      return folder;
    }
    return null;
  }

  async read(file: { path: string }): Promise<string> {
    const content = this.files.get(file.path);
    if (content === undefined) throw new Error(`no such file: ${file.path}`);
    return content;
  }

  async readBinary(file: { path: string }): Promise<ArrayBuffer> {
    return new TextEncoder().encode(await this.read(file)).buffer as ArrayBuffer;
  }

  async modify(file: { path: string }, content: string): Promise<void> {
    this.files.set(file.path, content);
  }

  async create(path: string, content: string): Promise<TFile> {
    this.write(path, content);
    return this.handle(path);
  }

  async createFolder(path: string): Promise<void> {
    this.folders.add(path);
  }

  async rename(file: { path: string }, next: string): Promise<void> {
    const content = this.files.get(file.path);
    if (content === undefined) throw new Error(`rename of a missing file: ${file.path}`);
    this.renames.push({ from: file.path, to: next });
    this.files.delete(file.path);
    this.write(next, content);
  }

  trash(path: string): void {
    this.trashed.push(path);
    this.files.delete(path);
  }

  readonly adapter = {
    exists: async (path: string): Promise<boolean> => this.files.has(path),
  };
}

function syncDouble(doc: Y.Doc) {
  return {
    getDoc: () => ({ doc, text: doc.getText("content"), awareness: {} }),
    waitForSync: async () => {},
    releaseDoc: vi.fn(),
  };
}

export interface Rig {
  /**
   * Runs the SHIPPED `processManifestChange` for one (added, removed) event.
   *
   * `plantForeign` writes one entry straight into the shared `files` map after
   * the host has published, WITHOUT going through `publishManifest`. That is not
   * a shortcut: our own publisher refuses `.obsidian/**` in
   * `passesLocalSafetyFloors`, so a key under that tree can ONLY ever arrive
   * from a peer that is not running our publisher — which is WP95's hostile peer,
   * modelled accurately rather than approximated.
   */
  run(
    added: string[],
    removed: string[],
    plantForeign?: { path: string; content: string },
  ): Promise<ManifestChangeDisposition>;
  guestVault: FakeVault;
  hostVault: FakeVault;
  logs: string[];
}

/**
 * One room, two real `ManifestManager`s, one real `Y.Doc`. The host's vault is
 * published by the real `publishManifest`, so every manifest hash the guest
 * pairs against was computed from real bytes.
 *
 * `liveHost` / `baseline` exist so a row can choose whether the DELEGATED half
 * of the chain — the gated stale reconcile — actually reaches `trashFile`. Both
 * settings are honoured by the shipped `cleanupStaleFiles`, not by this rig.
 */
export async function rig(options: {
  guest: Record<string, string>;
  host: Record<string, string>;
  /** Default `true`: a peer claiming host is present, so the reconcile can run. */
  liveHost?: boolean;
  /** Pre-join baseline. `null` refuses the reconcile outright; `[]` allows it. */
  baseline?: string[] | null;
  /**
   * The host's `sharedFolder`. Defaults to {@link ROOT}. WP95's row needs `""`
   * — "the whole vault" — because that is the only configuration in which a
   * host's real `publishManifest` will emit a key under `.obsidian/**` at all,
   * and the row is about what the CONSUMER does with such a key.
   */
  hostSharedFolder?: string;
}): Promise<Rig> {
  const doc = new Y.Doc();
  const guestVault = new FakeVault(options.guest);
  const hostVault = new FakeVault(options.host);

  const guestSettings: LiveShareSettings = {
    ...DEFAULT_SETTINGS,
    clientId: GUEST_ID,
    githubUserId: "",
    role: "guest",
    sharedFolder: ROOT,
  };
  const hostSettings: LiveShareSettings = {
    ...DEFAULT_SETTINGS,
    clientId: HOST_ID,
    githubUserId: "",
    role: "host",
    sharedFolder: options.hostSharedFolder ?? ROOT,
  };

  const guestManifest = new ManifestManager(guestVault as never, guestSettings as never);
  await guestManifest.connect(syncDouble(doc) as never);
  const hostManifest = new ManifestManager(hostVault as never, hostSettings as never);
  await hostManifest.connect(syncDouble(doc) as never);

  const logs: string[] = [];
  const backgroundSync = {
    onFileRemoved: vi.fn(),
    onFileAdded: vi.fn(async () => {}),
    registerAnnounced: vi.fn(),
  };

  // biome-ignore lint/suspicious/noExplicitAny: the fake stands in for LiveSharePlugin
  const fake: any = Object.assign(Object.create((LiveSharePlugin as any).prototype), {
    settings: guestSettings,
    manifestManager: guestManifest,
    backgroundSync,
    canvasSync: undefined,
    canvasMirrorQueue: Promise.resolve(),
    manifestChangePasses: 0,
    manifestChangeHistory: [],
    lastManifestChange: null,
    remoteUsers: new Map(
      options.liveHost === false ? [] : [[HOST_ID, { userId: HOST_ID, isHost: true }]],
    ),
    vaultBaseline: options.baseline === null ? null : new Set(options.baseline ?? []),
    app: {
      vault: guestVault,
      fileManager: {
        trashFile: vi.fn(async (file: { path: string }) => {
          guestVault.trash(file.path);
        }),
      },
    },
    fileOpsManager: {
      mutePathEvents: vi.fn(),
      unmutePathEvents: vi.fn(),
      armMuteRelease: vi.fn(),
    },
    mutePathEvents: vi.fn(),
    unmutePathEvents: vi.fn(),
    requestBinaryFile: vi.fn(),
    notify: vi.fn(),
    logger: {
      log: (category: string, message: string) => logs.push(`${category}: ${message}`),
      debug: () => {},
      warn: () => {},
      error: () => {},
    },
  });

  return {
    guestVault,
    hostVault,
    logs,
    async run(
      added: string[],
      removed: string[],
      plantForeign?: { path: string; content: string },
    ) {
      // The host publishes FIRST, so the manifest the guest pairs against is the
      // real post-gesture publication with real hashes and a fresh attestation.
      const decision = await hostManifest.publishManifest({ purge: true });
      if (!decision.published) throw new Error(`the host did not publish: ${decision.reason}`);

      if (plantForeign) {
        const hash = await hashContent(normalizeLineEndings(plantForeign.content));
        doc.transact(() => {
          doc.getMap("files").set(plantForeign.path, {
            hash,
            size: plantForeign.content.length,
            mtime: 1,
          });
        });
      }

      const disposition: ManifestChangeDisposition = {
        pass: 1,
        added: [...added],
        removed: [...removed],
        updated: [],
        removals: [],
        renames: [],
        renamed: [],
        delegated: [],
        destroyed: [],
        reconcile: null,
        aborted: false,
        error: "",
      };
      await fake.processManifestChange(added, removed, [], disposition);
      return disposition;
    },
  };
}
