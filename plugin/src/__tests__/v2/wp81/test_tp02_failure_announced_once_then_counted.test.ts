import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DebugLogger, type LogEntry } from "../../../debug-logger";
import { makeVault, settle } from "./harness";

/**
 * WP81 AC2 — a write failure is recorded, announced ONCE, and not announced
 * again; a recovery re-arms the announcement.
 *
 * The burst is mandatory. Exercising only the first failure cannot distinguish
 * "announces once" from "announces always", and "always" — at FLUSH_DELAY_MS =
 * 500 ms — is a worse defect than the silence it replaces.
 */
function sinkErrors(entries: LogEntry[]): LogEntry[] {
  return entries.filter((e) => e.category === "log-sink" && e.level === "error");
}

describe("WP81 AC2 — announce once, then count", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("announces the first failure once and only counts the next six", async () => {
    const vault = makeVault();
    const notices: string[] = [];
    const logger = new DebugLogger(vault as never, "debug.md", true, (m) => notices.push(m));

    vault.fake.failing = true;

    logger.log("c", "line 0");
    vi.advanceTimersByTime(500);
    await settle();

    // (a) recorded, (b) one ring entry at error level, (c) one Notice.
    let state = logger.getSinkState();
    expect(state.failureCount).toBe(1);
    expect(state.lastError).not.toBeNull();
    expect(state.lastError?.message).toContain("EACCES");
    expect(state.lastWriteOk).toBe(false);
    expect(sinkErrors(logger.getEntries())).toHaveLength(1);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("debug.md");

    // Six more failures.
    for (let i = 1; i <= 6; i++) {
      logger.log("c", `line ${i}`);
      vi.advanceTimersByTime(500);
      await settle();
    }

    state = logger.getSinkState();
    // The counter advanced...
    expect(state.failureCount).toBe(7);
    // ...while the announcement did not.
    expect(notices).toHaveLength(1);
    expect(sinkErrors(logger.getEntries())).toHaveLength(1);

    logger.destroy();
  });

  it("clears the failing state on a success and announces again on a later failure", async () => {
    const vault = makeVault();
    const notices: string[] = [];
    const logger = new DebugLogger(vault as never, "debug.md", true, (m) => notices.push(m));

    vault.fake.failing = true;
    logger.log("c", "fail 1");
    vi.advanceTimersByTime(500);
    await settle();
    expect(notices).toHaveLength(1);

    // Recovery.
    vault.fake.failing = false;
    logger.log("c", "ok 1");
    vi.advanceTimersByTime(500);
    await settle();

    let state = logger.getSinkState();
    expect(state.failureCount).toBe(0);
    expect(state.lastError).toBeNull();
    expect(state.failureAnnounced).toBe(false);
    expect(state.lastWriteOk).toBe(true);

    // Fails again — this must be announced again, or "once" means "once ever,
    // then never again even after it heals".
    vault.fake.failing = true;
    logger.log("c", "fail 2");
    vi.advanceTimersByTime(500);
    await settle();

    state = logger.getSinkState();
    expect(state.failureCount).toBe(1);
    expect(notices).toHaveLength(2);
    expect(sinkErrors(logger.getEntries())).toHaveLength(2);

    logger.destroy();
  });

  it("keeps announcing even though the announcement's own sink is the one failing", async () => {
    const vault = makeVault();
    const notices: string[] = [];
    const logger = new DebugLogger(vault as never, "debug.md", true, (m) => notices.push(m));

    vault.fake.failing = true;
    logger.log("c", "m");
    vi.advanceTimersByTime(500);
    await settle();

    // Nothing reached the file...
    expect(vault.fake.written).toHaveLength(0);
    // ...and the announcement is observable anyway, on both independent channels.
    expect(sinkErrors(logger.getEntries())).toHaveLength(1);
    expect(notices).toHaveLength(1);

    logger.destroy();
  });

  it("survives a notifier that throws", async () => {
    const vault = makeVault();
    const logger = new DebugLogger(vault as never, "debug.md", true, () => {
      throw new Error("Notice unavailable");
    });

    vault.fake.failing = true;
    expect(() => {
      logger.log("c", "m");
      vi.advanceTimersByTime(500);
    }).not.toThrow();
    await settle();

    expect(logger.getSinkState().failureCount).toBe(1);
    expect(sinkErrors(logger.getEntries())).toHaveLength(1);

    logger.destroy();
  });
});
