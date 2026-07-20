import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DebugLogger } from "../debug-logger";

function mockVault() {
  return {
    adapter: {
      append: vi.fn().mockResolvedValue(undefined),
    },
  } as any;
}

describe("DebugLogger", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes nothing when disabled", () => {
    const vault = mockVault();
    const logger = new DebugLogger(vault, "debug.md", false);
    logger.log("test", "hello");
    vi.advanceTimersByTime(1000);
    expect(vault.adapter.append).not.toHaveBeenCalled();
    logger.destroy();
  });

  it("batches writes with debounce", () => {
    const vault = mockVault();
    const logger = new DebugLogger(vault, "debug.md", true);
    logger.log("cat1", "msg1");
    logger.log("cat2", "msg2");
    expect(vault.adapter.append).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(vault.adapter.append).toHaveBeenCalledTimes(1);
    const written = vault.adapter.append.mock.calls[0][1] as string;
    expect(written).toContain("[INFO] [cat1] msg1");
    expect(written).toContain("[INFO] [cat2] msg2");
    logger.destroy();
  });

  it("formats error messages with Error objects", () => {
    const vault = mockVault();
    const logger = new DebugLogger(vault, "debug.md", true);
    logger.error("net", "connection failed", new Error("timeout"));
    vi.advanceTimersByTime(500);
    const written = vault.adapter.append.mock.calls[0][1] as string;
    expect(written).toContain("[ERROR] [net] connection failed: timeout");
    logger.destroy();
  });

  it("formats error messages with string errors", () => {
    const vault = mockVault();
    const logger = new DebugLogger(vault, "debug.md", true);
    logger.error("net", "connection failed", "some reason");
    vi.advanceTimersByTime(500);
    const written = vault.adapter.append.mock.calls[0][1] as string;
    expect(written).toContain("[ERROR] [net] connection failed: some reason");
    logger.destroy();
  });

  it("formats error messages without error arg", () => {
    const vault = mockVault();
    const logger = new DebugLogger(vault, "debug.md", true);
    logger.error("net", "connection failed");
    vi.advanceTimersByTime(500);
    const written = vault.adapter.append.mock.calls[0][1] as string;
    expect(written).toContain("[ERROR] [net] connection failed");
    expect(written).not.toContain("connection failed:");
    logger.destroy();
  });

  it("destroy() flushes remaining buffer", () => {
    const vault = mockVault();
    const logger = new DebugLogger(vault, "debug.md", true);
    logger.log("test", "pending");
    expect(vault.adapter.append).not.toHaveBeenCalled();
    logger.destroy();
    expect(vault.adapter.append).toHaveBeenCalledTimes(1);
    const written = vault.adapter.append.mock.calls[0][1] as string;
    expect(written).toContain("[INFO] [test] pending");
  });

  it("updateSettings toggles enabled state", () => {
    const vault = mockVault();
    const logger = new DebugLogger(vault, "debug.md", false);
    logger.log("test", "should not write");
    vi.advanceTimersByTime(500);
    expect(vault.adapter.append).not.toHaveBeenCalled();

    logger.updateSettings(true, "new-path.md");
    logger.log("test", "should write");
    vi.advanceTimersByTime(500);
    expect(vault.adapter.append).toHaveBeenCalledTimes(1);
    expect(vault.adapter.append.mock.calls[0][0]).toBe("new-path.md");
    logger.destroy();
  });

  it("includes ISO timestamp in log lines", () => {
    const vault = mockVault();
    const logger = new DebugLogger(vault, "debug.md", true);
    logger.log("test", "hello");
    vi.advanceTimersByTime(500);
    const written = vault.adapter.append.mock.calls[0][1] as string;
    expect(written).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    logger.destroy();
  });

  it("writes to configured path", () => {
    const vault = mockVault();
    const logger = new DebugLogger(vault, "custom/path.md", true);
    logger.log("test", "hello");
    vi.advanceTimersByTime(500);
    expect(vault.adapter.append.mock.calls[0][0]).toBe("custom/path.md");
    logger.destroy();
  });
});

describe("DebugLogger ring buffer / status console (Phase A)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("records to the in-memory ring even when file logging is disabled", () => {
    const vault = mockVault();
    const logger = new DebugLogger(vault, "debug.md", false);
    logger.log("cat", "hello");
    logger.warn("cat", "careful");
    // No file writes while disabled...
    expect(vault.adapter.append).not.toHaveBeenCalled();
    // ...but the ring buffer is populated for the live console.
    const entries = logger.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ level: "info", category: "cat", message: "hello" });
    expect(entries[1]).toMatchObject({ level: "warn", category: "cat", message: "careful" });
    logger.destroy();
  });

  it("filters below the configured min-level", () => {
    const vault = mockVault();
    const logger = new DebugLogger(vault, "debug.md", false);
    logger.setLevel("warn");
    logger.debug("c", "d");
    logger.log("c", "i");
    logger.warn("c", "w");
    logger.error("c", "e");
    const levels = logger.getEntries().map((e) => e.level);
    expect(levels).toEqual(["warn", "error"]);
    logger.destroy();
  });

  it("fans out new entries to subscribers and null on clear", () => {
    const vault = mockVault();
    const logger = new DebugLogger(vault, "debug.md", false);
    const seen: Array<string | null> = [];
    const unsub = logger.subscribe((e) => seen.push(e === null ? null : e.message));
    logger.log("c", "one");
    logger.log("c", "two");
    logger.clear();
    expect(seen).toEqual(["one", "two", null]);
    expect(logger.getEntries()).toHaveLength(0);
    unsub();
    logger.log("c", "three");
    expect(seen).toEqual(["one", "two", null]); // unsubscribed
    logger.destroy();
  });

  it("caps the ring buffer at 500 entries (oldest dropped)", () => {
    const vault = mockVault();
    const logger = new DebugLogger(vault, "debug.md", false);
    for (let i = 0; i < 520; i++) logger.log("c", `m${i}`);
    const entries = logger.getEntries();
    expect(entries).toHaveLength(500);
    expect(entries[0].message).toBe("m20");
    expect(entries[499].message).toBe("m519");
    logger.destroy();
  });

  it("uppercases the level in the file line for new levels", () => {
    const vault = mockVault();
    const logger = new DebugLogger(vault, "debug.md", true);
    logger.warn("net", "slow");
    vi.advanceTimersByTime(500);
    const written = vault.adapter.append.mock.calls[0][1] as string;
    expect(written).toContain("[WARN] [net] slow");
    logger.destroy();
  });
});
