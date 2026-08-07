// WP93 / C93 — shared fixtures for "a ceiling enforced by a timer is not a
// ceiling on a platform that clamps timers".
//
// THE FIXTURE IS THE ARGUMENT HERE, so it is worth stating what it refuses to
// fake and, more importantly, WHAT IT IS AND IS NOT EVIDENCE OF.
//
//   ├── the MUTE is the REAL `FileOpsManager` refcount, constructed, never a
//   │   double. Every mute in these files is taken by a real producer running a
//   │   real op — no test calls `mutePathEvents` to arrange the precondition,
//   │   because a harness that never takes a mute makes every "no collateral"
//   │   row true of the unmuted case (AC5(c)).
//   ├── the ROUTER is the REAL `registerVaultEvents` dispatcher. The consumption
//   │   signal WP93 adds lives inside the five gates it registers, so a test that
//   │   called `noteVaultEvent` by hand would be testing its own arm.
//   ├── the VAULT EVENT IS BUFFERED, NOT TIMED. `deliverVaultEvents()` hands the
//   │   registered handler the events the last vault mutation produced. That is
//   │   the whole premise under test: file-watcher / socket delivery is not
//   │   timer-throttled, which is the same property `sync/sync.ts` already relies
//   │   on for the awareness pulse. Delivering events on a `setTimeout` would put
//   │   the event term behind the very clock this WP exists to stop trusting.
//   └── the CLOCK is `vi.useFakeTimers()`, one clock for everything.
//
// ⚠ THE CLAMPED SCHEDULER IS A SIMULATION AND IT IS NOT EVIDENCE THAT THE
//   PRODUCT SURVIVES A REAL HOST CLAMP. It is evidence that the product's
//   behaviour does NOT DEPEND ON THE TIMER. WP91's report records that its
//   instrument was a virtual clock that could not observe a clamp by
//   construction; the answer to that is not a second instrument with the same
//   blind spot, it is to show the fixture stretching the ACTUAL release timer —
//   which `installGlobalClamp` does, on the pre-repair release expression itself
//   (see `test_tp03`).

import { vi } from "vitest";

import { TFile } from "obsidian";

import {
  FileOpsManager,
  type FileOpsManagerOpts,
  type MuteScheduler,
} from "../../../files/file-ops";
import { registerVaultEvents } from "../../../files/vault-events";
import type { FileOp } from "../../../types";

/**
 * S71, MEASURED: the renderer's timers are clamped to 60.00 s ± 0.02 — two
 * independent timers in two independent modules stretched to a whole minute at
 * the same moments, in 0.7 % of 18 600 pulses. This is the ratio the fixture
 * reproduces, not a round number chosen for convenience.
 */
export const CLAMP_MS = 60_000;

/** One recorded mute primitive call, stamped on the shared clock. Every interval
 * this suite asserts is reduced from this sequence — never read back out of the
 * constant that sets it (the C73/WP75 class). */
export interface MuteEvent {
  kind: "mute" | "unmute";
  at: number;
  path: string;
}

export function mockFile(path: string): TFile {
  const file = Object.create(TFile.prototype) as TFile;
  (file as { path: string }).path = path;
  (file as { stat: unknown }).stat = { size: 0, mtime: 0, ctime: 0 };
  return file;
}

/**
 * A `MuteScheduler` that reproduces S71's clamp: every delay is stretched to at
 * least `clampMs`. `now()` is the shared fake clock, so a held interval measured
 * through this scheduler and one measured from the `muteLog` are the same
 * number on the same clock.
 */
export function clampedScheduler(clampMs = CLAMP_MS): MuteScheduler {
  return {
    now: () => Date.now(),
    setTimeout: (cb, ms) => globalThis.setTimeout(cb, Math.max(ms, clampMs)),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}

/**
 * The same clamp, applied to the GLOBAL `setTimeout` instead of to an injected
 * seam — which is what makes the fixture's claim checkable. Production's default
 * scheduler routes straight to the globals, so a clamp installed here and a
 * clamp installed on `clampedScheduler` are the same clamp; and the pre-repair
 * release expression used the globals directly, so this is the only way to show
 * the fixture stretching the timer the pre-repair code actually used (AC3(b)).
 *
 * Install AFTER `vi.useFakeTimers()`: the stub delegates to whatever
 * `globalThis.setTimeout` was at install time, which is the fake.
 */
export function installGlobalClamp(clampMs = CLAMP_MS): () => void {
  const inner = globalThis.setTimeout;
  const patched = ((cb: (...a: unknown[]) => void, ms?: number, ...rest: unknown[]) =>
    (inner as (...a: unknown[]) => unknown)(
      cb,
      Math.max(Number(ms) || 0, clampMs),
      ...rest,
    )) as unknown as typeof globalThis.setTimeout;
  vi.stubGlobal("setTimeout", patched);
  return () => vi.unstubAllGlobals();
}

export interface RigOpts {
  initial?: Record<string, string>;
  /** Inject S71's clamp into the manager's own release scheduler. */
  clamped?: boolean;
  /** AC3 CONTROL: `false` removes the EVENT term, leaving the ceiling alone —
   * i.e. the pre-WP93 release shape expressed through the post-WP93 path. */
  releaseOnConsumingEvent?: boolean;
}

export interface Rig {
  files: Map<string, string>;
  fileOps: FileOpsManager;
  /** Every mute/unmute the real manager took, in order, stamped. */
  muteLog: MuteEvent[];
  /** Every line the plugin logger emitted. */
  logs: string[];
  /** Every op the manager handed to its sender. */
  sent: FileOp[];
  canvasSync: {
    isSubscribed: ReturnType<typeof vi.fn>;
    handleRename: ReturnType<typeof vi.fn>;
    handleLocalModify: ReturnType<typeof vi.fn>;
  };
  backgroundSync: Record<string, ReturnType<typeof vi.fn>> & {
    isRecentDiskWrite: (p: string) => boolean;
  };
  manifest: Record<string, ReturnType<typeof vi.fn>>;
  /** Vault events the last mutation produced but has not yet delivered. */
  pendingVaultEvents: Array<{ event: string; args: unknown[] }>;
  /** Hand every buffered event to the REAL registered handler. Not timer-driven:
   * see the header. */
  deliverVaultEvents(): Promise<void>;
  /** A deferred `vault.read`, so the post-await re-check has a real await to
   * live inside (AC2(c) forbids a synchronous fake read). */
  deferReads(path: string): { resolve(content: string): void };
  destroy(): void;
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
 * The longest run, on the shared clock, during which `path` was CONTINUOUSLY
 * muted, computed from the recorded call sequence. An unclosed final mute is
 * measured to `now`, so a mute that never releases reports as long as the test
 * has run rather than as zero.
 */
export function longestMutedInterval(log: readonly MuteEvent[], path: string, now: number): number {
  let longest = 0;
  let depth = 0;
  let openedAt = 0;
  for (const event of log) {
    if (event.path !== path) continue;
    if (event.kind === "mute") {
      if (depth === 0) openedAt = event.at;
      depth += 1;
    } else if (depth > 0) {
      depth -= 1;
      if (depth === 0) longest = Math.max(longest, event.at - openedAt);
    }
  }
  if (depth > 0) longest = Math.max(longest, now - openedAt);
  return longest;
}

/** `MUTE OVERRUN:` lines only. */
export function overrunLines(logs: readonly string[]): string[] {
  return logs.filter((line) => line.startsWith("MUTE OVERRUN:"));
}

export function createRig(opts: RigOpts = {}): Rig {
  const files = new Map<string, string>(Object.entries(opts.initial ?? {}));
  const muteLog: MuteEvent[] = [];
  const logs: string[] = [];
  const sent: FileOp[] = [];
  const pendingVaultEvents: Array<{ event: string; args: unknown[] }> = [];
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const deferred = new Map<string, Array<(content: string) => void>>();

  const queue = (event: string, ...args: unknown[]) => {
    pendingVaultEvents.push({ event, args });
  };

  const readOf = (path: string): Promise<string> => {
    const waiters = deferred.get(path);
    if (!waiters) return Promise.resolve(files.get(path) ?? "");
    return new Promise<string>((resolve) => {
      waiters.push((content) => resolve(content));
    });
  };

  const vault = {
    getAbstractFileByPath: (p: string) => (files.has(p) ? mockFile(p) : null),
    read: (file: { path: string }) => readOf(file.path),
    readBinary: async (file: { path: string }) => {
      const content = await readOf(file.path);
      return new TextEncoder().encode(content).buffer as ArrayBuffer;
    },
    create: async (p: string, c: string) => {
      files.set(p, c);
      queue("create", mockFile(p));
      return mockFile(p);
    },
    createBinary: async (p: string, _d: ArrayBuffer) => {
      files.set(p, "");
      queue("create", mockFile(p));
      return mockFile(p);
    },
    modify: async (file: { path: string }, c: string) => {
      files.set(file.path, c);
      queue("modify", mockFile(file.path));
    },
    modifyBinary: async (file: { path: string }, _d: ArrayBuffer) => {
      queue("modify", mockFile(file.path));
    },
    rename: async (file: { path: string }, newPath: string) => {
      const old = file.path;
      const content = files.get(old) ?? "";
      files.delete(old);
      files.set(newPath, content);
      queue("rename", mockFile(newPath), old);
    },
    createFolder: async (p: string) => {
      files.set(p, "");
      return mockFile(p);
    },
    getFiles: () => [...files.keys()].map(mockFile),
    adapter: {
      read: async (p: string) => files.get(p) ?? "",
      write: async (p: string, c: string) => {
        files.set(p, c);
        queue("modify", mockFile(p));
      },
      exists: async (p: string) => files.has(p),
    },
  };

  const fileManager = {
    trashFile: async (file: { path: string }) => {
      if (!files.has(file.path)) return;
      files.delete(file.path);
      queue("delete", mockFile(file.path));
    },
  };

  const managerOpts: FileOpsManagerOpts = {};
  if (opts.clamped) managerOpts.scheduler = clampedScheduler();
  if (opts.releaseOnConsumingEvent !== undefined) {
    managerOpts.releaseOnConsumingEvent = opts.releaseOnConsumingEvent;
  }

  // THE REAL REFCOUNT. Constructed, not doubled.
  const fileOps = new FileOpsManager(vault as never, fileManager as never, managerOpts);
  const logger = {
    debug: (_c: string, m: string) => logs.push(m),
    warn: (_c: string, m: string) => logs.push(m),
    log: vi.fn(),
    error: vi.fn(),
  };
  fileOps.setLogger(logger);
  fileOps.setSender((op) => sent.push(op));

  // Record the REAL primitives' call sequence, calling through. This is the only
  // observable any interval in this suite is derived from.
  const realMute = fileOps.mutePathEvents.bind(fileOps);
  const realUnmute = fileOps.unmutePathEvents.bind(fileOps);
  vi.spyOn(fileOps, "mutePathEvents").mockImplementation((path: string) => {
    muteLog.push({ kind: "mute", at: Date.now(), path });
    realMute(path);
  });
  vi.spyOn(fileOps, "unmutePathEvents").mockImplementation((path: string) => {
    muteLog.push({ kind: "unmute", at: Date.now(), path });
    realUnmute(path);
  });

  const canvasSync = {
    isSubscribed: vi.fn(() => false),
    handleRename: vi.fn(async () => {}),
    handleLocalModify: vi.fn(async () => {}),
  };
  const backgroundSync = {
    isRecentDiskWrite: () => false,
    handleLocalTextModify: vi.fn(async () => {}),
    subscribe: vi.fn(async () => {}),
    unsubscribe: vi.fn(),
    onFileAdded: vi.fn(async () => {}),
    onFileRemoved: vi.fn(),
    onFileRenamed: vi.fn(async () => {}),
    cancelSubscribe: vi.fn(),
  };
  const manifest = {
    isSharedPath: vi.fn(() => true),
    updateFile: vi.fn(async () => {}),
    removeFile: vi.fn(),
    addFolder: vi.fn(),
    renameFile: vi.fn(),
  };

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
    settings: { role: "host" as const, useCanvasBinding: false },
    logger,
    manifestManager: manifest,
    fileOpsManager: fileOps,
    backgroundSync,
    canvasSync,
    syncManager: {},
    presenceManager: undefined,
    onActiveFileChange: vi.fn(),
  };
  registerVaultEvents(plugin as never);

  return {
    files,
    fileOps,
    muteLog,
    logs,
    sent,
    canvasSync,
    backgroundSync: backgroundSync as never,
    manifest: manifest as never,
    pendingVaultEvents,
    async deliverVaultEvents() {
      const batch = pendingVaultEvents.splice(0, pendingVaultEvents.length);
      for (const { event, args } of batch) handlers.get(event)?.(...args);
      await settle();
    },
    deferReads(path: string) {
      const waiters: Array<(content: string) => void> = [];
      deferred.set(path, waiters);
      return {
        resolve(content: string) {
          deferred.delete(path);
          for (const waiter of waiters.splice(0, waiters.length)) waiter(content);
        },
      };
    },
    destroy: () => {
      vi.restoreAllMocks();
      fileOps.destroy();
    },
  };
}
