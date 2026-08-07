// WP68 / C68 — shared fixtures for "a rename cannot carry a path into, or out
// of, local replica state over the file-op channel".
//
// TWO ORACLES, and neither of them is the code under test:
//
//   ├── the OP SINK — a plain array the `FileOpsManager`'s injected sender
//   │   pushes into, plus `getOfflineState().queueDepth` for the SECOND exit of
//   │   `emitOp`. AC1 names the queue explicitly because guarding only the
//   │   online send would leave an offline client delivering the same op on
//   │   reconnect.
//   └── the DISK — `createRecordingVault()` below, whose `bytes` map IS the
//       file. Content is compared as BYTES, never through a reader this WP
//       touches, so "byte-identical afterwards" is a claim about the file and
//       not about an accessor. Every mutating method also appends to `journal`,
//       so "zero vault mutation" is asserted against a record of ALL of them
//       rather than against a hand-picked few.
//
// THE JOURNAL IS THE ANTI-VACUITY DEVICE. "nothing was emitted" and "nothing was
// mutated" both pass trivially against a harness that never emits or mutates
// anything, and this run has shipped that mistake more than a dozen times. Every
// case in this suite therefore drives its own POSITIVE CONTROL through the same
// fixtures in the same run, and asserts the journal is NON-empty there.
//
// `isSidecarPath`, `SIDECAR_DIR` and the sidecar filenames are IMPORTED from
// `files/canvas-sidecar.ts`, never re-spelt here — the same rule the production
// guards are held to (C26 AC3 / C68 AC5). A test that hard-coded
// `.obsidian/liveshare/state` would keep passing after the directory moved,
// against a guard that no longer covered it.

import { TFile } from "obsidian";
import { vi } from "vitest";

import {
  SEED_REFUSAL_STORE_FILENAME,
  SIDECAR_DIR,
  sidecarIndexPath,
} from "../../../files/canvas-sidecar";
import { FileOpsManager } from "../../../files/file-ops";
import type { FileOp } from "../../../types";

const encoder = new TextEncoder();

// ── the paths this suite discriminates with ────────────────────────────────
//
// DELIBERATELY NOT `.yhistory`. The charter names that as the trap: `isTextFile`
// already stops a `.yhistory` one line early at several seams, so a suite built
// on it could be green against a completely unguarded tree. `index.json` and a
// `.md` UNDER the sidecar directory are both ordinary text as far as every other
// predicate in the tree is concerned, so the ONLY thing that can stop them here
// is the guard this WP adds.

/** `.obsidian/liveshare/state/index.json` — a fixed filename EVERY peer holds. */
export const SIDECAR_INDEX = sidecarIndexPath();
/** A text file under the sidecar directory. `isTextFile` does not stop it. */
export const SIDECAR_NOTE = `${SIDECAR_DIR}/notes/replica.md`;
/** WP90's durable store — a second real sidecar filename, not an invented one. */
export const SIDECAR_STORE = `${SIDECAR_DIR}/${SEED_REFUSAL_STORE_FILENAME}`;
/**
 * The prefix-sharing NEAR MISS the charter names (AC4). One character past the
 * directory name and it is an ordinary shared path — a guard written as a
 * `startsWith` on the bare directory (no `/` boundary) would swallow it.
 */
export const NEAR_MISS = `${SIDECAR_DIR}ful/board.canvas`;
/**
 * WP95 — THE SAME NEAR-MISS SHAPE, OUTSIDE THE PROTECTED TREE.
 *
 * {@link NEAR_MISS} carries TWO properties that were conflated until WP95 forced
 * them apart, and only the first of them was ever really about this fixture:
 *
 *   1. `isSidecarPath` does not prefix-over-match — `stateful` is not `state`.
 *      STILL TRUE, still asserted on {@link NEAR_MISS} directly, and the reason
 *      that constant stays exactly as it was.
 *   2. such a path is ADMITTED across the file-op boundary. That was only ever
 *      true BECAUSE THE GUARD WAS NARROW: `.obsidian/liveshare/stateful/…` lies
 *      inside `.obsidian`, which WP95 protects in full. Asserting admission
 *      there is the defect written down as the specification.
 *
 * So the admission rows move here. This path is a near miss in the shape that
 * matters to them — it ends in `liveshare/stateful/` and would be swallowed by a
 * boundary-less `startsWith` just the same — while lying in ordinary shared
 * space, so it exercises "a path that merely LOOKS like replica state still
 * travels" without asserting anything WP95 has made false.
 */
export const NEAR_MISS_SHARED = "_liveshare-test/liveshare/stateful/board.canvas";

/** An ordinary shared note. */
export const SHARED_NOTE = "_liveshare-test/hello.md";
/** An ordinary shared canvas — MUST keep travelling (AC4). */
export const SHARED_CANVAS = "_liveshare-test/board.canvas";
/** A deep ordinary path (AC4). */
export const DEEP_NOTE = "_liveshare-test/a/b/c/d/deep.md";

// ── the disk ───────────────────────────────────────────────────────────────

export interface RecordingVault {
  /** The disk. The `Uint8Array` IS the file's content. */
  bytes: Map<string, Uint8Array>;
  /** Every mutating call, in order, as `"<method> <path>[ -> <arg>]"`. */
  journal: string[];
  getAbstractFileByPath(path: string): TFile | null;
  rename: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  createBinary: ReturnType<typeof vi.fn>;
  createFolder: ReturnType<typeof vi.fn>;
  modify: ReturnType<typeof vi.fn>;
  modifyBinary: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  trash: ReturnType<typeof vi.fn>;
  read: ReturnType<typeof vi.fn>;
  readBinary: ReturnType<typeof vi.fn>;
}

export interface RecordingFileManager {
  trashFile: ReturnType<typeof vi.fn>;
}

function tfile(path: string): TFile {
  const file = new TFile();
  file.path = path;
  return file;
}

/**
 * A vault whose every mutation is recorded.
 *
 * `getAbstractFileByPath` is READ-ONLY and is deliberately NOT journalled: a
 * refusal is allowed to look at the disk, it is not allowed to change it, and
 * mixing the two would leave the journal unable to express the difference.
 */
export function createRecordingVault(initial: Record<string, string> = {}): RecordingVault {
  const bytes = new Map<string, Uint8Array>();
  const files = new Map<string, TFile>();
  const journal: string[] = [];
  for (const [path, content] of Object.entries(initial)) {
    bytes.set(path, encoder.encode(content));
    files.set(path, tfile(path));
  }
  const vault: RecordingVault = {
    bytes,
    journal,
    getAbstractFileByPath: (path: string) => files.get(path) ?? null,
    rename: vi.fn(async (file: { path: string }, newPath: string) => {
      journal.push(`rename ${file.path} -> ${newPath}`);
      const content = bytes.get(file.path);
      bytes.delete(file.path);
      files.delete(file.path);
      if (content !== undefined) bytes.set(newPath, content);
      file.path = newPath;
      files.set(newPath, file as TFile);
    }),
    create: vi.fn(async (path: string, content: string) => {
      journal.push(`create ${path}`);
      bytes.set(path, encoder.encode(content));
      const file = tfile(path);
      files.set(path, file);
      return file;
    }),
    createBinary: vi.fn(async (path: string) => {
      journal.push(`createBinary ${path}`);
      bytes.set(path, new Uint8Array());
      const file = tfile(path);
      files.set(path, file);
      return file;
    }),
    createFolder: vi.fn(async (path: string) => {
      journal.push(`createFolder ${path}`);
      return {};
    }),
    modify: vi.fn(async (file: { path: string }, content: string) => {
      journal.push(`modify ${file.path}`);
      bytes.set(file.path, encoder.encode(content));
    }),
    modifyBinary: vi.fn(async (file: { path: string }) => {
      journal.push(`modifyBinary ${file.path}`);
      bytes.set(file.path, new Uint8Array());
    }),
    delete: vi.fn(async (file: { path: string }) => {
      journal.push(`delete ${file.path}`);
      bytes.delete(file.path);
      files.delete(file.path);
    }),
    trash: vi.fn(async (file: { path: string }) => {
      journal.push(`trash ${file.path}`);
      bytes.delete(file.path);
      files.delete(file.path);
    }),
    read: vi.fn(async () => "content"),
    readBinary: vi.fn(async () => new ArrayBuffer(8)),
  };
  return vault;
}

export function createRecordingFileManager(vault: RecordingVault): RecordingFileManager {
  return {
    trashFile: vi.fn(async (file: { path: string }) => {
      vault.journal.push(`trashFile ${file.path}`);
      vault.bytes.delete(file.path);
    }),
  };
}

/** A `TAbstractFile`-shaped stand-in for the vault `rename` event's payload. */
export function renamedFile(newPath: string): TFile {
  return tfile(newPath);
}

// ── the outbound seam ──────────────────────────────────────────────────────

export interface OutboundRig {
  manager: FileOpsManager;
  vault: RecordingVault;
  fileManager: RecordingFileManager;
  /** Everything the injected sender was handed, in order. */
  sent: FileOp[];
  /** Drive one vault `rename` event through `onFileRename`. */
  rename(oldPath: string, newPath: string): void;
}

/**
 * A real `FileOpsManager` with a recording sender.
 *
 * The sender is INJECTED rather than stubbed away, because AC1's oracle is what
 * reaches the wire. `setOnline(false)` switches `emitOp` to its other exit, and
 * `manager.getOfflineState().queueDepth` reads that one.
 */
export function createOutboundRig(initial: Record<string, string> = {}): OutboundRig {
  const vault = createRecordingVault(initial);
  const fileManager = createRecordingFileManager(vault);
  const manager = new FileOpsManager(vault as never, fileManager as never);
  const sent: FileOp[] = [];
  manager.setSender((op) => sent.push(op));
  return {
    manager,
    vault,
    fileManager,
    sent,
    rename(oldPath: string, newPath: string) {
      manager.onFileRename(renamedFile(newPath), oldPath);
    },
  };
}

// ── the inbound seam ───────────────────────────────────────────────────────

export type ChannelHandler = (msg: Record<string, unknown>) => void;

export function createFakeChannel() {
  const handlers = new Map<string, ChannelHandler[]>();
  return {
    handlers,
    on(type: string, handler: ChannelHandler) {
      const list = handlers.get(type) ?? [];
      list.push(handler);
      handlers.set(type, list);
    },
    send: vi.fn(),
    deliver(type: string, msg: Record<string, unknown>) {
      for (const handler of handlers.get(type) ?? []) handler(msg);
    },
  };
}

export interface InboundRig {
  manager: FileOpsManager;
  vault: RecordingVault;
  fileManager: RecordingFileManager;
  channel: ReturnType<typeof createFakeChannel>;
  plugin: Record<string, unknown>;
  /** Every op that reached `FileOpsManager.applyRemoteOp` — i.e. past the gate. */
  admitted: FileOp[];
  /** `logger.warn` messages, so the refusal is observable and not a silent drop. */
  warnings: string[];
  /** Hand a `FileOp` straight to the inbound `file-op` handler, as a peer would. */
  deliver(op: FileOp): Promise<void>;
}

/**
 * The receiving half, with NO SENDER-SIDE GUARD IN THE PICTURE (AC2).
 *
 * The op is hand-built and handed straight to the `file-op` handler, which is
 * exactly what an older, differently-configured or hostile peer does. Nothing
 * here goes anywhere near `FileOpsManager.onFileRename`, so the outbound guard
 * cannot account for any green this rig produces.
 *
 * `admitted` records every op that reached `applyRemoteOp`. That is a SECOND,
 * independent oracle beside the vault journal, and a sharper one for AC4: an op
 * that never reaches `applyRemoteOp` cannot have taken an `opQueues` slot or
 * issued a `mutePathEvents`, so a stranded mute is impossible by construction
 * rather than by inspection.
 *
 * `isSharedPath` reproduces the REAL predicate's answer for the two facts this
 * gate depends on — a sidecar path is not shared (C26 AC1), an ordinary path is
 * — rather than a stub that answers `true` to everything. A blanket `true` would
 * make the pre-WP68 gate admit and the post-WP68 gate refuse for a reason that
 * has nothing to do with the sidecar predicate.
 */
export function createInboundRig(
  registerControlHandlers: (plugin: never) => void,
  initial: Record<string, string> = {},
): InboundRig {
  const vault = createRecordingVault(initial);
  const fileManager = createRecordingFileManager(vault);
  const manager = new FileOpsManager(vault as never, fileManager as never);
  const channel = createFakeChannel();
  const warnings: string[] = [];
  const admitted: FileOp[] = [];
  let inflight: Promise<unknown> = Promise.resolve();

  const fileOpsManagerFacade = {
    setSender: (sender: (op: FileOp) => void) => manager.setSender(sender),
    applyRemoteOp: (op: FileOp, afterApply?: () => Promise<void>) => {
      admitted.push(op);
      const promise = manager.applyRemoteOp(op, afterApply);
      inflight = inflight.then(() => promise).catch(() => {});
      return promise;
    },
    onFileCreate: (file: never) => manager.onFileCreate(file),
    isPathMuted: (path: string) => manager.isPathMuted(path),
  };

  const plugin: Record<string, unknown> = {
    settings: { role: "host", permission: "read-write" },
    controlChannel: channel,
    fileOpsManager: fileOpsManagerFacade,
    manifestManager: {
      // C26 AC1's answer, reproduced: local replica state is not shared content.
      isSharedPath: (path: string) => !path.replace(/\\/g, "/").startsWith(`${SIDECAR_DIR}/`),
      renameFile: vi.fn(),
      removeFile: vi.fn(),
      updateFile: vi.fn(async () => {}),
      addFolder: vi.fn(),
      publishManifest: vi.fn(async () => ({
        verdict: "none",
        purged: false,
        entries: 0,
        deleted: [],
        unaccounted: [],
        reason: "test",
      })),
    },
    backgroundSync: {
      onFileAdded: vi.fn(async () => {}),
      onFileRemoved: vi.fn(),
      onFileRenamed: vi.fn(async () => {}),
      startAll: vi.fn(async () => {}),
    },
    syncManager: {},
    remoteUsers: new Map(),
    presenceManager: { broadcastPresence() {}, handlePresenceUpdate() {} },
    explorerIndicators: { update() {} },
    app: { vault, workspace: { getActiveViewOfType: () => null, getLeaf: () => null } },
    logger: {
      log: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn((_category: string, message: string) => {
        warnings.push(message);
      }),
      error: vi.fn(),
    },
    async saveSettings() {},
    // NOTE — there is deliberately no session-teardown stub on this fake
    // plugin. `wp88/test_ac1_route_census_derived_visible.test.ts` pins, over
    // the WHOLE test tree, that exactly one test file names the teardown seam,
    // and a second one reddens that census. No handler this rig drives reaches
    // it, so the stub was inert scaffolding and is simply absent.
    notify() {},
    updateStatusBar() {},
    updateOnlineState() {},
    onActiveFileChange() {},
    refreshPresenceView() {},
    controlConnected: false,
  };

  registerControlHandlers(plugin as never);

  return {
    manager,
    vault,
    fileManager,
    channel,
    plugin,
    admitted,
    warnings,
    async deliver(op: FileOp) {
      channel.deliver("file-op", { type: "file-op", op });
      // Await the REAL promise `applyRemoteOp` returned rather than a fixed
      // number of microtask turns. No wall clock and no timing constant is
      // involved: if the gate refused, `inflight` is already resolved and this
      // is a no-op; if it admitted, this waits for the apply that actually ran.
      await inflight;
      await inflight;
    },
  };
}
