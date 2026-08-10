// WP113 — the shared rig for S143, S144 and S157.
//
// WHAT IS REAL AND WHAT IS NOT, stated here rather than per test, because all
// three of this package's defects are "a failure nothing recorded" and a double
// standing in for the thing that should have recorded it would hide every one
// of them perfectly.
//
//   REAL: the project relay (`server/src`, in-process), every peer's
//         `SyncManager`, `Y.Doc` and `Y.Text`, every peer's `ManifestManager`
//         and `BackgroundSync`, the real `subscribe()`, the real
//         `syncFromManifest()`, the real `ensureFolder()`, the real
//         `path-outcome.ts` emitter, and every existing floor and ledger.
//
//   DOUBLE: the vault, `FileOpsManager`'s mute methods, and the debug logger
//           (a recorder — the production `DebugLogger` has no read-back that a
//           test can assert on without also asserting on `S110`'s file-sink
//           setting).
//
// WHAT THE VAULT DOUBLE DOES NOT EXERCISE, exhaustively, because partial
// doubles have cost this project six packages:
//   ├── Obsidian's file watcher and the moment it refreshes `TFile.stat`.
//   │     Nothing in WP113's three subjects reads `stat` except
//   │     `preserveLocalVersion`, which WP115 already drives.
//   ├── `Vault.trash`, metadata, and link resolution — none reachable from
//   │     `subscribe()`, `syncFromManifest()` or `ensureFolder()`.
//   └── Real folder semantics. `createFolder` here is a `Set` insert, and
//         `folderErrors` below is how a FAILING `createFolder` is produced —
//         which is exactly S144's subject, so it is parameterised rather than
//         mocked away.
//
// NOT named `*.test.ts`: vitest must not collect it.

import { TFile, TFolder } from "obsidian";

import { BackgroundSync } from "../../../files/background-sync";
import { ManifestManager } from "../../../files/manifest";
import { SyncManager } from "../../../sync/sync";
import { DEFAULT_SETTINGS, type LiveShareSettings } from "../../../types";
import { createRoom, makeSettings, startRelay, waitUntil } from "../../wp5/harness";

export { waitUntil };

export const SHARE = "_liveshare-test";

export function tfile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  f.stat = { size: 1, mtime: 1, ctime: 1 } as TFile["stat"];
  return f;
}

/**
 * A RECORDING LOGGER, not a spy on a production sink. `S104` is the reason the
 * logger is a parameter everywhere in this package, and a recorder is what makes
 * the parameter observable: every assertion below is on lines that a real
 * `DebugLogger` would have received on the same call.
 */
export interface LoggerDouble {
  lines: string[];
  warn(category: string, message: string): void;
  /** Lines from this package's emitter only. */
  outcomes(): string[];
  /** The one line that names this path, or null. */
  forPath(path: string): string[];
}

export function loggerDouble(): LoggerDouble {
  const lines: string[] = [];
  return {
    lines,
    warn(_category: string, message: string) {
      lines.push(message);
    },
    outcomes: () => lines.filter((l) => l.startsWith("PATH OUTCOME:")),
    forPath: (path: string) => lines.filter((l) => l.includes(` path=${path} `)),
  };
}

export interface VaultDouble {
  bytes: Map<string, string>;
  folders: Set<string>;
  /** Every `createFolder` call, in order — including the ones that threw. */
  folderCreates: string[];
  /**
   * S144's parameter. A segment named here makes `createFolder` throw for it.
   * `mode: "fail"` leaves the folder absent (the real failure); `mode: "race"`
   * throws AND creates it, which is the concurrent create the swallowing
   * `catch` was written for.
   */
  folderErrors: Map<string, { mode: "fail" | "race"; message: string }>;
  // biome-ignore lint/suspicious/noExplicitAny: handed to production code as a Vault
  asVault: any;
}

export function makeVault(initial: Record<string, string> = {}): VaultDouble {
  const bytes = new Map<string, string>(Object.entries(initial));
  const files = new Map<string, TFile>();
  for (const p of Object.keys(initial)) files.set(p, tfile(p));
  const folders = new Set<string>();
  const folderCreates: string[] = [];
  const folderErrors = new Map<string, { mode: "fail" | "race"; message: string }>();

  // `ensureFolder` tests `existing instanceof TFolder`, so a folder has to be a
  // real `TFolder` and not a plain object — the early-return branch is
  // otherwise unreachable and its outcome would never be produced.
  const folderObj = (p: string) => {
    const f = new TFolder();
    f.path = p;
    return f;
  };

  const asVault = {
    getAbstractFileByPath: (p: string) =>
      files.get(p) ?? (folders.has(p) ? folderObj(p) : null),
    getFiles: () => [...files.values()],
    getAllLoadedFiles: () => [...files.values()],
    read: async (f: { path: string }) => bytes.get(f.path) ?? "",
    readBinary: async () => new ArrayBuffer(0),
    modify: async (f: { path: string }, c: string) => void bytes.set(f.path, c),
    create: async (p: string, c: string) => {
      bytes.set(p, c);
      const f = tfile(p);
      files.set(p, f);
      return f;
    },
    createBinary: async (p: string) => void bytes.set(p, "<binary>"),
    createFolder: async (p: string) => {
      folderCreates.push(p);
      const err = folderErrors.get(p);
      if (err) {
        if (err.mode === "race") folders.add(p);
        throw new Error(err.message);
      }
      folders.add(p);
      return {};
    },
    adapter: {
      write: async (p: string, c: string) => void bytes.set(p, c),
      writeBinary: async () => {},
      exists: async (p: string) => bytes.has(p) || folders.has(p),
      stat: async (p: string) =>
        bytes.has(p) ? { type: "file", ctime: 1, mtime: 1, size: 1 } : null,
    },
  };

  return {
    bytes,
    folders,
    folderCreates,
    folderErrors,
    // biome-ignore lint/suspicious/noExplicitAny: content-only vault double
    asVault: asVault as any,
  };
}

export function fileOpsDouble() {
  return {
    mutePathEvents: () => {},
    unmutePathEvents: () => {},
    isPathMuted: () => false,
    isPathMutedFor: () => false,
    // biome-ignore lint/suspicious/noExplicitAny: BackgroundSync reads exactly these four
  } as any;
}

export function settingsFor(over: Partial<LiveShareSettings>): LiveShareSettings {
  return { ...DEFAULT_SETTINGS, sharedFolder: SHARE, ...over } as LiveShareSettings;
}

export function manifestDouble(paths: string[]) {
  const entries = new Map(paths.map((p) => [p, { hash: "x", size: 1, mtime: 0 }]));
  return {
    getEntries: () => entries,
    isSharedPath: (p: string) => p.startsWith(`${SHARE}/`),
    updateFile: async () => {},
    // biome-ignore lint/suspicious/noExplicitAny: BackgroundSync reads exactly these three
  } as any;
}

export interface Peer {
  sync: SyncManager;
  vault: VaultDouble;
  manifest: ManifestManager;
  bg: BackgroundSync;
  logger: LoggerDouble;
}

export interface Rig {
  relay: Awaited<ReturnType<typeof startRelay>>;
  room: { id: string; token: string };
  peers: Peer[];
  peer(opts: {
    clientId: string;
    role: "host" | "guest";
    files?: Record<string, string>;
    /**
     * `false` builds the peer with a REAL `SyncManager` that has never been told
     * to connect — `shouldConnect === false`, which is the exact state `getDoc`
     * answers `null` in, and the state a peer is in between a link dropping and
     * a reconnect being scheduled. Call `peer.sync.connect()` to bring it up.
     *
     * Deliberately NOT `disconnect()`-then-`connect()` on a live socket: that
     * sequence leaves the closed socket's `onclose` to fire AFTER
     * `shouldConnect` is true again, which schedules a third socket and orphans
     * the second. Observed here, on the real manager; out of this package's
     * scope, recorded in the report.
     */
    connect?: boolean;
  }): Promise<Peer>;
  close(): Promise<void>;
}

export async function startRig(name: string): Promise<Rig> {
  const relay = await startRelay();
  const room = await createRoom(relay.port, name);
  const peers: Peer[] = [];
  return {
    relay,
    room,
    peers,
    async peer(opts) {
      const sync = new SyncManager(
        makeSettings({
          serverUrl: `http://localhost:${relay.port}`,
          roomId: room.id,
          token: room.token,
          clientId: opts.clientId,
        }),
      );
      if (opts.connect !== false) sync.connect();
      const vault = makeVault(opts.files ?? {});
      const settings = settingsFor({
        role: opts.role,
        clientId: opts.clientId,
        roomId: room.id,
      });
      const manifest = new ManifestManager(vault.asVault, settings);
      await manifest.connect(sync);
      const logger = loggerDouble();
      manifest.setLogger(logger);
      const bg = new BackgroundSync(vault.asVault, sync, manifest, fileOpsDouble());
      bg.setLogger(logger);
      const peer: Peer = { sync, vault, manifest, bg, logger };
      peers.push(peer);
      return peer;
    },
    async close() {
      for (const p of peers.splice(0)) {
        p.bg.destroy();
        p.sync.destroy();
      }
      await relay.close();
    },
  };
}

/**
 * A REAL `SyncManager` THAT HAS NEVER BEEN TOLD TO CONNECT. Not a double: this
 * is the state `getDoc` answers `null` in — `(!isConnected && !shouldConnect)` —
 * and it is the production state a peer is in between a link dropping and a
 * reconnect starting. Producing `no-doc` any other way would be producing it
 * from a mock rather than from the manager.
 */
export function offlineSync(roomId: string): SyncManager {
  return new SyncManager(settingsFor({ roomId, clientId: "offline" }) as never);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
