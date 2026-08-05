import type { Vault } from "obsidian";

const FLUSH_DELAY_MS = 500;

// Phase A: real logging / status console. The logger now keeps an in-memory RING
// BUFFER of structured entries (in addition to the best-effort file sink) so a
// live UI view (LogView) can render the log stream, filter it by level, and
// subscribe to new entries. File writing stays gated by `enabled`; the ring
// buffer and subscribers are populated independently (subject to the min-level
// filter) so the status console works even when file logging is off.

export type LogLevel = "debug" | "info" | "warn" | "error";

export const LOG_LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

export const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface LogEntry {
  /** ISO timestamp. */
  ts: string;
  level: LogLevel;
  category: string;
  message: string;
}

// Cap on the in-memory ring buffer. Old entries are dropped from the front.
const RING_CAP = 500;

// WP81 — cap on the set of formatted lines the sink is still holding because a
// write has not succeeded yet. Mirrors RING_CAP deliberately: "do not discard a
// line on the strength of a write that has not succeeded" must not turn a
// permanently failing sink into an unbounded memory leak. Overflow drops the
// OLDEST lines and is counted in `linesDropped`, so the loss is reported rather
// than silent — which is the whole point of this work package.
const PENDING_CAP = 500;

// Category used for the sink's own statements about itself. It is not an
// application log category: no existing signature, category, level or volume
// changes because of it. At most one location line per session (per resolved
// path) and at most one failure line per failure run are emitted under it.
const SINK_CATEGORY = "log-sink";

// Failure text from the adapter is untrusted length; the announcement is a
// single line in a log and a single toast.
const MAX_ERROR_CHARS = 200;

/**
 * WP81 — what the file sink is actually doing, as opposed to what the settings
 * say it should be doing.
 *
 * The defect this answers: an enabled sink that is dropping every line, a sink
 * writing to a path the reader is not watching, and a sink muted by a *view*
 * control are, from outside, the same thing — a file that is not getting
 * longer. Every field here is read from the sink's own state at call time;
 * none is an echo of `LiveShareSettings` and none is a literal.
 *
 * Deliberately carries **no settings values** other than the log path itself:
 * the vault's `data.json` holds live credentials and the debug log is an
 * artefact that leaves the process.
 *
 * Lives here rather than in `types.ts` because it describes the logger, not the
 * persisted settings schema, and because `types.ts`'s `DEFAULT_SETTINGS` block
 * carries the WP22 comment-strip trap that any JSDoc added below it triggers.
 */
export interface DebugSinkState {
  /** Path the next append will go to — the sink's own resolved path. */
  path: string;
  /** File sink on/off. `false` here means *disabled*, never *failing*. */
  enabled: boolean;
  /** Minimum level the FILE sink applies. No view control can change it. */
  fileLevel: LogLevel;
  /** Minimum level the ring buffer and subscriber fan-out apply. */
  ringLevel: LogLevel;
  /** Lines whose append actually resolved, this session. */
  linesWritten: number;
  /** Formatted lines held but not yet confirmed written (buffered or in flight). */
  linesPending: number;
  /** Lines given up on because the bounded pending set overflowed. */
  linesDropped: number;
  /** Path the last attempted append actually went to; `null` if none attempted. */
  lastWritePath: string | null;
  /** Outcome of the last attempted append; `null` if none attempted. */
  lastWriteOk: boolean | null;
  /** Consecutive failed flushes since the last success. `0` when healthy. */
  failureCount: number;
  /** The last write failure, or `null` when the last write succeeded. */
  lastError: { message: string; ts: string } | null;
  /** Whether the current failure run was already announced (announce once, then count). */
  failureAnnounced: boolean;
  /** Whether this session already stated where it is writing, for the current path. */
  locationAnnounced: boolean;
}

function stringifyError(err: unknown): string {
  if (err === undefined || err === null) return "";
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (typeof err === "number" || typeof err === "boolean") return String(err);
  try {
    return JSON.stringify(err);
  } catch {
    return "[unserializable error]";
  }
}

export class DebugLogger {
  private buffer: string[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  // In-memory ring buffer + live subscribers for the status console.
  private ring: LogEntry[] = [];
  private minLevel: LogLevel = "debug";
  private subscribers = new Set<(entry: LogEntry | null) => void>();

  // WP81 — the file sink's OWN minimum level, separate from `minLevel`.
  // `minLevel` is the ring/subscriber gate and is what `setLevel()` moves; the
  // status console's level dropdown must never be able to mute the file. The
  // default equals the default `minLevel`, so with no view action the volume
  // written to the file is byte-identical to the pre-WP81 behaviour.
  private fileMinLevel: LogLevel = "debug";

  // WP81 — sink state. All of it is measured, none of it is an echo of settings.
  private inFlight: string[] = [];
  private writing = false;
  private linesWritten = 0;
  private linesDropped = 0;
  private lastWritePath: string | null = null;
  private lastWriteOk: boolean | null = null;
  private failureCount = 0;
  private lastError: { message: string; ts: string } | null = null;
  private failureAnnounced = false;
  private locationAnnounced = false;

  constructor(
    private vault: Vault,
    private logPath: string,
    private enabled: boolean,
    /**
     * WP81 — the announcement channel, injected so it does not depend on the
     * sink that is failing and so the failure path is testable headlessly.
     * `main.ts` wires this to `new Notice(...)`.
     */
    private notify?: (message: string) => void,
  ) {}

  updateSettings(enabled: boolean, logPath: string): void {
    // WP81 — a relocation is exactly the case that cost this project a day:
    // the file moved and nothing said so. Re-arm the location statement so the
    // next entry names the new path, in the log and in the ring buffer.
    const relocated = logPath !== this.logPath;
    const reEnabled = enabled && !this.enabled;
    this.enabled = enabled;
    this.logPath = logPath;
    if (relocated || reEnabled) this.locationAnnounced = false;
  }

  // ---- Level-aware entry points ------------------------------------------
  debug(category: string, message: string): void {
    this.record("debug", category, message);
  }

  log(category: string, message: string): void {
    this.record("info", category, message);
  }

  warn(category: string, message: string): void {
    this.record("warn", category, message);
  }

  error(category: string, message: string, err?: unknown): void {
    const suffix = stringifyError(err);
    this.record("error", category, suffix ? `${message}: ${suffix}` : message);
  }

  // ---- Status-console surface --------------------------------------------
  /**
   * Set the minimum level recorded to the ring buffer and subscribers.
   *
   * WP81: this no longer gates the FILE sink. It is reachable from a *view*
   * control (`LogView`'s level dropdown), and a view filter that silently stops
   * lines reaching the persistent log is indistinguishable — from outside —
   * from a logger that died. Use {@link setFileLevel} for the file sink.
   */
  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  getLevel(): LogLevel {
    return this.minLevel;
  }

  /** WP81 — the file sink's own minimum level. Not reachable from any view. */
  setFileLevel(level: LogLevel): void {
    this.fileMinLevel = level;
  }

  getFileLevel(): LogLevel {
    return this.fileMinLevel;
  }

  /**
   * WP81 — "is the log working, and where is it?", answered from the sink's own
   * state rather than from the settings that were supposed to configure it.
   */
  getSinkState(): DebugSinkState {
    return {
      path: this.logPath,
      enabled: this.enabled,
      fileLevel: this.fileMinLevel,
      ringLevel: this.minLevel,
      linesWritten: this.linesWritten,
      linesPending: this.buffer.length + this.inFlight.length,
      linesDropped: this.linesDropped,
      lastWritePath: this.lastWritePath,
      lastWriteOk: this.lastWriteOk,
      failureCount: this.failureCount,
      lastError: this.lastError ? { ...this.lastError } : null,
      failureAnnounced: this.failureAnnounced,
      locationAnnounced: this.locationAnnounced,
    };
  }

  /** Snapshot of the current ring buffer (oldest first). */
  getEntries(): LogEntry[] {
    return [...this.ring];
  }

  /**
   * Subscribe to log events. The callback receives each new {@link LogEntry},
   * or `null` when the buffer is cleared. Returns an unsubscribe fn.
   */
  subscribe(cb: (entry: LogEntry | null) => void): () => void {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  clear(): void {
    this.ring = [];
    for (const cb of this.subscribers) {
      try {
        cb(null);
      } catch {
        /* subscriber errors never break logging */
      }
    }
  }

  private record(level: LogLevel, category: string, message: string): void {
    // WP81 AC6 — state the resolved path once per session (and again after a
    // relocation), before the first real line, so the file's own first entry
    // names the file, and so does the ring buffer.
    if (this.enabled && !this.locationAnnounced) this.announceLocation();

    const ts = new Date().toISOString();
    const entry: LogEntry = { ts, level, category, message };

    // Ring buffer (bounded) + live fan-out, gated by the ring/view level.
    if (LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[this.minLevel]) this.pushRing(entry);

    // File sink, gated by `enabled` and by the file sink's OWN level. WP81:
    // deliberately not gated by `minLevel` — that one is reachable from a view
    // control (see `setLevel`).
    if (this.enabled && LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[this.fileMinLevel]) {
      this.pushFile(entry);
      this.scheduleFlush();
    }
  }

  /** Ring buffer + subscriber fan-out. Behaviourally unchanged (RING_CAP, fan-out). */
  private pushRing(entry: LogEntry): void {
    this.ring.push(entry);
    if (this.ring.length > RING_CAP) this.ring.shift();
    for (const cb of this.subscribers) {
      try {
        cb(entry);
      } catch {
        /* subscriber errors never break logging */
      }
    }
  }

  private pushFile(entry: LogEntry): void {
    this.buffer.push(
      `${entry.ts} [${entry.level.toUpperCase()}] [${entry.category}] ${entry.message}`,
    );
  }

  /**
   * WP81 AC6 — one statement per session naming the resolved path. It goes to
   * BOTH channels and bypasses both level gates: it is the sink describing
   * itself, not application logging, and it is unreadable in exactly the case
   * it exists for (the reader cannot find the file) if it only reaches the file.
   */
  private announceLocation(): void {
    this.locationAnnounced = true;
    const ts = new Date().toISOString();
    const entry: LogEntry = {
      ts,
      level: "info",
      category: SINK_CATEGORY,
      message: `LOG SINK: writing to ${this.logPath}`,
    };
    this.pushRing(entry);
    this.pushFile(entry);
  }

  /**
   * WP81 AC2 — announce a write failure once, on a channel that does not depend
   * on the failing sink, then only count. A `Notice` per failed flush would be
   * two toasts a second forever at FLUSH_DELAY_MS; that is a worse defect than
   * the silence it replaces. A later success re-arms the announcement.
   */
  private announceFailure(reason: string): void {
    this.failureAnnounced = true;
    const message = `LOG SINK: cannot write to ${this.logPath}: ${reason} (further failures are counted, not announced)`;
    this.pushRing({
      ts: new Date().toISOString(),
      level: "error",
      category: SINK_CATEGORY,
      message,
    });
    try {
      this.notify?.(`Live Share: debug log write failed — ${message}`);
    } catch {
      /* a failing notifier must not break logging */
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, FLUSH_DELAY_MS);
  }

  flush(): void {
    // One append in flight at a time: keeps line order, and keeps a retry from
    // racing the write it is retrying.
    if (this.writing) return;
    if (this.buffer.length === 0) return;

    // WP81 AC3 — the batch leaves `buffer` but stays accounted for in
    // `inFlight` until the append RESOLVES. It is never dropped on the strength
    // of a write whose outcome is unknown.
    const batch = this.buffer;
    this.buffer = [];
    this.inFlight = batch;
    this.writing = true;

    const path = this.logPath;
    const text = `${batch.join("\n")}\n`;

    void Promise.resolve(this.vault.adapter.append(path, text)).then(
      () => this.onWriteSettled(path, batch, null),
      (err: unknown) => this.onWriteSettled(path, batch, err ?? new Error("unknown write error")),
    );
  }

  private onWriteSettled(path: string, batch: string[], err: unknown): void {
    this.writing = false;
    this.inFlight = [];
    this.lastWritePath = path;

    if (err === null) {
      this.lastWriteOk = true;
      this.linesWritten += batch.length;
      this.failureCount = 0;
      this.lastError = null;
      // Recovery re-arms the announcement: a sink that heals and fails again
      // says so again.
      this.failureAnnounced = false;
      if (this.buffer.length > 0) this.scheduleFlush();
      return;
    }

    this.lastWriteOk = false;
    this.failureCount += 1;
    const reason = (stringifyError(err) || "unknown write error").slice(0, MAX_ERROR_CHARS);
    this.lastError = { message: reason, ts: new Date().toISOString() };

    // Put the unwritten lines back at the FRONT of the buffer, bounded. The
    // next log line retries them; a failure does NOT reschedule by itself,
    // which would spin at 500 ms intervals forever on a dead path.
    this.buffer = batch.concat(this.buffer);
    if (this.buffer.length > PENDING_CAP) {
      const overflow = this.buffer.length - PENDING_CAP;
      this.buffer.splice(0, overflow);
      this.linesDropped += overflow;
    }

    if (!this.failureAnnounced) this.announceFailure(reason);
  }

  destroy(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
    this.subscribers.clear();
  }
}
