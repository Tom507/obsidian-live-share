import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DebugLogger } from "../../../debug-logger";
import { makeVault, settle, writtenLines } from "./harness";

/**
 * WP81 AC1 — the sink can be asked what it is doing, and every field is
 * measured at call time from the sink's own state.
 *
 * The vacuous version of this criterion echoes `settings.debugLogPath`. That
 * value and the sink's own path agree today and would agree after a broken
 * repair, so echoing it proves nothing. The discriminating row is the one case
 * where they can differ: a path changed by `updateSettings` while an append is
 * still in flight.
 */
describe("WP81 AC1 — sink state is measured, not an echo of the setting", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reports path, enabled, file level and a zeroed ledger before anything is written", () => {
    const vault = makeVault();
    const logger = new DebugLogger(vault as never, ".obsidian/live-share-debug.md", true);

    const state = logger.getSinkState();
    expect(state.path).toBe(".obsidian/live-share-debug.md");
    expect(state.enabled).toBe(true);
    expect(state.fileLevel).toBe("debug");
    expect(state.linesWritten).toBe(0);
    expect(state.linesPending).toBe(0);
    expect(state.linesDropped).toBe(0);
    expect(state.lastWritePath).toBeNull();
    expect(state.lastWriteOk).toBeNull();
    expect(state.failureCount).toBe(0);
    expect(state.lastError).toBeNull();

    logger.destroy();
  });

  it("distinguishes DISABLED from FAILING", async () => {
    const vault = makeVault();
    const logger = new DebugLogger(vault as never, "debug.md", false);
    logger.log("c", "m");
    vi.advanceTimersByTime(500);
    await settle();

    const state = logger.getSinkState();
    expect(state.enabled).toBe(false);
    // Disabled is not an error state: nothing was attempted, so nothing failed.
    expect(state.failureCount).toBe(0);
    expect(state.lastError).toBeNull();
    expect(state.lastWriteOk).toBeNull();

    logger.destroy();
  });

  it("advances linesWritten only after the append RESOLVES, and never past what was really written", async () => {
    const vault = makeVault();
    const logger = new DebugLogger(vault as never, "debug.md", true);

    vault.fake.hold = true;
    logger.log("c", "one");
    logger.log("c", "two");
    vi.advanceTimersByTime(500);
    await settle();

    // The append is in flight. Nothing is claimed as written yet.
    expect(logger.getSinkState().linesWritten).toBe(0);
    expect(logger.getSinkState().linesPending).toBeGreaterThan(0);

    for (const r of vault.fake.release) r();
    await settle();

    const state = logger.getSinkState();
    // The sink's belief is exactly the file's reality.
    expect(state.linesWritten).toBe(writtenLines(vault).length);
    expect(state.linesPending).toBe(0);
    expect(state.lastWriteOk).toBe(true);

    logger.destroy();
  });

  it("reports where the last write ACTUALLY went, which can differ from the configured path", async () => {
    const vault = makeVault();
    const logger = new DebugLogger(vault as never, "old-path.md", true);

    vault.fake.hold = true;
    logger.log("c", "in flight");
    vi.advanceTimersByTime(500);
    await settle();

    // Settings change while the append to the OLD path is still open.
    logger.updateSettings(true, "new-path.md");
    for (const r of vault.fake.release) r();
    await settle();

    const state = logger.getSinkState();
    // An echo of `settings.debugLogPath` would report "new-path.md" for both.
    expect(state.path).toBe("new-path.md");
    expect(state.lastWritePath).toBe("old-path.md");
    expect(state.path).not.toBe(state.lastWritePath);

    logger.destroy();
  });

  it("carries the log path and no other settings value", async () => {
    const vault = makeVault();
    const logger = new DebugLogger(vault as never, "debug.md", true);
    logger.log("c", "m");
    vi.advanceTimersByTime(500);
    await settle();

    const state = logger.getSinkState();
    expect(Object.keys(state).sort()).toEqual(
      [
        "enabled",
        "failureAnnounced",
        "failureCount",
        "fileLevel",
        "lastError",
        "lastWriteOk",
        "lastWritePath",
        "linesDropped",
        "linesPending",
        "linesWritten",
        "locationAnnounced",
        "path",
        "ringLevel",
      ].sort(),
    );

    logger.destroy();
  });
});
