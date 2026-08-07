import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../types";
import type { FileOp } from "../types";

describe("types", () => {
  it("DEFAULT_SETTINGS has expected shape", () => {
    expect(DEFAULT_SETTINGS.serverUrl).toBe("http://localhost:3000");
    expect(DEFAULT_SETTINGS.roomId).toBe("");
    expect(DEFAULT_SETTINGS.token).toBe("");
    expect(DEFAULT_SETTINGS.displayName).toBe("Anonymous");
    expect(DEFAULT_SETTINGS.cursorColor).toMatch(/^#/);
    expect(DEFAULT_SETTINGS.serverPassword).toBe("");
    expect(DEFAULT_SETTINGS.notificationsEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.debugLogging).toBe(false);
    // Pre-existing red, not this batch's: commit 7754ac6 ("keep the debug log out
    // of the vault root") deliberately moved the default under `.obsidian/` so
    // Obsidian stops indexing the log, and this assertion was not updated with it.
    // Corrected to the shipped value rather than left failing — a red baseline
    // makes any later RED/GREEN evidence unreadable.
    expect(DEFAULT_SETTINGS.debugLogPath).toBe(".obsidian/live-share-debug.md");
    expect(DEFAULT_SETTINGS.autoReconnect).toBe(true);
    expect(DEFAULT_SETTINGS.readOnlyPatterns).toEqual([]);
  });

  it("FileOp union types are assignable", () => {
    const create: FileOp = { type: "create", path: "a.md", content: "" };
    const del: FileOp = { type: "delete", path: "b.md" };
    const rename: FileOp = { type: "rename", oldPath: "c.md", newPath: "d.md" };
    expect(create.type).toBe("create");
    expect(del.type).toBe("delete");
    expect(rename.type).toBe("rename");
  });
});
