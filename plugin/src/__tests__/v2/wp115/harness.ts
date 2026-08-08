// WP115 — the shared rig for S148 and S151.
//
// WHAT IS REAL AND WHAT IS NOT, stated here rather than per test, because this
// package's defect is "a function that was never called" and a double standing
// in for the caller would hide it perfectly.
//
//   REAL: the NeuralAngels relay (`server/src`, in-process), both peers'
//         `SyncManager`s and `Y.Doc`s, both peers' `ManifestManager`s and
//         `BackgroundSync`es, the manifest publication, `syncFromManifest`,
//         `subscribe`, `preserveLocalVersion`, every floor and every ledger.
//
//   DOUBLE: the vault, and `FileOpsManager`'s four mute methods.
//
// WHAT THE VAULT DOUBLE DOES NOT EXERCISE, exhaustively:
//   ├── Obsidian's own file watcher, and the moment at which it refreshes a
//   │     `TFile.stat`. That refresh is the S148 PRECONDITION, so the double
//   │     does not model it — it PARAMETERISES it: `cachedMtime` is what
//   │     `TFile.stat.mtime` reports and `diskMtime` is what `adapter.stat`
//   │     reports, and a test sets them apart on purpose. A running Obsidian
//   │     can hold the two apart; a restarted one cannot.
//   ├── Obsidian's editor and its own save cadence for the ACTIVE file. That is
//   │     S151's subject and it is deliberately outside: the point of S151 is
//   │     that the plugin does not write the active file at all.
//   └── `Vault.trash`, folder semantics beyond `createFolder`, and metadata.
//
// NOT named `*.test.ts`: vitest must not collect it.

import { TFile } from "obsidian";

import { BackgroundSync } from "../../../files/background-sync";
import { ManifestManager } from "../../../files/manifest";
import type { SyncManager } from "../../../sync/sync";
import { DEFAULT_SETTINGS, type LiveShareSettings } from "../../../types";
import { createRoom, newClient, startRelay } from "../../wp5/harness";

export const SHARE = "_liveshare-test";
export const CONFLICTS = `${SHARE} (conflicts)`;

export function tfile(path: string, mtime: number): TFile {
  const f = new TFile();
  f.path = path;
  f.stat = { size: 1, mtime, ctime: 1 } as TFile["stat"];
  return f;
}

export interface VaultDouble {
  bytes: Map<string, string>;
  /** Every write, in order, tagged with the API that performed it. */
  writes: string[];
  /** Paths under the conflicts root, i.e. preserved versions. */
  conflictCopies(): string[];
  /** Does any file anywhere still contain this marker? */
  survives(marker: string): boolean;
  // biome-ignore lint/suspicious/noExplicitAny: handed to production code as a Vault
  asVault: any;
}

/**
 * `cachedMtime` is `TFile.stat.mtime` — Obsidian's in-memory index.
 * `diskMtime` is what `adapter.stat` answers — the filesystem.
 *
 * Two parameters and not one, because S148 is exactly the case in which they
 * disagree. `diskMtime` defaults to `cachedMtime`, which is the restarted-vault
 * setup where they cannot disagree.
 */
export function makeVault(
  initial: Record<string, string>,
  opts: { cachedMtime?: number; diskMtime?: number; statThrows?: boolean; noStat?: boolean } = {},
): VaultDouble {
  const cachedMtime = opts.cachedMtime ?? 1;
  const diskMtime = opts.diskMtime ?? cachedMtime;
  const bytes = new Map<string, string>(Object.entries(initial));
  const files = new Map<string, TFile>();
  for (const p of Object.keys(initial)) files.set(p, tfile(p, cachedMtime));
  const folders = new Set<string>();
  const writes: string[] = [];

  const adapter: Record<string, unknown> = {
    write: async (p: string, c: string) => {
      writes.push(`adapter.write:${p}`);
      bytes.set(p, c);
    },
    writeBinary: async () => {},
    exists: async (p: string) => bytes.has(p) || folders.has(p),
  };
  if (!opts.noStat) {
    adapter.stat = async (p: string) => {
      if (opts.statThrows) throw new Error("adapter.stat is unavailable");
      if (!bytes.has(p)) return null;
      return { type: "file", ctime: 1, mtime: diskMtime, size: 1 };
    };
  }

  const asVault = {
    getAbstractFileByPath: (p: string) => files.get(p) ?? (folders.has(p) ? { path: p } : null),
    getFiles: () => [...files.values()],
    getAllLoadedFiles: () => [...files.values()],
    read: async (f: { path: string }) => bytes.get(f.path) ?? "",
    readBinary: async () => new ArrayBuffer(0),
    modify: async (f: { path: string }, c: string) => {
      writes.push(`modify:${f.path}`);
      bytes.set(f.path, c);
    },
    create: async (p: string, c: string) => {
      writes.push(`create:${p}`);
      bytes.set(p, c);
      const f = tfile(p, cachedMtime);
      files.set(p, f);
      return f;
    },
    createBinary: async (p: string) => {
      writes.push(`createBinary:${p}`);
      bytes.set(p, "<binary>");
    },
    createFolder: async (p: string) => {
      folders.add(p);
      return {};
    },
    adapter,
  };

  return {
    bytes,
    writes,
    conflictCopies: () => [...bytes.keys()].filter((p) => p.startsWith(`${CONFLICTS}/`)),
    survives: (marker: string) => [...bytes.values()].some((v) => v.includes(marker)),
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

export interface Peer {
  sync: SyncManager;
  vault: VaultDouble;
  manifest: ManifestManager;
  bg: BackgroundSync;
}

export interface Rig {
  relay: Awaited<ReturnType<typeof startRelay>>;
  room: { id: string; token: string };
  peers: Peer[];
  peer(opts: {
    clientId: string;
    role: "host" | "guest";
    files: Record<string, string>;
    cachedMtime?: number;
    diskMtime?: number;
    statThrows?: boolean;
    noStat?: boolean;
    lastSessionEndedAt?: number;
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
      const sync = newClient(relay.port, room, opts.clientId);
      const vault = makeVault(opts.files, {
        cachedMtime: opts.cachedMtime,
        diskMtime: opts.diskMtime,
        statThrows: opts.statThrows,
        noStat: opts.noStat,
      });
      const settings = settingsFor({
        role: opts.role,
        clientId: opts.clientId,
        roomId: room.id,
        lastSessionEndedAt: opts.lastSessionEndedAt ?? 0,
      });
      const manifest = new ManifestManager(vault.asVault, settings);
      await manifest.connect(sync);
      const bg = new BackgroundSync(vault.asVault, sync, manifest, fileOpsDouble());
      const peer: Peer = { sync, vault, manifest, bg };
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

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
