import * as Y from "yjs";

// ---------------------------------------------------------------------------
// WP24 — Sidecar store core (C24).
//
// Gives every shared doc a durable, append-only update history that lives
// OUTSIDE the shared vault scope, so a doc's causal history survives the
// process.
//
//   <SIDECAR_DIR>/<guid>.yhistory     append-only frame log
//   <SIDECAR_DIR>/<guid>.ycheckpoint  full-state compaction of that log
//   <SIDECAR_DIR>/index.json          guid -> vault-relative canvas file
//
// Four properties carry the whole component:
//
//   1. ORDERING. `checkpoint` writes the full state and truncates the history
//      only after that write has RESOLVED. The end state is identical either
//      way, so only the sequence distinguishes correct from broken: a crash
//      between the two steps must cost nothing, which is true for
//      write-then-truncate and false for truncate-then-write. The two effects
//      are therefore never issued concurrently either.
//   2. ALL-OR-NOTHING LOAD. Everything is decoded and validated before a single
//      byte reaches the caller's doc, and the reconstruction lands in ONE
//      `Y.applyUpdate`. A doc that received three of five updates before the
//      fourth turned out to be garbage is a WORSE outcome than one that
//      received none, because it looks healthy.
//   3. DEFINED DEGRADATION. Missing / truncated / corrupt are reported, never
//      thrown, never repaired, never partially applied.
//   4. INJECTED I/O. Every byte moves through `SidecarIO`. This module imports
//      neither Obsidian nor the filesystem, and reads no clock — the precedent
//      for such a core is `canvas/reconcile-plan.ts`; this one is licensed to
//      import Yjs only because it has to encode checkpoints.
//
// The store also SERIALISES its mutating operations per guid, so no append can
// land between a checkpoint's encode and its truncate (and be lost with the
// truncated log).
// ---------------------------------------------------------------------------

// ── constants ──────────────────────────────────────────────────────────────

/** The one spelling of the sidecar directory. Consumers import it. */
export const SIDECAR_DIR = ".obsidian/liveshare/state";
export const SIDECAR_HISTORY_EXT = ".yhistory";
export const SIDECAR_CHECKPOINT_EXT = ".ycheckpoint";
export const SIDECAR_INDEX_FILENAME = "index.json";

/** Frame header width: u32 big-endian payload length. */
const FRAME_HEADER_BYTES = 4;

// ── paths ──────────────────────────────────────────────────────────────────

export function sidecarHistoryPath(guid: string): string {
  return `${SIDECAR_DIR}/${guid}${SIDECAR_HISTORY_EXT}`;
}

export function sidecarCheckpointPath(guid: string): string {
  return `${SIDECAR_DIR}/${guid}${SIDECAR_CHECKPOINT_EXT}`;
}

export function sidecarIndexPath(): string {
  return `${SIDECAR_DIR}/${SIDECAR_INDEX_FILENAME}`;
}

/**
 * True iff `path` names a FILE inside `SIDECAR_DIR`, at any depth, with any
 * extension (`index.json` included).
 *
 * This is a directory-prefix test on a `/` boundary, NOT an extension test:
 * WP26's exclusion is "no file under the sidecar directory", so an unknown or
 * future extension has to be covered too. `\` is normalised to `/` and one
 * leading `./` or `/` is stripped first; the comparison is case-SENSITIVE. The
 * directory itself, its trailing-slash form, prefix-sharing siblings
 * (`.../stateful/x`) and any path that merely contains the directory further in
 * (`notes/.obsidian/liveshare/state/x`) are all false.
 *
 * WP26 calls this; it never writes its own prefix or suffix test.
 */
export function isSidecarPath(path: string): boolean {
  if (typeof path !== "string" || path.length === 0) return false;
  let normalised = path.replace(/\\/g, "/");
  if (normalised.startsWith("./")) normalised = normalised.slice(2);
  else if (normalised.startsWith("/")) normalised = normalised.slice(1);
  const prefix = `${SIDECAR_DIR}/`;
  if (!normalised.startsWith(prefix)) return false;
  // The directory itself and its trailing-slash form name no file.
  return normalised.length > prefix.length;
}

// ── the injected I/O seam (AC4) ────────────────────────────────────────────

/**
 * Every promise resolves only once the effect is DURABLE — that guarantee is
 * what makes the checkpoint-before-truncate ordering meaningful. `read` rejects
 * if the path does not exist, so the store confirms with `exists` first.
 * `truncate` reduces the file to zero bytes and leaves it in place; `remove`
 * unlinks it.
 */
export interface SidecarIO {
  ensureDir(dirPath: string): Promise<void>;
  exists(filePath: string): Promise<boolean>;
  read(filePath: string): Promise<Uint8Array>;
  write(filePath: string, data: Uint8Array): Promise<void>;
  append(filePath: string, data: Uint8Array): Promise<void>;
  truncate(filePath: string): Promise<void>;
  remove(filePath: string): Promise<void>;
}

// ── the degradation report (AC3) ───────────────────────────────────────────

export const SIDECAR_DEGRADATION = {
  NONE: "none",
  MISSING: "missing",
  TRUNCATED: "truncated",
  CORRUPT: "corrupt",
} as const;
export type SidecarDegradation = (typeof SIDECAR_DEGRADATION)[keyof typeof SIDECAR_DEGRADATION];

export interface SidecarLoadResult {
  readonly degradation: SidecarDegradation;
  readonly checkpointApplied: boolean;
  readonly historyEntriesApplied: number;
  /** Human-readable only. Never an oracle, never parsed by a consumer. */
  readonly detail?: string;
}

export function isSidecarDegraded(result: SidecarLoadResult): boolean {
  return result.degradation !== SIDECAR_DEGRADATION.NONE;
}

/** Transaction origin of the single `Y.applyUpdate` that `load` performs. */
export const SIDECAR_LOAD_ORIGIN: unique symbol = Symbol("sidecar-load-origin");

// ── index.json ─────────────────────────────────────────────────────────────

/**
 * guid -> vault-relative canvas path. WP27 owns what the mapping MEANS; WP24
 * owns the file, its JSON encoding and its degradation behaviour.
 */
export type SidecarIndex = Record<string, string>;

// ── the store ──────────────────────────────────────────────────────────────

export interface SidecarStore {
  append(guid: string, update: Uint8Array): Promise<void>;
  checkpoint(guid: string, doc: Y.Doc): Promise<void>;
  load(guid: string, doc: Y.Doc): Promise<SidecarLoadResult>;
  truncate(guid: string): Promise<void>;
  readIndex(): Promise<SidecarIndex>;
  writeIndex(index: SidecarIndex): Promise<void>;
}

// ── framing helpers (module-private; the format is pinned by the charter) ───

/**
 * `frame := u32 BIG-ENDIAN payloadByteLength || payload`.
 *
 * Copies the payload — this is also the SNAPSHOT that `append` takes before its
 * first `await`. The caller's `Uint8Array` may be a pooled socket buffer that is
 * recycled mid-flight; this project has already been bitten by exactly that
 * defect in the relay blob store.
 */
function encodeFrame(payload: Uint8Array): Uint8Array {
  const length = payload.length;
  const out = new Uint8Array(FRAME_HEADER_BYTES + length);
  out[0] = (length >>> 24) & 0xff;
  out[1] = (length >>> 16) & 0xff;
  out[2] = (length >>> 8) & 0xff;
  out[3] = length & 0xff;
  out.set(payload, FRAME_HEADER_BYTES);
  return out;
}

function readFrameLength(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) >>> 0) + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3];
}

type HistoryScan =
  | { readonly ok: true; readonly payloads: Uint8Array[] }
  | {
      readonly ok: false;
      readonly degradation: SidecarDegradation;
      readonly detail: string;
    };

/**
 * Walks the frame log and validates every payload against Yjs BEFORE anything is
 * applied to the caller's doc. `probe` carries the already-applied checkpoint so
 * each frame is judged in its real causal context.
 *
 * The two tear shapes are distinguished from real corruption: a header cut
 * mid-way and a declared payload that runs past end-of-file are TRUNCATED (the
 * process died between the write reaching the OS and the bytes reaching the
 * platter); a structurally complete frame whose payload Yjs refuses, or one that
 * declares length zero, is CORRUPT.
 */
function scanHistory(history: Uint8Array, probe: Y.Doc): HistoryScan {
  const payloads: Uint8Array[] = [];
  let at = 0;
  while (at < history.length) {
    if (at + FRAME_HEADER_BYTES > history.length) {
      return {
        ok: false,
        degradation: SIDECAR_DEGRADATION.TRUNCATED,
        detail: `incomplete frame header at byte ${at}`,
      };
    }
    const length = readFrameLength(history, at);
    if (length === 0) {
      return {
        ok: false,
        degradation: SIDECAR_DEGRADATION.CORRUPT,
        detail: `zero-length frame at byte ${at}`,
      };
    }
    const end = at + FRAME_HEADER_BYTES + length;
    if (end > history.length) {
      return {
        ok: false,
        degradation: SIDECAR_DEGRADATION.TRUNCATED,
        detail: `frame at byte ${at} declares ${length} bytes but only ${
          history.length - at - FRAME_HEADER_BYTES
        } remain`,
      };
    }
    const payload = history.slice(at + FRAME_HEADER_BYTES, end);
    if (!applyIsAccepted(probe, payload)) {
      return {
        ok: false,
        degradation: SIDECAR_DEGRADATION.CORRUPT,
        detail: `frame at byte ${at} is not a decodable Yjs update`,
      };
    }
    payloads.push(payload);
    at = end;
  }
  return { ok: true, payloads };
}

/** Validation probe: does Yjs accept these bytes as an update? Never throws. */
function applyIsAccepted(probe: Y.Doc, update: Uint8Array): boolean {
  if (update.length === 0) return false;
  try {
    Y.applyUpdate(probe, update);
    return true;
  } catch {
    return false;
  }
}

function missingResult(detail: string): SidecarLoadResult {
  return {
    degradation: SIDECAR_DEGRADATION.MISSING,
    checkpointApplied: false,
    historyEntriesApplied: 0,
    detail,
  };
}

function degradedResult(degradation: SidecarDegradation, detail: string): SidecarLoadResult {
  return { degradation, checkpointApplied: false, historyEntriesApplied: 0, detail };
}

// ── the factory ────────────────────────────────────────────────────────────

const NOOP = (): void => {};

/**
 * Creates a sidecar store over an injected I/O seam.
 *
 * Operations are SERIALISED per guid through a small promise chain. Nothing in
 * the visible suite can observe its absence — the fakes preserve FIFO order —
 * but it is a correctness requirement all the same: `checkpoint` encodes the
 * doc's full state, awaits the checkpoint write, and only then truncates, so an
 * `append` allowed to interleave between the encode and the truncate would be
 * absent from the checkpoint AND destroyed by the truncate. The queue closes
 * that window. Each guid has its own chain, so two docs never block each other,
 * and `index.json` has a chain of its own.
 */
export function createSidecarStore(io: SidecarIO): SidecarStore {
  const queues = new Map<string, Promise<unknown>>();

  function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = queues.get(key) ?? Promise.resolve();
    // `then(task, task)` — a failed operation must not wedge the guid's queue.
    const running = previous.then(task, task);
    const tail = running.then(NOOP, NOOP);
    queues.set(key, tail);
    void tail.then(() => {
      if (queues.get(key) === tail) queues.delete(key);
    });
    return running;
  }

  const docKey = (guid: string): string => `doc:${guid}`;
  const INDEX_KEY = "index";

  /** The raw truncate, used from inside a queued task (re-entering the queue
   *  from within a task that holds it would deadlock). */
  async function truncateHistory(guid: string): Promise<void> {
    await io.truncate(sidecarHistoryPath(guid));
  }

  async function loadInner(guid: string, doc: Y.Doc): Promise<SidecarLoadResult> {
    const checkpointPath = sidecarCheckpointPath(guid);
    const historyPath = sidecarHistoryPath(guid);

    const hasCheckpoint = await io.exists(checkpointPath);
    const hasHistory = await io.exists(historyPath);
    if (!hasCheckpoint && !hasHistory) {
      return missingResult("no sidecar files for this guid");
    }

    // Everything below is decoded and validated against a THROWAWAY replica.
    // The caller's doc is not touched until the whole reconstruction is known
    // good — that is the all-or-nothing rule (AC3), and it is why the probe
    // exists at all.
    const probe = new Y.Doc();
    const parts: Uint8Array[] = [];

    if (hasCheckpoint) {
      let checkpointBytes: Uint8Array;
      try {
        checkpointBytes = await io.read(checkpointPath);
      } catch (error) {
        return degradedResult(
          SIDECAR_DEGRADATION.CORRUPT,
          `checkpoint unreadable: ${describe(error)}`,
        );
      }
      // A checkpoint that exists must carry a state; zero bytes means the write
      // was lost. (An empty HISTORY is legitimate — it is a compacted sidecar.)
      if (!applyIsAccepted(probe, checkpointBytes)) {
        return degradedResult(
          SIDECAR_DEGRADATION.CORRUPT,
          checkpointBytes.length === 0
            ? "checkpoint file is empty"
            : "checkpoint is not a decodable Yjs update",
        );
      }
      parts.push(checkpointBytes);
    }

    let historyPayloads: Uint8Array[] = [];
    if (hasHistory) {
      let historyBytes: Uint8Array;
      try {
        historyBytes = await io.read(historyPath);
      } catch (error) {
        return degradedResult(
          SIDECAR_DEGRADATION.CORRUPT,
          `history unreadable: ${describe(error)}`,
        );
      }
      const scan = scanHistory(historyBytes, probe);
      if (!scan.ok) return degradedResult(scan.degradation, scan.detail);
      historyPayloads = scan.payloads;
      parts.push(...historyPayloads);
    }

    if (parts.length > 0) {
      const merged = parts.length === 1 ? parts[0] : Y.mergeUpdates(parts);
      try {
        Y.applyUpdate(doc, merged, SIDECAR_LOAD_ORIGIN);
      } catch (error) {
        // Unreachable in practice: every part was accepted by the probe above.
        // Still reported rather than thrown — AC3 admits no exception path.
        return degradedResult(
          SIDECAR_DEGRADATION.CORRUPT,
          `reconstruction refused: ${describe(error)}`,
        );
      }
    }

    return {
      degradation: SIDECAR_DEGRADATION.NONE,
      checkpointApplied: hasCheckpoint,
      historyEntriesApplied: historyPayloads.length,
    };
  }

  return {
    append(guid: string, update: Uint8Array): Promise<void> {
      // Snapshot FIRST, synchronously, before any await: the caller's buffer may
      // be pooled and recycled the instant this call returns.
      const framed = encodeFrame(update);
      return enqueue(docKey(guid), async () => {
        await io.ensureDir(SIDECAR_DIR);
        await io.append(sidecarHistoryPath(guid), framed);
      });
    },

    checkpoint(guid: string, doc: Y.Doc): Promise<void> {
      // Encode synchronously, before the first await, so the checkpoint is the
      // state the caller asked to compact and not a later one. Full state, never
      // a delta: the history behind it is destroyed moments later, so a delta
      // would be meaningless to the fresh replica that has to read this.
      const state = Y.encodeStateAsUpdate(doc);
      return enqueue(docKey(guid), async () => {
        await io.ensureDir(SIDECAR_DIR);
        // AC1's ordering claim: await the write to completion, THEN truncate.
        // Never `Promise.all`, never the reverse. If the write rejects, the
        // history is left untouched and the rejection propagates.
        await io.write(sidecarCheckpointPath(guid), state);
        await truncateHistory(guid);
      });
    },

    truncate(guid: string): Promise<void> {
      return enqueue(docKey(guid), () => truncateHistory(guid));
    },

    load(guid: string, doc: Y.Doc): Promise<SidecarLoadResult> {
      return enqueue(docKey(guid), async () => {
        try {
          return await loadInner(guid, doc);
        } catch (error) {
          // AC3: load never throws, for any byte sequence and any IO failure.
          return degradedResult(
            SIDECAR_DEGRADATION.CORRUPT,
            `sidecar unreadable: ${describe(error)}`,
          );
        }
      });
    },

    readIndex(): Promise<SidecarIndex> {
      return enqueue(INDEX_KEY, async () => {
        const indexPath = sidecarIndexPath();
        try {
          if (!(await io.exists(indexPath))) return {};
          const bytes = await io.read(indexPath);
          if (bytes.length === 0) return {};
          const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            return {};
          }
          const out: SidecarIndex = {};
          for (const [guid, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof value === "string") out[guid] = value;
          }
          return out;
        } catch {
          // Missing, half-written, wrongly-shaped: all degrade to `{}`. Never
          // throws, and never "repairs" the file it could not read.
          return {};
        }
      });
    },

    writeIndex(index: SidecarIndex): Promise<void> {
      const bytes = new TextEncoder().encode(JSON.stringify(index));
      return enqueue(INDEX_KEY, async () => {
        await io.ensureDir(SIDECAR_DIR);
        // One write of the whole mapping — never an append, which would grow
        // without bound and stop parsing on the second call.
        await io.write(sidecarIndexPath(), bytes);
      });
    },
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
