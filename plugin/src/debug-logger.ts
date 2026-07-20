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

  constructor(
    private vault: Vault,
    private logPath: string,
    private enabled: boolean,
  ) {}

  updateSettings(enabled: boolean, logPath: string): void {
    this.enabled = enabled;
    this.logPath = logPath;
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
  /** Set the minimum level recorded to the ring buffer, file, and subscribers. */
  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  getLevel(): LogLevel {
    return this.minLevel;
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
    if (LOG_LEVEL_ORDER[level] < LOG_LEVEL_ORDER[this.minLevel]) return;
    const ts = new Date().toISOString();
    const entry: LogEntry = { ts, level, category, message };

    // Ring buffer (bounded) + live fan-out.
    this.ring.push(entry);
    if (this.ring.length > RING_CAP) this.ring.shift();
    for (const cb of this.subscribers) {
      try {
        cb(entry);
      } catch {
        /* subscriber errors never break logging */
      }
    }

    // Best-effort file sink, only when enabled.
    if (this.enabled) {
      this.buffer.push(`${ts} [${level.toUpperCase()}] [${category}] ${message}`);
      this.scheduleFlush();
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
    if (this.buffer.length === 0) return;
    const lines = `${this.buffer.join("\n")}\n`;
    this.buffer = [];
    this.vault.adapter.append(this.logPath, lines).catch(() => {
      // Best-effort logging, discard write failures
    });
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
