import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DebugLogger, LOG_LEVELS } from "../../../debug-logger";
import { makeVault, settle, writtenLines } from "./harness";

/**
 * WP81 AC4 — a VIEW filter never mutes the FILE sink.
 *
 * `LogView`'s level dropdown used to call `DebugLogger.setLevel`, which gated
 * `record()` above the file-sink push: choosing WARN in the status console
 * stopped INFO and DEBUG lines reaching the debug log for the rest of the
 * session, with nothing saying so. It is not persisted, so it healed on the
 * next reload — the exact shape of "the log stopped and later came back".
 *
 * The vacuous version asserts only `debug`, which is the dropdown's default and
 * passes against the unrepaired build. The discriminating rows are the
 * restrictive ones.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../../..");

describe("WP81 AC4 — the view filter is a view filter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  for (const viewLevel of LOG_LEVELS) {
    it(`file sink still receives debug + info with the view level at "${viewLevel}"`, async () => {
      const vault = makeVault();
      const logger = new DebugLogger(vault as never, "debug.md", true);

      // Exactly what the dropdown handler used to do.
      logger.setLevel(viewLevel);

      logger.debug("c", "a debug line");
      logger.log("c", "an info line");
      vi.advanceTimersByTime(500);
      await settle();

      const landed = writtenLines(vault);
      expect(landed.some((l) => l.includes("a debug line"))).toBe(true);
      expect(landed.some((l) => l.includes("an info line"))).toBe(true);

      // The file sink's own effective level is untouched by any view action.
      expect(logger.getSinkState().fileLevel).toBe("debug");
      expect(logger.getSinkState().ringLevel).toBe(viewLevel);

      logger.destroy();
    });
  }

  it("the ring buffer still honours setLevel — the view's own filtering is unchanged", () => {
    const vault = makeVault();
    const logger = new DebugLogger(vault as never, "debug.md", false);
    logger.setLevel("warn");
    logger.debug("c", "d");
    logger.log("c", "i");
    logger.warn("c", "w");
    logger.error("c", "e");
    expect(logger.getEntries().map((entry) => entry.level)).toEqual(["warn", "error"]);
    logger.destroy();
  });

  it("the file sink has its own level, which only a non-view caller can move", async () => {
    const vault = makeVault();
    const logger = new DebugLogger(vault as never, "debug.md", true);

    logger.setFileLevel("warn");
    logger.debug("c", "suppressed");
    logger.warn("c", "kept");
    vi.advanceTimersByTime(500);
    await settle();

    const landed = writtenLines(vault);
    expect(landed.some((l) => l.includes("suppressed"))).toBe(false);
    expect(landed.some((l) => l.includes("kept"))).toBe(true);
    expect(logger.getSinkState().fileLevel).toBe("warn");

    logger.destroy();
  });

  it("LogView's level control no longer reaches into the logger's level", () => {
    const source = readFileSync(resolve(SRC, "session/log-view.ts"), "utf8");
    // The view reads the logger's level as an initial display default...
    expect(source).toContain("getLevel()");
    // ...and never writes it.
    expect(source).not.toMatch(/\.setLevel\(/);
    // Its own display filter — which is correct and is not the subject — stays.
    expect(source).toContain("LOG_LEVEL_ORDER[entry.level] < LOG_LEVEL_ORDER[this.filterLevel]");
  });
});
