import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../../types";
import { resolveDebugLogPath } from "../../../ui/settings";

/**
 * WP81 AC5 — clearing the log-path setting cannot silently move the log back
 * into the vault root.
 *
 * The oracle asserts a RELATIONSHIP, not a value: the fallback IS the default.
 * Hardcoding `.obsidian/live-share-debug.md` here would reproduce the very
 * defect being fixed — two independent literals that agree today — inside the
 * test.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../../..");

describe("WP81 AC5 — the cleared field falls back to the default, by reference", () => {
  const original = DEFAULT_SETTINGS.debugLogPath;
  afterEach(() => {
    DEFAULT_SETTINGS.debugLogPath = original;
  });

  it("an empty or whitespace field resolves to whatever the default currently is", () => {
    expect(resolveDebugLogPath("")).toBe(DEFAULT_SETTINGS.debugLogPath);
    expect(resolveDebugLogPath("   ")).toBe(DEFAULT_SETTINGS.debugLogPath);
  });

  it("perturbing the default moves the fallback with it", () => {
    DEFAULT_SETTINGS.debugLogPath = "some/other/location.md";
    expect(resolveDebugLogPath("")).toBe("some/other/location.md");

    DEFAULT_SETTINGS.debugLogPath = ".obsidian/elsewhere.md";
    expect(resolveDebugLogPath("")).toBe(".obsidian/elsewhere.md");
  });

  it("never resolves to the pre-7754ac6 vault-root literal while the default is elsewhere", () => {
    expect(resolveDebugLogPath("")).not.toBe("live-share-debug.md");
  });

  it("a non-empty value is used verbatim, trimmed", () => {
    expect(resolveDebugLogPath("  custom/path.md  ")).toBe("custom/path.md");
  });

  it("the settings UI holds no second path literal to diverge from the default", () => {
    const source = readFileSync(resolve(SRC, "ui/settings.ts"), "utf8");
    expect(source).not.toMatch(/"live-share-debug\.md"/);
    expect(source).toContain("DEFAULT_SETTINGS.debugLogPath");
  });
});
