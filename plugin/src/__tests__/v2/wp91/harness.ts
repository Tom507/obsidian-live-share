// WP91 / C91 — shared fixtures for "a mute that cannot tell who wrote is not an
// echo breaker".
//
// THE FIXTURE IS THE ARGUMENT HERE, so it is worth stating what it refuses to
// fake.
//
//   ├── the MUTE is the REAL `FileOpsManager` refcount. `file-ops.ts` is out of
//   │   this work package's scope as an EDIT target; it is imported here on
//   │   purpose, because the whole claim is that a real user save survives a
//   │   real mute. A `vi.fn()` double would let the tests pass against a mute
//   │   that never counted anything.
//   ├── the ROUTER is the REAL `registerVaultEvents` dispatcher, and every
//   │   modify in these files is delivered through the handler it registered on
//   │   `vault.on("modify")`. The charter names the alternative as the killer
//   │   vacuity: a test that calls `canvasSync.handleLocalModify(path)` directly
//   │   bypasses the gate that IS the defect and is green on an untouched tree.
//   ├── the WRITER is the REAL `CanvasPersistence`, wired to `CanvasSync` through
//   │   the same `onWritten -> noteExternalDiskWrite` edge production uses
//   │   (`main.ts`), because that one edge is what arms BOTH re-arming settle
//   │   windows (S68) and both are in scope.
//   └── the DISK is one `files` map shared by the writer, the vault reader and
//       the test. What `CanvasPersistence` puts there is what a `modify` event
//       later reads back — the bytes are never re-serialised on the way.
//
// ONE CLOCK. `vi.useFakeTimers()` governs everything: `CanvasPersistence` is left
// on its default scheduler, which routes to the globals precisely so fake timers
// intercept it, and `CanvasSync`'s own settle timers are plain `setTimeout` +
// `Date.now()`. A second, independent test clock would make the two windows'
// intervals incomparable, and comparing them is AC5.

import { TFile } from "obsidian";
import { vi } from "vitest";
import * as Y from "yjs";

import type { SurfaceState } from "../../../canvas/canvas-shadow";
import { CanvasPersistence, type PersistenceIO } from "../../../files/canvas-persistence";
import { CanvasSync } from "../../../files/canvas-sync";
import { FileOpsManager } from "../../../files/file-ops";
import { registerVaultEvents } from "../../../files/vault-events";

export const PATH = "shared/board.canvas";

/** A `.canvas` body in the shape the capture path parses. */
export function canvasJson(
  nodes: Record<string, unknown>[],
  edges: Record<string, unknown>[] = [],
): string {
  return JSON.stringify({ nodes, edges });
}

export function node(id: string, text: string, x = 10): Record<string, unknown> {
  return { id, type: "text", x, y: 20, width: 240, height: 60, text };
}

export function mockFile(path: string): TFile {
  const file = Object.create(TFile.prototype) as TFile;
  (file as { path: string }).path = path;
  (file as { stat: unknown }).stat = { size: 0, mtime: 0, ctime: 0 };
  return file;
}

/** One recorded `mutePathEvents` / `unmutePathEvents` call, stamped on the clock
 * both settle windows are measured against. AC5's observable is this sequence —
 * never a constant read back out of the module that defines it. */
export interface MuteEvent {
  kind: "mute" | "unmute";
  at: number;
  path: string;
}

export interface Rig {
  files: Map<string, string>;
  vault: unknown;
  fileOps: FileOpsManager;
  canvasSync: CanvasSync;
  persistence: CanvasPersistence;
  doc: Y.Doc;
  /** Every debug/warn line the plugin emitted, newest last. */
  logs: string[];
  /** Every mute/unmute the writer took, in order, stamped. */
  muteLog: MuteEvent[];
  /** Exactly the bytes `onWritten` reported, in order. Replayed verbatim by the
   * echo rows — re-serialising instead would test the serialiser, not the
   * breaker, and would hide precisely the drift that disarms it. */
  written: string[];
  surface: SurfaceState;
  settings: { role: "host" | "guest"; useCanvasBinding: boolean };
  /** Deliver a vault event through the REAL registered handler. */
  emitModify(path: string): void;
  emitCreate(path: string): void;
  emitDelete(path: string): void;
  emitRename(path: string, oldPath: string): void;
  handleLocalTextModify: ReturnType<typeof vi.fn>;
  onFileCreate: ReturnType<typeof vi.fn>;
  onFileDelete: ReturnType<typeof vi.fn>;
  onFileRename: ReturnType<typeof vi.fn>;
  manifestUpdateFile: ReturnType<typeof vi.fn>;
  bgRecentDiskWrite: Set<string>;
  /** `null` makes `syncManager.getDoc` answer nothing — AC3's `no-doc` fixture. */
  docHandleEnabled: { value: boolean };
  destroy(): void;
}

export interface RigOpts {
  /** Initial disk contents. */
  initial?: Record<string, string>;
  /** WP91 AC5 control: `Number.POSITIVE_INFINITY` restores the unbounded re-arm. */
  maxMuteMs?: number;
  /** Skip `CanvasSync.subscribe`, so the path is not canvas-owned. */
  subscribe?: boolean;
}

export async function createRig(opts: RigOpts = {}): Promise<Rig> {
  const files = new Map<string, string>(Object.entries(opts.initial ?? {}));
  const logs: string[] = [];
  const muteLog: MuteEvent[] = [];
  const written: string[] = [];
  const bgRecentDiskWrite = new Set<string>();
  const docHandleEnabled = { value: true };
  const settings = { role: "host" as const, useCanvasBinding: false };

  const vault = {
    read: vi.fn(async (file: { path: string }) => files.get(file.path) ?? ""),
    readBinary: vi.fn(async () => new ArrayBuffer(0)),
    modify: vi.fn(async () => {}),
    create: vi.fn(async () => ({})),
    delete: vi.fn(async () => {}),
    trash: vi.fn(async () => {}),
    createFolder: vi.fn(async () => ({})),
    getFiles: vi.fn(() => []),
    getAbstractFileByPath: vi.fn((p: string) => (files.has(p) ? mockFile(p) : null)),
    adapter: {
      read: vi.fn(async (p: string) => files.get(p) ?? ""),
      write: vi.fn(async (p: string, c: string) => {
        files.set(p, c);
      }),
      exists: vi.fn(async (p: string) => files.has(p)),
    },
  };

  const docs = new Map<string, { doc: Y.Doc; text: Y.Text; awareness: unknown }>();
  const syncManager = {
    docs,
    getDoc(docId: string) {
      if (!docHandleEnabled.value) return null;
      if (!docs.has(docId)) {
        const doc = new Y.Doc();
        docs.set(docId, { doc, text: doc.getText("content"), awareness: {} });
      }
      return docs.get(docId);
    },
    releaseDoc: vi.fn(),
    waitForSync: vi.fn(async () => {}),
  };

  // THE REAL REFCOUNT. Constructed, not doubled — see the header.
  const fileOps = new FileOpsManager(vault as never, {} as never);

  const canvasSync = new CanvasSync(vault as never, syncManager as never, fileOps as never);
  canvasSync.setLogger({
    debug: (_c: string, m: string) => logs.push(m),
    warn: (_c: string, m: string) => logs.push(m),
  });
  const surface: SurfaceState = {
    viewOpen: false,
    handedToView: { node: new Set<string>(), edge: new Set<string>() },
  };
  canvasSync.setSurfaceStateProvider(() => surface);
  if (opts.subscribe !== false) await canvasSync.subscribe(PATH, "host");

  const doc = (syncManager.getDoc(`__canvas__:${PATH}`) as { doc: Y.Doc }).doc;

  const io: PersistenceIO = {
    read: async (p) => files.get(p) ?? "",
    write: async (p, c) => {
      files.set(p, c);
    },
    exists: async (p) => files.has(p),
    mutePathEvents: (p) => {
      muteLog.push({ kind: "mute", at: Date.now(), path: p });
      fileOps.mutePathEvents(p);
    },
    unmutePathEvents: (p) => {
      muteLog.push({ kind: "unmute", at: Date.now(), path: p });
      fileOps.unmutePathEvents(p);
    },
  };

  const persistence = new CanvasPersistence(doc, io, PATH, {
    logger: { debug: (_c, m) => logs.push(m), warn: (_c, m) => logs.push(m) },
    // The production edge (`main.ts`): one landed write feeds the sync layer's
    // baseline AND arms its own settle window. Both re-arming windows hang off
    // this single call, which is why S68 exists.
    onWritten: (content) => {
      written.push(content);
      canvasSync.noteExternalDiskWrite(PATH, content);
    },
    ...(opts.maxMuteMs === undefined ? {} : { maxMuteMs: opts.maxMuteMs }),
  });
  persistence.start();

  const handlers = new Map<string, (...args: unknown[]) => void>();
  const handleLocalTextModify = vi.fn(async () => {});
  const onFileCreate = vi.fn();
  const onFileDelete = vi.fn();
  const onFileRename = vi.fn();
  const manifestUpdateFile = vi.fn(async () => {});

  const plugin = {
    registerEvent: vi.fn(),
    app: {
      vault: {
        on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
          handlers.set(event, cb);
          return { event };
        }),
        read: vault.read,
        readBinary: vault.readBinary,
      },
      workspace: { on: vi.fn(() => ({})), getActiveViewOfType: vi.fn(() => null) },
    },
    settings,
    logger: {
      debug: (_c: string, m: string) => logs.push(m),
      warn: (_c: string, m: string) => logs.push(m),
      log: vi.fn(),
      error: vi.fn(),
    },
    manifestManager: {
      isSharedPath: vi.fn(() => true),
      updateFile: manifestUpdateFile,
      removeFile: vi.fn(),
      addFolder: vi.fn(),
      renameFile: vi.fn(),
    },
    // The REAL refcount answers the router's mute question, and the router's
    // other consumers (create/delete/rename, the text arm) still ask it.
    fileOpsManager: {
      isPathMuted: (p: string) => fileOps.isPathMuted(p),
      // S120 — the kind-aware gate, delegated to the SAME real manager, so the
      // "real refcount answers the router's mute question" property above is
      // preserved rather than replaced by a stub with its own opinion.
      isPathMutedFor: (p: string, kind: Parameters<typeof fileOps.isPathMutedFor>[1]) =>
        fileOps.isPathMutedFor(p, kind),
      noteMuteDrop: (kind: Parameters<typeof fileOps.noteMuteDrop>[0]) =>
        fileOps.noteMuteDrop(kind),
      onFileModify: vi.fn(),
      onFileCreate,
      onFileDelete,
      onFileRename,
    },
    backgroundSync: {
      isRecentDiskWrite: (p: string) => bgRecentDiskWrite.has(p),
      handleLocalTextModify,
      subscribe: vi.fn(async () => {}),
      unsubscribe: vi.fn(),
      onFileAdded: vi.fn(async () => {}),
      onFileRemoved: vi.fn(),
      onFileRenamed: vi.fn(async () => {}),
      cancelSubscribe: vi.fn(),
    },
    canvasSync,
    presenceManager: undefined,
    onActiveFileChange: vi.fn(),
  };
  registerVaultEvents(plugin as never);

  return {
    files,
    vault,
    fileOps,
    canvasSync,
    persistence,
    doc,
    logs,
    muteLog,
    written,
    surface,
    settings,
    emitModify: (p: string) => handlers.get("modify")?.(mockFile(p)),
    emitCreate: (p: string) => handlers.get("create")?.(mockFile(p)),
    emitDelete: (p: string) => handlers.get("delete")?.(mockFile(p)),
    emitRename: (p: string, oldPath: string) => handlers.get("rename")?.(mockFile(p), oldPath),
    handleLocalTextModify,
    onFileCreate,
    onFileDelete,
    onFileRename,
    manifestUpdateFile,
    bgRecentDiskWrite,
    docHandleEnabled,
    destroy: () => {
      persistence.destroy();
      canvasSync.destroy();
      fileOps.destroy();
    },
  };
}

/** Drain the microtask queue without moving the clock. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

/** Move the shared clock and let everything it woke finish. */
export async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await settle();
}

/**
 * Apply a remote delta the way a peer would: a detached doc, updated, merged back
 * under a foreign origin. This is what wakes `CanvasPersistence` and opens the
 * mute — the precondition the whole defect needs, and one no test may arrange by
 * calling `mutePathEvents` by hand.
 */
export function applyRemoteDelta(doc: Y.Doc, build: (nodes: Y.Map<Y.Map<unknown>>) => void): void {
  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  build(remote.getMap<Y.Map<unknown>>("nodes"));
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote), "peer");
  remote.destroy();
}

/** Build a detached `Y.Map` record the way a peer's serialiser would. */
export function remoteNode(id: string, text: string, x = 400): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  map.set("id", id);
  map.set("type", "text");
  map.set("x", x);
  map.set("y", 20);
  map.set("width", 240);
  map.set("height", 60);
  map.set("text", text);
  return map;
}

/** The ids the doc's `nodes` map currently holds. */
export function nodeIdsIn(doc: Y.Doc): string[] {
  return [...doc.getMap<Y.Map<unknown>>("nodes").keys()].sort();
}

/** The longest run, in ms on the shared clock, during which the path was
 * CONTINUOUSLY muted — computed from the recorded call sequence, never from a
 * constant. An unclosed final mute is measured to `now`. */
export function longestMutedInterval(log: MuteEvent[], now: number): number {
  let longest = 0;
  let openedAt: number | undefined;
  for (const event of log) {
    if (event.kind === "mute") {
      if (openedAt === undefined) openedAt = event.at;
    } else if (openedAt !== undefined) {
      longest = Math.max(longest, event.at - openedAt);
      openedAt = undefined;
    }
  }
  if (openedAt !== undefined) longest = Math.max(longest, now - openedAt);
  return longest;
}

/** `CAPTURE DECLINED:` lines only. */
export function declineLines(logs: string[]): string[] {
  return logs.filter((line) => line.startsWith("CAPTURE DECLINED:"));
}
