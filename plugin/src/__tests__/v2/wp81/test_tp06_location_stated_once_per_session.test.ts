import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DebugLogger } from "../../../debug-logger";
import { makeVault, settle, writtenLines } from "./harness";

/**
 * WP81 AC6 — the location is stated once per session, so nobody has to guess
 * again.
 *
 * The failure this exists for is "the log is fine, you are reading the wrong
 * file". Stating it only in the file would make it unreadable in exactly that
 * case, so it goes to the ring buffer too — the one channel that keeps working
 * when the file sink does not.
 */
const LOCATION = /LOG SINK: writing to (.+)$/;

function locationLines(lines: string[]): string[] {
  return lines.filter((l) => LOCATION.test(l));
}

describe("WP81 AC6 — the sink states where it is writing", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("names the resolved path exactly once, as the first line in the file", async () => {
    const vault = makeVault();
    const logger = new DebugLogger(vault as never, ".obsidian/live-share-debug.md", true);

    logger.log("c", "one");
    vi.advanceTimersByTime(500);
    await settle();
    logger.log("c", "two");
    logger.warn("c", "three");
    vi.advanceTimersByTime(500);
    await settle();

    const landed = writtenLines(vault);
    const stated = locationLines(landed);
    expect(stated).toHaveLength(1);
    expect(stated[0]).toContain(".obsidian/live-share-debug.md");
    expect(landed[0]).toBe(stated[0]);

    logger.destroy();
  });

  it("puts the same statement in the ring buffer, which does not depend on the file sink", async () => {
    const vault = makeVault();
    vault.fake.failing = true;
    const logger = new DebugLogger(vault as never, ".obsidian/live-share-debug.md", true);

    logger.log("c", "one");
    vi.advanceTimersByTime(500);
    await settle();

    // Nothing reached the file at all...
    expect(writtenLines(vault)).toHaveLength(0);
    // ...and the reader can still find out which file was meant.
    const ringStatements = logger
      .getEntries()
      .filter((e) => e.category === "log-sink" && LOCATION.test(e.message));
    expect(ringStatements).toHaveLength(1);
    expect(ringStatements[0].message).toContain(".obsidian/live-share-debug.md");
    expect(ringStatements[0].level).toBe("info");

    logger.destroy();
  });

  it("is not emitted per flush", async () => {
    const vault = makeVault();
    const logger = new DebugLogger(vault as never, "debug.md", true);

    for (let i = 0; i < 8; i++) {
      logger.log("c", `line ${i}`);
      vi.advanceTimersByTime(500);
      await settle();
    }

    expect(locationLines(writtenLines(vault))).toHaveLength(1);
    expect(vault.fake.written.length).toBeGreaterThan(1);

    logger.destroy();
  });

  it("says nothing while the sink is disabled — disabled is not a location", async () => {
    const vault = makeVault();
    const logger = new DebugLogger(vault as never, "debug.md", false);

    logger.log("c", "one");
    vi.advanceTimersByTime(500);
    await settle();

    expect(logger.getEntries().filter((e) => LOCATION.test(e.message))).toHaveLength(0);
    expect(logger.getSinkState().locationAnnounced).toBe(false);

    logger.destroy();
  });

  it("states the new location when the path moves — the case that cost a day", async () => {
    const vault = makeVault();
    const logger = new DebugLogger(vault as never, "live-share-debug.md", true);

    logger.log("c", "before the move");
    vi.advanceTimersByTime(500);
    await settle();

    logger.updateSettings(true, ".obsidian/live-share-debug.md");
    logger.log("c", "after the move");
    vi.advanceTimersByTime(500);
    await settle();

    const stated = locationLines(writtenLines(vault));
    expect(stated).toHaveLength(2);
    expect(stated[0]).toContain("live-share-debug.md");
    expect(stated[1]).toContain(".obsidian/live-share-debug.md");

    // And the ring holds both, so a reader of the OLD file is not stranded.
    const ringStatements = logger.getEntries().filter((e) => LOCATION.test(e.message));
    expect(ringStatements).toHaveLength(2);

    logger.destroy();
  });

  it("states the location when logging is turned on mid-session", async () => {
    const vault = makeVault();
    const logger = new DebugLogger(vault as never, "debug.md", false);

    logger.log("c", "not written");
    vi.advanceTimersByTime(500);
    await settle();
    expect(vault.fake.attempted).toHaveLength(0);

    logger.updateSettings(true, "debug.md");
    logger.log("c", "written");
    vi.advanceTimersByTime(500);
    await settle();

    expect(locationLines(writtenLines(vault))).toHaveLength(1);

    logger.destroy();
  });
});
