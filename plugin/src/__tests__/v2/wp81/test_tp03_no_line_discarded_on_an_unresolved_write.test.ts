import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DebugLogger } from "../../../debug-logger";
import { makeVault, settle, writtenLines } from "./harness";

/**
 * WP81 AC3 — no line is discarded on the strength of a write that has not
 * succeeded, and the retained set is bounded.
 *
 * Every assertion here is made AFTER the rejection has settled. Asserting
 * synchronously right after `flush()` passes against the unrepaired body too,
 * because a `Promise` rejection is a microtask that has not been delivered yet
 * — that is the vacuous version of this criterion.
 */
describe("WP81 AC3 — lines survive a failed write, and the retained set is bounded", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps the lines pending after a REJECTED flush has settled", async () => {
    const vault = makeVault();
    const logger = new DebugLogger(vault as never, "debug.md", true);

    vault.fake.failing = true;
    logger.log("c", "alpha");
    logger.log("c", "beta");
    vi.advanceTimersByTime(500);
    await settle();

    const state = logger.getSinkState();
    expect(state.linesWritten).toBe(0);
    // The location statement + the two lines are all still accounted for.
    expect(state.linesPending).toBe(3);
    expect(state.linesDropped).toBe(0);
    expect(writtenLines(vault)).toHaveLength(0);

    logger.destroy();
  });

  it("writes the previously failed lines once the sink recovers", async () => {
    const vault = makeVault();
    const logger = new DebugLogger(vault as never, "debug.md", true);

    vault.fake.failing = true;
    logger.log("c", "alpha");
    logger.log("c", "beta");
    vi.advanceTimersByTime(500);
    await settle();
    expect(writtenLines(vault)).toHaveLength(0);

    vault.fake.failing = false;
    logger.log("c", "gamma");
    vi.advanceTimersByTime(500);
    await settle();

    const landed = writtenLines(vault);
    expect(landed.some((l) => l.includes("alpha"))).toBe(true);
    expect(landed.some((l) => l.includes("beta"))).toBe(true);
    expect(landed.some((l) => l.includes("gamma"))).toBe(true);
    // Order is preserved: the retry goes back to the FRONT of the buffer.
    expect(landed.findIndex((l) => l.includes("alpha"))).toBeLessThan(
      landed.findIndex((l) => l.includes("beta")),
    );
    expect(landed.findIndex((l) => l.includes("beta"))).toBeLessThan(
      landed.findIndex((l) => l.includes("gamma")),
    );

    logger.destroy();
  });

  it("never believes it wrote more lines than it actually wrote", async () => {
    const vault = makeVault();
    const logger = new DebugLogger(vault as never, "debug.md", true);

    // Alternate failing and succeeding flushes.
    for (let i = 0; i < 10; i++) {
      vault.fake.failing = i % 2 === 0;
      logger.log("c", `line ${i}`);
      vi.advanceTimersByTime(500);
      await settle();
      expect(logger.getSinkState().linesWritten).toBe(writtenLines(vault).length);
    }

    logger.destroy();
  });

  it("bounds the retained set: a burst past the cap drops the OLDEST and COUNTS the loss", async () => {
    const vault = makeVault();
    const logger = new DebugLogger(vault as never, "debug.md", true);

    vault.fake.failing = true;
    const burst = 600;
    for (let i = 0; i < burst; i++) logger.log("c", `burst ${i}`);
    vi.advanceTimersByTime(500);
    await settle();

    const emitted = burst + 1; // + the once-per-session location statement
    const state = logger.getSinkState();
    // Bounded — driven past the cap, not read off a constant.
    expect(state.linesPending).toBeLessThan(emitted);
    expect(state.linesWritten).toBe(0);
    // Nothing vanishes unaccounted for: pending + dropped = everything emitted.
    expect(state.linesPending + state.linesDropped).toBe(emitted);
    expect(state.linesDropped).toBeGreaterThan(0);

    // A second burst does not grow the retained set any further.
    const boundedAt = state.linesPending;
    for (let i = 0; i < burst; i++) logger.log("c", `burst2 ${i}`);
    vi.advanceTimersByTime(500);
    await settle();

    const after = logger.getSinkState();
    expect(after.linesPending).toBe(boundedAt);
    expect(after.linesPending + after.linesDropped).toBe(emitted + burst);

    // The oldest went, the newest stayed.
    vault.fake.failing = false;
    logger.log("c", "recovered");
    vi.advanceTimersByTime(500);
    await settle();
    const landed = writtenLines(vault);
    expect(landed.some((l) => l.includes("burst 0"))).toBe(false);
    expect(landed.some((l) => l.includes(`burst2 ${burst - 1}`))).toBe(true);

    logger.destroy();
  });

  it("does not spin: a permanently failing sink attempts one write per flush, not a retry loop", async () => {
    const vault = makeVault();
    const logger = new DebugLogger(vault as never, "debug.md", true);

    vault.fake.failing = true;
    logger.log("c", "m");
    vi.advanceTimersByTime(500);
    await settle();
    const afterFirst = vault.fake.attempted.length;
    expect(afterFirst).toBe(1);

    // 30 seconds of wall clock with no new log lines: no further attempts.
    vi.advanceTimersByTime(30_000);
    await settle();
    expect(vault.fake.attempted).toHaveLength(afterFirst);

    logger.destroy();
  });
});
