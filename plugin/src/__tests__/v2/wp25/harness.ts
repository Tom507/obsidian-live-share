// WP25 — shared fixtures for the sidecar LIFECYCLE + COMPACTION suite.
//
// Three design choices carry this file, and all three exist because WP25's
// acceptance criteria are dominated by ORDER and by COUNT rather than by end
// state.
//
//   1. ONE SHARED TRACE. AC1 ("the sidecar is loaded BEFORE peer sync begins")
//      and AC4 ("`coldOpen` still runs after `waitForSync` and before
//      `start()`") are pure ordering claims: the end state is byte-identical
//      whichever order the steps happened in, so an end-state oracle cannot
//      fail. Every seam below therefore appends to ONE array, and the
//      assertions are about the sequence in it. The seams instrumented are all
//      things WP25 does not own — the sync manager, WP24's `SidecarIO`, the
//      persistence `PersistenceIO` — so the trace observes the wiring rather
//      than agreeing with it.
//
//   2. THE APPEND CHANNEL IS OBSERVED DIRECTLY. AC2's "exactly once" has two
//      failure directions, and one of them is INVISIBLE in the doc: Yjs applies
//      are idempotent, so a DUPLICATED update reconstructs the identical
//      document. Only the history file — the frame count — can see it. The IO
//      double therefore records each `append` call with its exact bytes.
//
//   3. THE STATE ORACLE IS THE PROJECTION, NOT THE BYTES. AC3 says a compaction
//      "never changes the doc's observable state". Raw `encodeStateAsUpdate`
//      bytes are NOT that: a compaction is expressly allowed (indeed required)
//      to change them. What must not change is what a peer, the file and the
//      view can see — `serializeCanvas(nodes, edges, deleted)` plus `meta` —
//      which is what {@link observableState} returns.
//
// The IO double is the real WP24 `SidecarIO` contract, so `index.json`, the
// frame log and the checkpoint are exercised through WP24's own store rather
// than through a second, agreeing re-implementation.

import { TFile } from "obsidian";
import { vi } from "vitest";
import * as Y from "yjs";

import { META_MAP_NAME } from "../../../canvas/canvas-schema";
import type { SidecarIO } from "../../../files/canvas-sidecar";
import { DELETED_MAP_NAME, serializeCanvas } from "../../../files/canvas-sync";
import { ManifestManager } from "../../../files/manifest";

export const CANVAS_PATH = "boards/board.canvas";
export const OTHER_PATH = "boards/second.canvas";
export const RENAMED_PATH = "boards/archive/plan.canvas";

/** A fixed guid. Fixture-supplied, never generated. */
export const FIXED_GUID = "0f2a9c6e1b4d47aa9d316c0e2f8b5a70";
export const OTHER_GUID = "b71e3d5482ca4f0eaa9d6134b0c7e259";

export const NODE_A = {
  id: "n-a",
  type: "text",
  x: 0,
  y: 0,
  width: 120,
  height: 60,
  text: "alpha",
};

export const NODE_B = {
  id: "n-b",
  type: "text",
  x: 400,
  y: 0,
  width: 120,
  height: 60,
  text: "beta",
};

export function canvasJson(
  nodes: Record<string, unknown>[],
  edges: Record<string, unknown>[] = [],
): string {
  return JSON.stringify({ nodes, edges });
}

// --- the shared ordering trace -----------------------------------------------

export type Trace = string[];

export function createTrace(): Trace {
  return [];
}

/** Index of the first entry matching `label`, or -1. */
export function at(trace: Trace, label: string): number {
  return trace.indexOf(label);
}

/** Index of the first entry whose text CONTAINS `fragment`, or -1. */
export function firstContaining(trace: Trace, fragment: string): number {
  return trace.findIndex((entry) => entry.includes(fragment));
}

/** Index of the LAST entry whose text contains `fragment`, or -1. */
export function lastContaining(trace: Trace, fragment: string): number {
  let found = -1;
  trace.forEach((entry, index) => {
    if (entry.includes(fragment)) found = index;
  });
  return found;
}

// --- the sync manager double -------------------------------------------------

export interface FakeDocHandle {
  doc: Y.Doc;
  text: Y.Text;
  awareness: unknown;
}

export interface FakeSyncManager {
  docs: Map<string, FakeDocHandle>;
  /** Every id ever passed to `getDoc`, in order, duplicates included. */
  requested: string[];
  /** Every id ever passed to `releaseDoc`. */
  released: string[];
  /** Every id ever passed to `waitForSync`. */
  synced: string[];
  getDoc(docId: string): FakeDocHandle;
  releaseDoc(docId: string): void;
  waitForSync(docId: string): Promise<void>;
}

/**
 * `waitForSync` is deliberately asynchronous over a real microtask AND traced at
 * both ends. AC1's claim is that the sidecar load has already FINISHED when peer
 * sync begins, so "load:end before waitForSync:start" is the pin — an
 * implementation that issues both concurrently satisfies a weaker
 * "load:start first" test by luck of scheduling and fails this one.
 */
export function createSyncManager(trace: Trace = []): FakeSyncManager {
  const docs = new Map<string, FakeDocHandle>();
  const requested: string[] = [];
  const released: string[] = [];
  const synced: string[] = [];
  return {
    docs,
    requested,
    released,
    synced,
    getDoc(docId: string) {
      requested.push(docId);
      trace.push(`sync:getDoc:${docId}`);
      let handle = docs.get(docId);
      if (!handle) {
        const doc = new Y.Doc();
        handle = { doc, text: doc.getText("content"), awareness: {} };
        docs.set(docId, handle);
      }
      return handle;
    },
    releaseDoc(docId: string) {
      released.push(docId);
      trace.push(`sync:releaseDoc:${docId}`);
    },
    async waitForSync(docId: string) {
      // FIXTURE FIX (WP25 impl, attempt 1): `synced` is documented as "every id
      // ever passed to `waitForSync`" and was declared but never written, so
      // every assertion that reads it (`toContain`, `toEqual([canvasDocId…])`)
      // was unsatisfiable by any implementation. No assertion was changed; the
      // channel the assertions already read is simply populated.
      synced.push(docId);
      trace.push(`sync:waitForSync:start:${docId}`);
      await Promise.resolve();
      trace.push(`sync:waitForSync:end:${docId}`);
    },
  };
}

// --- the sidecar IO double (WP24's own interface) ----------------------------

export interface AppendRecord {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface TracingSidecarIO extends SidecarIO {
  /** The disk, as bytes. */
  files: Map<string, Uint8Array>;
  dirs: Set<string>;
  /** Every `append`, in order, with a COPY of the bytes that were handed over. */
  appends: AppendRecord[];
  /** `${op}:${path}` for every call, in order. */
  ops: string[];
  /** Hold every future call of `op` open until the returned release runs. */
  block(op: string): () => void;
}

/**
 * Records into the SHARED trace with a `sidecar:` prefix, so the sidecar's
 * activity and the sync manager's interleave in one ordered list.
 *
 * `read` THROWS on a missing path, exactly as WP24's contract says a real one
 * must — a forgiving fake would hide a store that reads without an `exists`
 * guard.
 */
export function createSidecarIO(trace: Trace = []): TracingSidecarIO {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>();
  const appends: AppendRecord[] = [];
  const ops: string[] = [];
  const gates = new Map<string, Promise<void>>();

  async function run<T>(op: string, path: string, body: () => T): Promise<T> {
    ops.push(`${op}:${path}`);
    trace.push(`sidecar:${op}:start:${path}`);
    const gate = gates.get(op);
    if (gate) await gate;
    else await Promise.resolve();
    const out = body();
    trace.push(`sidecar:${op}:end:${path}`);
    return out;
  }

  return {
    files,
    dirs,
    appends,
    ops,
    block(op: string): () => void {
      let release = (): void => {};
      gates.set(
        op,
        new Promise<void>((resolve) => {
          release = () => {
            gates.delete(op);
            resolve();
          };
        }),
      );
      return () => release();
    },
    ensureDir: (dirPath: string) =>
      run("ensureDir", dirPath, () => {
        dirs.add(dirPath);
      }),
    exists: (filePath: string) => run("exists", filePath, () => files.has(filePath)),
    read: (filePath: string) =>
      run("read", filePath, () => {
        const found = files.get(filePath);
        if (found === undefined) throw new Error(`ENOENT: ${filePath}`);
        return Uint8Array.from(found);
      }),
    write: (filePath: string, data: Uint8Array) =>
      run("write", filePath, () => {
        files.set(filePath, Uint8Array.from(data));
      }),
    append: (filePath: string, data: Uint8Array) =>
      run("append", filePath, () => {
        appends.push({ path: filePath, bytes: Uint8Array.from(data) });
        const prev = files.get(filePath) ?? new Uint8Array(0);
        const next = new Uint8Array(prev.length + data.length);
        next.set(prev, 0);
        next.set(data, prev.length);
        files.set(filePath, next);
      }),
    truncate: (filePath: string) =>
      run("truncate", filePath, () => {
        files.set(filePath, new Uint8Array(0));
      }),
    remove: (filePath: string) =>
      run("remove", filePath, () => {
        files.delete(filePath);
      }),
  };
}

// --- the on-disk frame format, decoded INDEPENDENTLY of the module -----------
// WP24 charter §7 pins `frame := u32BE payloadLength || payload`. This is the
// test side's own reader, so a store that invents a different framing goes red
// instead of agreeing with itself.

export function readFrames(history: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let at = 0;
  while (at < history.length) {
    if (at + 4 > history.length) throw new Error(`incomplete frame header at ${at}`);
    const n =
      ((history[at] << 24) >>> 0) +
      (history[at + 1] << 16) +
      (history[at + 2] << 8) +
      history[at + 3];
    if (at + 4 + n > history.length) throw new Error(`incomplete frame payload at ${at}`);
    out.push(history.slice(at + 4, at + 4 + n));
    at += 4 + n;
  }
  return out;
}

// --- byte helpers ------------------------------------------------------------

export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

/** Naive substring search over bytes. Used for the Yjs-GC oracle. */
export function bytesContain(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0) return true;
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

/** True iff ANY sidecar file on this fake disk still carries `needle`. */
export function anySidecarFileContains(io: TracingSidecarIO, needle: string): boolean {
  const bytes = utf8(needle);
  for (const contents of io.files.values()) {
    if (bytesContain(contents, bytes)) return true;
  }
  return false;
}

// --- the observable-state oracle ---------------------------------------------

export interface ObservableState {
  /** What the `.canvas` file and the live view see. */
  canvas: string;
  /** What a peer reads out of `meta`. */
  meta: Record<string, unknown>;
  /** The visible key sets, so a record vanishing without its tombstone shows. */
  nodeIds: string[];
  edgeIds: string[];
}

/**
 * OBSERVABLE state — deliberately NOT `encodeStateAsUpdate` bytes.
 *
 * A compaction is REQUIRED to change the encoded bytes (that is what compacting
 * is). What AC3 forbids it to change is what anyone can see: the projection the
 * file, the peers and the view are built from. Comparing the bytes instead would
 * produce an assertion no correct implementation can satisfy — the class this
 * project has already been bitten by.
 */
export function observableState(doc: Y.Doc): ObservableState {
  const nodes = doc.getMap<Y.Map<unknown>>("nodes");
  const edges = doc.getMap<Y.Map<unknown>>("edges");
  const deleted = doc.getMap<unknown>(DELETED_MAP_NAME);
  const projection = JSON.parse(serializeCanvas(nodes, edges, deleted)) as {
    nodes: Record<string, unknown>[];
    edges: Record<string, unknown>[];
  };
  return {
    canvas: serializeCanvas(nodes, edges, deleted),
    meta: doc.getMap<unknown>(META_MAP_NAME).toJSON() as Record<string, unknown>,
    nodeIds: projection.nodes.map((n) => String(n.id)),
    edgeIds: projection.edges.map((e) => String(e.id)),
  };
}

// --- doc fixtures ------------------------------------------------------------

/** Write a record into `nodes` / `edges` the way the seed paths do. */
export function seedRecord(
  doc: Y.Doc,
  kind: "nodes" | "edges",
  record: Record<string, unknown>,
): void {
  doc.transact(() => {
    const container = doc.getMap<Y.Map<unknown>>(kind);
    const entry = new Y.Map<unknown>();
    container.set(String(record.id), entry);
    for (const [key, value] of Object.entries(record)) entry.set(key, value);
  });
}

/** Write a raw tombstone entry. `t` is a LAMPORT stamp, never a wall clock. */
export function writeTombstone(
  doc: Y.Doc,
  id: string,
  entry: { t: number; by: string; on: boolean; q?: boolean },
): void {
  doc.transact(() => {
    doc.getMap<unknown>(DELETED_MAP_NAME).set(id, { ...entry });
  });
}

/**
 * Apply a delta the way a PEER would — through a second doc and a real update —
 * so the receiving doc sees a NON-local transaction.
 */
export function applyRemoteDelta(doc: Y.Doc, build: (peer: Y.Doc) => void): void {
  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  build(remote);
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote));
  remote.destroy();
}

// --- the vault double --------------------------------------------------------

export interface FakeVault {
  files: Map<string, string>;
  read: (file: { path: string }) => Promise<string>;
  modify: (file: { path: string }, content: string) => Promise<void>;
  create: (path: string, content: string) => Promise<unknown>;
  getFiles: () => unknown[];
  createFolder: (path: string) => Promise<unknown>;
  getAllLoadedFiles: () => unknown[];
  getAbstractFileByPath: (path: string) => unknown;
  adapter: { write: (p: string, c: string) => Promise<void> };
}

export function createVault(initial: Record<string, string> = {}): FakeVault {
  const files = new Map<string, string>(Object.entries(initial));
  return {
    files,
    read: vi.fn(async (file: { path: string }) => files.get(file.path) ?? ""),
    modify: vi.fn(async (file: { path: string }, content: string) => {
      files.set(file.path, content);
    }),
    create: vi.fn(async (path: string, content: string) => {
      files.set(path, content);
      return {};
    }),
    getFiles: vi.fn(() => []),
    createFolder: vi.fn(async () => ({})),
    getAllLoadedFiles: vi.fn(() => []),
    getAbstractFileByPath: vi.fn((path: string) => {
      if (!files.has(path)) return null;
      const f = new TFile();
      f.path = path;
      return f;
    }),
    adapter: {
      write: vi.fn(async (p: string, c: string) => {
        files.set(p, c);
      }),
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
  };
}

/**
 * A live `ManifestManager` on a real `Y.Map`. `sharedFolder: ""` makes every
 * path shared, so `isSharedPath` never silently swallows a fixture.
 */
export async function createManifest(
  vault: FakeVault,
  sync: FakeSyncManager,
): Promise<ManifestManager> {
  const manifest = new ManifestManager(vault as never, { sharedFolder: "" } as never);
  // FIXTURE FIX (WP25 impl, attempt 1): `ManifestManager.connect` awaits
  // `waitForSync("__manifest__")`. That call is SETUP NOISE — it happens while
  // the fixture is being built, long before the subscribe under test — but it
  // was landing in the shared trace and in `synced`, so
  // `firstContaining(trace, "sync:waitForSync:start:")` resolved to the
  // MANIFEST's sync at index ~1 and every canvas-scoped ordering assertion
  // ("the sidecar load finishes before peer sync begins") compared against the
  // wrong event and could not pass for any implementation. The doc is still
  // acquired through the real fake (so `docs` / `requested` are unchanged); only
  // the manifest's own sync wait is kept out of the two ordering channels.
  await manifest.connect({ ...sync, waitForSync: async () => {} } as never);
  return manifest;
}

// --- the Obsidian DataAdapter double (for `createVaultSidecarIO`) ------------

export interface FakeDataAdapter {
  /** Binary vault contents, keyed by path. */
  bin: Map<string, Uint8Array>;
  dirs: Set<string>;
  calls: string[];
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  readBinary(path: string): Promise<ArrayBuffer>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  remove(path: string): Promise<void>;
}

/**
 * Obsidian's `DataAdapter.append(path, data)` takes a STRING. A sidecar frame
 * log is binary and contains bytes that are not valid UTF-8, so an adapter that
 * routes `append` through the string API destroys the log silently — the frames
 * still "look" like frames and the length header still parses, but the payload
 * is mangled. This double therefore exposes NO string surface at all: the only
 * way to write is `writeBinary`, and the only way to grow a file is
 * read-modify-write. An implementation that reaches for a string API cannot even
 * compile against it.
 */
export function createDataAdapter(): FakeDataAdapter {
  const bin = new Map<string, Uint8Array>();
  const dirs = new Set<string>();
  const calls: string[] = [];
  return {
    bin,
    dirs,
    calls,
    async exists(path: string) {
      calls.push(`exists:${path}`);
      return bin.has(path) || dirs.has(path);
    },
    async mkdir(path: string) {
      calls.push(`mkdir:${path}`);
      dirs.add(path);
    },
    async readBinary(path: string) {
      calls.push(`readBinary:${path}`);
      const found = bin.get(path);
      if (found === undefined) throw new Error(`ENOENT: ${path}`);
      return found.buffer.slice(
        found.byteOffset,
        found.byteOffset + found.byteLength,
      ) as ArrayBuffer;
    },
    async writeBinary(path: string, data: ArrayBuffer) {
      calls.push(`writeBinary:${path}`);
      bin.set(path, new Uint8Array(data.slice(0)));
    },
    async remove(path: string) {
      calls.push(`remove:${path}`);
      bin.delete(path);
    },
  };
}

// --- a manual scheduler for `CanvasPersistence` ------------------------------

export interface ManualScheduler {
  now(): number;
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  /** Timers that have been armed and not yet fired or cancelled. */
  pending(): number;
  /** Fire every pending timer, oldest first. */
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
