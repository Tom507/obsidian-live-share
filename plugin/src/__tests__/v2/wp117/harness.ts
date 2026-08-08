// WP117 (S122) — a THREE-PEER world for host-mediated guest canvas creation.
//
// WHAT IS REAL HERE, because the alternative has cost this project six work
// packages. Every one of these is the production object, driven end to end:
//
//   ├── `CanvasCreateCoordinator` and `decideCanvasCreate` — the feature.
//   ├── `CanvasSync.subscribe` — the real mint, the real bind, the real host
//   │      seed. The identity store is `createCanvasIdentityStore` over a real
//   │      `ManifestManager`.
//   ├── `ManifestManager` — real, one per peer, all three connected to ONE
//   │      shared `__manifest__` document over the relay below, so "the host
//   │      wrote the manifest and the guests read it" is a real replication.
//   ├── `mirrorSharedCanvases` + `decideCanvasMirror` — the pass that
//   │      materialises and (WP117) adopts.
//   ├── `attachCanvasPersistence` / `CanvasPersistence` — the single writer. A
//   │      file that appears in this world is produced by `serializeCanvas`, the
//   │      one definer, and never by a helper written for the test.
//   └── `decideSeed` / `explainSeed` — the residual's decision.
//
// WHAT IS A DOUBLE, stated rather than left to be discovered:
//
//   ├── THE RELAY (`DocRelay` below). It is a real Yjs exchange — every peer
//   │      holds its OWN `Y.Doc` and state moves between them as encoded
//   │      updates, never as a shared object reference — but the transport is
//   │      synchronous and lossless, and `waitForSync` is a function call rather
//   │      than a socket round trip. It reproduces the ONE property this package
//   │      turns on: a first subscriber is told `NO_PEERS`, because nobody else
//   │      holds the doc, and a later one is not.
//   ├── THE VAULT. A `Map<path, string>` with the `TFile` / adapter surface the
//   │      subjects reach. No Obsidian, no watcher, so a vault EVENT is never
//   │      raised here; `vault-events.ts`'s routing is out of this file's scope
//   │      and is covered by its own row in tp07.
//   ├── THE CONTROL CHANNEL. A broadcast bus with the relay's own semantics —
//   │      every peer but the sender receives every frame — delivered on a
//   │      microtask. No encryption, no rate limit, no `ALLOWED_TYPES`.
//   └── THE SIDECAR. Absent (`sidecar: null`), so `sidecarKnowsDoc` is false
//          throughout. That is the arm the residual lives on and is deliberate.

import { TFile } from "obsidian";
import { vi } from "vitest";
import * as Y from "yjs";

import { CanvasCreateCoordinator, type CanvasCreateEnv } from "../../../files/canvas-create";
import { type CanvasMirrorReport, mirrorSharedCanvases } from "../../../files/canvas-mirror";
import {
  type CanvasPersistence,
  attachCanvasPersistence,
} from "../../../files/canvas-persistence";
import {
  CanvasSync,
  canvasDocId,
  createCanvasIdentityStore,
  parseCanvasReport,
} from "../../../files/canvas-sync";
import { ManifestManager } from "../../../files/manifest";
import { isProtectedPath } from "../../../files/protected-paths";
import { isPathSafe, toCanonicalPath } from "../../../utils";

export const SHARED = "_liveshare-test";
export const MANIFEST_DOC = "__manifest__";

export function canvasPath(name: string): string {
  return `${SHARED}/${name}.canvas`;
}

// --- record fixtures ---------------------------------------------------------
// Complete, legal JSON Canvas records: a shorthand node is refused at both seed
// boundaries by C18 AC1, and a test built on one fails on its scenery.

export function textNode(id: string, x: number, text: string): Record<string, unknown> {
  return { id, type: "text", x, y: 0, width: 200, height: 100, text };
}

export function edge(id: string, from: string, to: string): Record<string, unknown> {
  return { id, fromNode: from, fromSide: "right", toNode: to, toSide: "left" };
}

export function canvasJson(
  nodes: Record<string, unknown>[],
  edges: Record<string, unknown>[] = [],
): string {
  return JSON.stringify({ nodes, edges });
}

/**
 * Let everything in flight finish.
 *
 * A MICROTASK DRAIN IS NOT ENOUGH HERE, and finding that out cost an hour:
 * `ManifestManager.updateFile` hashes through `crypto.subtle.digest`, whose
 * promise settles on a MACROTASK. A `for (…) await Promise.resolve()` loop never
 * yields to that queue, so the whole materialisation sat unfinished and the
 * counters read exactly as they would have if the host had never acted — the
 * `S155` ambiguity, manufactured by the harness instead of by the product.
 */
export async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    for (let j = 0; j < 20; j++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

// ---------------------------------------------------------------------------
// THE RELAY. One authoritative replica per doc id, plus one LOCAL replica per
// peer per doc id. State moves as encoded Yjs updates in both directions.
//
// `getDoc` deliberately does NOT pull. In the product a `getDoc` creates or
// returns a document and the SYNC STEP is what fills it, which is exactly what
// makes `peerKnowsDoc` ("did this replica gain state across `waitForSync`")
// measurable at all. Pulling at attach time would make that delta zero for every
// doc and silently disarm the condition the residual turns on.
// ---------------------------------------------------------------------------

const FROM_RELAY = Symbol("relay");

interface LocalReplica {
  peer: string;
  doc: Y.Doc;
  synced: boolean;
}

export const SYNC_OUTCOME = {
  NO_PEERS: "no-peers",
  PEER_STATE: "peer-state",
} as const;

export class DocRelay {
  private readonly authoritative = new Map<string, Y.Doc>();
  private readonly replicas = new Map<string, LocalReplica[]>();
  /** Every `waitForSync` this relay answered, and what it answered. */
  readonly resolutions: Array<{ peer: string; docId: string; outcome: string }> = [];

  private relayDoc(docId: string): Y.Doc {
    let doc = this.authoritative.get(docId);
    if (!doc) {
      doc = new Y.Doc();
      this.authoritative.set(docId, doc);
      doc.on("update", (update: Uint8Array, origin: unknown) => {
        for (const replica of this.replicas.get(docId) ?? []) {
          if (!replica.synced) continue;
          if (origin === replica.peer) continue;
          Y.applyUpdate(replica.doc, update, FROM_RELAY);
        }
      });
    }
    return doc;
  }

  attach(peer: string, docId: string): Y.Doc {
    const existing = (this.replicas.get(docId) ?? []).find((r) => r.peer === peer);
    if (existing) return existing.doc;
    const relay = this.relayDoc(docId);
    const doc = new Y.Doc();
    const replica: LocalReplica = { peer, doc, synced: false };
    doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === FROM_RELAY) return;
      Y.applyUpdate(relay, update, peer);
    });
    const list = this.replicas.get(docId);
    if (list) list.push(replica);
    else this.replicas.set(docId, [replica]);
    void relay;
    return doc;
  }

  /**
   * The SYNC STEP. Returns the same two facts `SyncManager.getSyncResolution`
   * reports, decided by the same rule: `peerCount === 0` means nobody else holds
   * this doc, so an empty document here means NEW and not "empty on the other
   * side".
   */
  syncStep(peer: string, docId: string): string {
    const list = this.replicas.get(docId) ?? [];
    const replica = list.find((r) => r.peer === peer);
    if (!replica) return SYNC_OUTCOME.NO_PEERS;
    const others = list.filter((r) => r.peer !== peer && r.synced);
    const relay = this.relayDoc(docId);
    Y.applyUpdate(replica.doc, Y.encodeStateAsUpdate(relay), FROM_RELAY);
    replica.synced = true;
    Y.applyUpdate(relay, Y.encodeStateAsUpdate(replica.doc), peer);
    const outcome = others.length === 0 ? SYNC_OUTCOME.NO_PEERS : SYNC_OUTCOME.PEER_STATE;
    this.resolutions.push({ peer, docId, outcome });
    return outcome;
  }

  /** How many peers have completed a sync for this doc. A read, for assertions. */
  syncedPeerCount(docId: string): number {
    return (this.replicas.get(docId) ?? []).filter((r) => r.synced).length;
  }
}

// ---------------------------------------------------------------------------
// THE CONTROL BUS. Broadcast, exactly like the relay: every peer but the sender
// receives every frame.
// ---------------------------------------------------------------------------

export class ControlBus {
  private readonly handlers = new Map<string, (msg: Record<string, unknown>) => void>();
  /** Every frame that went on the wire, in order. Never mutated by a reader. */
  readonly frames: Array<{ from: string; message: Record<string, unknown> }> = [];
  /** Set to drop frames of a given type, to model an old relay or peer. */
  readonly dropped = new Set<string>();

  register(peer: string, handler: (msg: Record<string, unknown>) => void): void {
    this.handlers.set(peer, handler);
  }

  send(from: string, message: Record<string, unknown>): boolean {
    this.frames.push({ from, message: { ...message } });
    if (this.dropped.has(String(message.type))) return true;
    for (const [peer, handler] of this.handlers) {
      if (peer === from) continue;
      const copy = JSON.parse(JSON.stringify(message)) as Record<string, unknown>;
      void Promise.resolve().then(() => handler(copy));
    }
    return true;
  }

  framesOfType(type: string): Array<Record<string, unknown>> {
    return this.frames.filter((f) => f.message.type === type).map((f) => f.message);
  }
}

// --- the vault double --------------------------------------------------------

export interface FakeVault {
  files: Map<string, string>;
  read(file: { path: string }): Promise<string>;
  modify(file: { path: string }, content: string): Promise<void>;
  create(path: string, content: string): Promise<unknown>;
  getFiles(): unknown[];
  createFolder(path: string): Promise<unknown>;
  getAllLoadedFiles(): unknown[];
  getAbstractFileByPath(path: string): unknown;
  adapter: {
    read(p: string): Promise<string>;
    write(p: string, c: string): Promise<void>;
    exists(p: string): Promise<boolean>;
  };
}

export function createVault(initial: Record<string, string> = {}): FakeVault {
  const files = new Map<string, string>(Object.entries(initial));
  const fileFor = (path: string): TFile => {
    const f = new TFile();
    f.path = path;
    // `updateFile` reads `file.stat.mtime`; a real `TFile` always has one.
    (f as unknown as { stat: { mtime: number; size: number } }).stat = {
      mtime: 1,
      size: files.get(path)?.length ?? 0,
    };
    return f;
  };
  return {
    files,
    read: vi.fn(async (file: { path: string }) => files.get(file.path) ?? ""),
    modify: vi.fn(async (file: { path: string }, content: string) => {
      files.set(file.path, content);
    }),
    create: vi.fn(async (path: string, content: string) => {
      if (files.has(path)) throw new Error(`already exists: ${path}`);
      files.set(path, content);
      return fileFor(path);
    }),
    getFiles: vi.fn(() => [...files.keys()].map(fileFor)),
    createFolder: vi.fn(async () => ({})),
    getAllLoadedFiles: vi.fn(() => []),
    getAbstractFileByPath: vi.fn((path: string) => (files.has(path) ? fileFor(path) : null)),
    adapter: {
      read: vi.fn(async (p: string) => {
        const found = files.get(p);
        if (found === undefined) throw new Error(`ENOENT: ${p}`);
        return found;
      }),
      write: vi.fn(async (p: string, c: string) => {
        files.set(p, c);
      }),
      exists: vi.fn(async (p: string) => files.has(p)),
    },
  };
}

export function createFileOps() {
  const muted = new Set<string>();
  return {
    muted,
    mutePathEvents: vi.fn((p: string) => {
      muted.add(p);
    }),
    unmutePathEvents: vi.fn((p: string) => {
      muted.delete(p);
    }),
    isPathMuted: vi.fn((p: string) => muted.has(p)),
    armMuteRelease: vi.fn(),
  };
}

// --- a manual scheduler, so a timer is a countable object -------------------

export interface ManualScheduler {
  now(): number;
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  pending(): number;
  runAll(): void;
}

export function createManualScheduler(): ManualScheduler {
  let clock = 0;
  let nextId = 1;
  const timers = new Map<number, () => void>();
  return {
    now: () => clock++,
    setTimeout(cb: () => void) {
      const id = nextId++;
      timers.set(id, cb);
      return id;
    },
    clearTimeout(handle: unknown) {
      timers.delete(handle as number);
    },
    pending: () => timers.size,
    runAll() {
      for (const [id, cb] of [...timers]) {
        timers.delete(id);
        cb();
      }
    },
  };
}

// --- a persistence IO over the peer's own disk ------------------------------

export function createPersistenceIO(files: Map<string, string>) {
  const writes: string[] = [];
  return {
    writes,
    async read(path: string) {
      return files.get(path) ?? "";
    },
    async write(path: string, content: string) {
      writes.push(path);
      files.set(path, content);
    },
    async exists(path: string) {
      return files.has(path);
    },
    mutePathEvents: vi.fn(),
    unmutePathEvents: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// A PEER.
// ---------------------------------------------------------------------------

export interface PeerOptions {
  id: string;
  role: "host" | "guest";
  files?: Record<string, string>;
  sharedFolder?: string;
  maxBytes?: number;
  timeoutMs?: number;
  /**
   * WP117's repair, at the ONE line that carries it.
   *
   * `true` (default) reproduces the production writer attach: the live session
   * role is stamped over whatever `subscribe` recorded. `false` reproduces the
   * PRE-WP117 line byte for byte — `seedKnowledge: seedKnowledgeFor(path)` and
   * nothing else — which is the control arm the residual is demonstrated
   * against. It changes exactly one field of one object and nothing else in the
   * world.
   */
  stampSeedRole?: boolean;
}

export interface Peer {
  id: string;
  role: "host" | "guest";
  vault: FakeVault;
  files: Map<string, string>;
  manifest: ManifestManager;
  canvasSync: CanvasSync;
  coordinator: CanvasCreateCoordinator;
  scheduler: ManualScheduler;
  notices: string[];
  writers: Map<string, CanvasPersistence>;
  lastMirror: CanvasMirrorReport | null;
  /** Run one real mirror pass, with the real writer attach as `materialise`. */
  mirror(): Promise<CanvasMirrorReport>;
  /**
   * The ordinary "this peer opens the canvas" gesture: the REAL
   * `CanvasSync.subscribe` followed by the REAL writer attach, in the order
   * `main.ts` performs them.
   */
  subscribe(path: string): Promise<void>;
  /** This peer's own disk, byte for byte. `undefined` when the file is absent. */
  disk(path: string): string | undefined;
  /** The doc this peer holds for a path, or `null`. */
  docFor(path: string): Y.Doc | null;
  destroy(): void;
}

export interface World {
  relay: DocRelay;
  bus: ControlBus;
  peers: Map<string, Peer>;
  peer(id: string): Peer;
  add(options: PeerOptions): Promise<Peer>;
  settle(): Promise<void>;
}

export async function createWorld(): Promise<World> {
  const relay = new DocRelay();
  const bus = new ControlBus();
  const peers = new Map<string, Peer>();

  const world: World = {
    relay,
    bus,
    peers,
    peer: (id: string) => {
      const found = peers.get(id);
      if (!found) throw new Error(`no peer ${id}`);
      return found;
    },
    add: async (options: PeerOptions) => {
      const peer = await createPeer(relay, bus, options);
      peers.set(options.id, peer);
      return peer;
    },
    settle,
  };
  return world;
}

async function createPeer(
  relay: DocRelay,
  bus: ControlBus,
  options: PeerOptions,
): Promise<Peer> {
  const { id, role } = options;
  const vault = createVault(options.files ?? {});
  const files = vault.files;
  const scheduler = createManualScheduler();
  const notices: string[] = [];
  const writers = new Map<string, CanvasPersistence>();

  const handles = new Map<string, { doc: Y.Doc; text: Y.Text; awareness: unknown }>();
  const syncManager = {
    getDoc(docId: string) {
      let handle = handles.get(docId);
      if (!handle) {
        const doc = relay.attach(id, docId);
        handle = { doc, text: doc.getText("content"), awareness: {} };
        handles.set(docId, handle);
      }
      return handle;
    },
    releaseDoc(_docId: string) {
      // The relay keeps the replica: a released doc that is re-subscribed in the
      // same session is a resume, not a fresh peer.
    },
    async waitForSync(docId: string) {
      // Asynchronous on purpose: the state-vector delta `subscribe` measures is
      // taken ACROSS this await, so a synchronous return would make the whole
      // measurement vacuous.
      await Promise.resolve();
      return relay.syncStep(id, docId);
    },
    getSyncResolution(docId: string) {
      const seen = relay.resolutions.filter((r) => r.peer === id && r.docId === docId);
      return seen.length > 0 ? seen[seen.length - 1].outcome : null;
    },
  };

  const settings = {
    role,
    sharedFolder: options.sharedFolder ?? SHARED,
  } as never;
  const manifest = new ManifestManager(vault as never, settings);
  await manifest.connect(syncManager as never);

  const canvasSync = new CanvasSync(vault as never, syncManager as never, createFileOps() as never);
  canvasSync.setIdentityStore(createCanvasIdentityStore({ manifest, sidecar: null }));

  // THE REAL WRITER ATTACH, one definition, used by BOTH the mirror pass's
  // `materialise` and the host's post-seed projection — exactly as `main.ts`
  // uses one `attachCanvasWriter` for both.
  const attachWriter = async (path: string): Promise<void> => {
    if (writers.has(path)) return;
    const handle = canvasSync.getCanvasDocHandle(path);
    if (!handle) return;
    const { persistence } = await attachCanvasPersistence(
      handle.doc,
      createPersistenceIO(files) as never,
      path,
      {
        scheduler: scheduler as never,
        seedRefusals: canvasSync.seedRefusalLedger(path),
        refusalIdentity: canvasSync.getCanvasGuid(path),
        // The production stamp, reproduced verbatim: the live session role over
        // whatever `subscribe` recorded. See `attachCanvasWriter` in `main.ts`.
        // `stampSeedRole: false` is the pre-WP117 line, for the control arm.
        seedKnowledge:
          options.stampSeedRole === false
            ? canvasSync.seedKnowledgeFor(path)
            : { ...canvasSync.seedKnowledgeFor(path), role },
      },
    );
    writers.set(path, persistence);
  };

  const env: CanvasCreateEnv = {
    role: () => role,
    send: (message) => bus.send(id, message as Record<string, unknown>),
    isSharedPath: (path) => manifest.isSharedPath(path),
    manifestKnows: (path) => manifest.getEntries().has(toCanonicalPath(path)),
    isPathSafe: (path) => isPathSafe(path),
    isProtectedPath: (path) => isProtectedPath(path),
    fileExists: async (path) => files.has(path),
    readFile: async (path) => files.get(path) ?? null,
    isCanvasDocument: (content) => parseCanvasReport(content).degraded === false,
    createFile: async (path, content) => {
      await vault.create(path, content);
    },
    publishManifestEntry: async (path, content) => {
      const file = vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) throw new Error(`not readable back at ${path}`);
      await manifest.updateFile(file, content);
    },
    canvasSync: () => canvasSync,
    attachWriter: async (path) => {
      await attachWriter(path);
    },
    identityFor: (path) => manifest.getCanvasGuid(path),
    notify: (message) => {
      notices.push(message);
    },
    newRequestId: () => `${id}-req-${bus.frames.length}-${Math.random().toString(16).slice(2)}`,
    scheduler,
    timeoutMs: options.timeoutMs,
    maxBytes: options.maxBytes,
  };
  const coordinator = new CanvasCreateCoordinator(env);

  bus.register(id, (message) => {
    if (message.type === "canvas-create-request") {
      void coordinator.handleRequest(message as never);
      return;
    }
    if (message.type === "canvas-create-result") {
      coordinator.handleResult(message as never);
    }
  });

  const peer: Peer = {
    id,
    role,
    vault,
    files,
    manifest,
    canvasSync,
    coordinator,
    scheduler,
    notices,
    writers,
    lastMirror: null,
    async mirror() {
      const report = await mirrorSharedCanvases({
        role,
        listManifestPaths: () => manifest.getEntries().keys(),
        localFileExists: async (path) => files.has(path),
        guidForPath: (path) => manifest.getCanvasGuid(path),
        canvasSync: canvasSync as never,
        materialise: attachWriter,
        originatedHere: (path) => coordinator.originatedHere(path),
        noteAdopted: (path) => coordinator.noteAdopted(path),
      });
      peer.lastMirror = report;
      return report;
    },
    async subscribe(path: string) {
      await canvasSync.subscribe(path, role);
      await attachWriter(path);
    },
    disk: (path: string) => files.get(path),
    docFor(path: string) {
      const guid = manifest.getCanvasGuid(path);
      if (!guid) return null;
      return syncManager.getDoc(canvasDocId(guid)).doc;
    },
    destroy() {
      for (const writer of writers.values()) writer.destroy();
      canvasSync.destroy();
      manifest.destroy();
    },
  };
  return peer;
}

// --- the WP116 oracle, fed from this world ----------------------------------

/** One peer's reading of one path, in the shape `judgeConvergence` takes. */
export async function readFile(peer: Peer, path: string) {
  const content = peer.disk(path);
  if (content === undefined) {
    return { peer: peer.id, file: { exists: false, sha256: "", size: 0, content: null } };
  }
  return {
    peer: peer.id,
    file: {
      exists: true,
      sha256: await sha256(content),
      size: content.length,
      content,
    },
  };
}

export async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
