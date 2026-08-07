import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { ManifestManager } from "../../../files/manifest";
import { DEFAULT_SETTINGS, type LiveShareSettings } from "../../../types";
import { ENTIRE_VAULT_WARNING, sharesEntireVault } from "../../../ui/settings";

/**
 * UX01 — the warning the settings UI shows for an empty "Shared folder" field,
 * and the confirmation `startSession` gates on, must keep saying something TRUE.
 *
 * The oracle here is a RELATIONSHIP, not a value. `sharesEntireVault` is a
 * second predicate sitting beside `ManifestManager.isSharedPath`'s empty-folder
 * branch, and two predicates that agree on the day they were written is exactly
 * the defect shape WP81 was chartered against. So the test does not assert
 * "empty means everything" as a remembered fact — it asks the MANIFEST, at run
 * time, and requires the UI predicate to agree with the answer it gives.
 *
 * If someone later makes an empty `sharedFolder` fail CLOSED (share nothing),
 * these tests go red rather than leaving a warning in the UI that frightens the
 * user about something that no longer happens.
 */

function createSettings(overrides: Partial<LiveShareSettings> = {}): LiveShareSettings {
  return { ...DEFAULT_SETTINGS, roomId: "test-room", role: "host", ...overrides };
}

function createVault() {
  return {
    getFiles: vi.fn(() => []),
    getAllLoadedFiles: vi.fn(() => []),
    getAbstractFileByPath: vi.fn((): Record<string, unknown> | null => null),
    read: vi.fn(async () => ""),
    readBinary: vi.fn(async () => new ArrayBuffer(0)),
    modify: vi.fn(async () => {}),
    create: vi.fn(async () => ({})),
    createFolder: vi.fn(async () => ({})),
    adapter: { exists: vi.fn(async () => false) },
  };
}

function manifestFor(sharedFolder: string): ManifestManager {
  const settings = createSettings({ sharedFolder });
  const manager = new ManifestManager(createVault() as never, settings as never);
  // A doc is needed only so the manager is not in its torn-down state; every
  // assertion below is on `isSharedPath`, which reads `settings` directly.
  void new Y.Doc();
  return manager;
}

const ORDINARY_NOTES = [
  "Inbox/today.md",
  "Journal/2026/08/07.md",
  "attachments/diagram.png",
  "Board.canvas",
  "note at root.md",
];

describe("UX01 — an empty shared folder shares the ENTIRE vault", () => {
  let emptyManifest: ManifestManager;
  let scopedManifest: ManifestManager;

  beforeEach(() => {
    emptyManifest = manifestFor("");
    scopedManifest = manifestFor("_liveshare-test");
  });

  it("the manifest admits every ordinary note when the field is empty", () => {
    for (const path of ORDINARY_NOTES) {
      expect(emptyManifest.isSharedPath(path), `${path} should be shared`).toBe(true);
    }
  });

  it("the UI predicate agrees with what the manifest actually does", () => {
    // The relationship, asserted in both directions rather than restated.
    for (const folder of ["", "   ", "_liveshare-test", "Projects/Shared"]) {
      const manifestSharesEverything = ORDINARY_NOTES.every((p) =>
        manifestFor(folder).isSharedPath(p),
      );
      expect(
        sharesEntireVault(folder),
        `sharesEntireVault(${JSON.stringify(folder)}) must match the manifest`,
      ).toBe(manifestSharesEverything);
    }
  });

  it("a scoped folder keeps everything outside it out of the session", () => {
    for (const path of ORDINARY_NOTES) {
      expect(scopedManifest.isSharedPath(path), `${path} must NOT be shared`).toBe(false);
    }
    expect(scopedManifest.isSharedPath("_liveshare-test/note.md")).toBe(true);
    expect(scopedManifest.isSharedPath("_liveshare-test")).toBe(true);
  });

  it("the warning names the consequence, not just the setting", () => {
    // A warning that says "the whole vault is shared" and stops there does not
    // tell the user the part that costs them something: inbound deletes and
    // renames land on their own files.
    expect(ENTIRE_VAULT_WARNING).toMatch(/ENTIRE vault/);
    expect(ENTIRE_VAULT_WARNING.toLowerCase()).toMatch(/delet/);
    expect(ENTIRE_VAULT_WARNING.toLowerCase()).toMatch(/renam/);
  });

  it("whitespace is empty — a field holding only spaces is not a folder", () => {
    expect(sharesEntireVault("   ")).toBe(true);
    expect(sharesEntireVault("\t")).toBe(true);
    expect(sharesEntireVault("a")).toBe(false);
  });

  /**
   * S114 — the defect this relationship test actually caught.
   *
   * `isSharedPath` decided "is a folder configured?" with `!sharedFolder`, an
   * UNTRIMMED emptiness test. `"   "` is truthy, so it took the scoped branch
   * and built the prefix `"   /"`, which nothing matches. The session came up
   * connected, published an empty manifest and shared NOT ONE FILE, in silence.
   *
   * Written as its own case rather than folded into the relationship above so
   * the regression has a name: if the trim is removed, this line says what
   * broke and what the user would have seen.
   */
  it("S114 — a whitespace-only folder shares EVERYTHING, not nothing", () => {
    const whitespace = manifestFor("   ");
    for (const path of ORDINARY_NOTES) {
      expect(
        whitespace.isSharedPath(path),
        `${path}: a whitespace folder must not silently share nothing`,
      ).toBe(true);
    }
    expect(manifestFor("\t\n ").isSharedPath("Inbox/today.md")).toBe(true);
  });

  it("S114 — surrounding whitespace on a REAL folder still scopes to that folder", () => {
    // The other half of the trim: `" _liveshare-test "` must behave as
    // `"_liveshare-test"`, not as "share everything" and not as "share nothing".
    const padded = manifestFor("  _liveshare-test  ");
    expect(padded.isSharedPath("_liveshare-test/note.md")).toBe(true);
    expect(padded.isSharedPath("Inbox/today.md")).toBe(false);
  });
});
