import { describe, expect, it, vi } from "vitest";
import { ManifestManager } from "../../../files/manifest";
import { DEFAULT_SETTINGS, type LiveShareSettings } from "../../../types";

/**
 * S115 — a GUEST's stale reconcile takes its candidate set from the GUEST's own
 * `sharedFolder`, which ships EMPTY.
 *
 * `main.ts:1672` (`cleanupStaleFiles`):
 *
 *     const localFiles = this.app.vault
 *       .getFiles()
 *       .filter((file) => this.manifestManager.isSharedPath(file.path));
 *     const stale = localFiles.filter((f) => !manifestPaths.has(canonical(f.path)));
 *     for (const file of stale) await this.app.fileManager.trashFile(file);
 *
 * `isSharedPath` reads `this.settings.sharedFolder` — the LOCAL peer's setting.
 * Nothing in `session/` or `sync/` ever writes `sharedFolder` (a census of the
 * whole tree finds it read in exactly one predicate and written only by the
 * settings UI), so **joining a session does not adopt the host's shared folder.**
 * A guest who never opened the setting therefore reconciles their ENTIRE VAULT
 * against a manifest describing only the host's shared subfolder.
 *
 * WHAT THIS TEST DEMONSTRATES: the candidate set — the exact list handed to the
 * trash loop. It is computed here with the real `ManifestManager` and the real
 * predicate.
 *
 * WHAT IT DOES NOT DEMONSTRATE: the `trashFile` calls themselves. That loop is
 * an unconditional `for` over the list this test produces, read at `main.ts:1680`,
 * not executed here. Stated so the two are not conflated.
 *
 * The four floors above it (`role === "host"`, a fresh publication, a live host,
 * a non-empty manifest) are all satisfied by an ordinary join and none of them
 * constrains the candidate set.
 */

function createVault(paths: string[]) {
  const files = paths.map((path) => ({ path, stat: { size: 0, mtime: 0, ctime: 0 } }));
  return {
    getFiles: vi.fn(() => files),
    getAllLoadedFiles: vi.fn(() => files),
    getAbstractFileByPath: vi.fn((): Record<string, unknown> | null => null),
    read: vi.fn(async () => ""),
    readBinary: vi.fn(async () => new ArrayBuffer(0)),
    modify: vi.fn(async () => {}),
    create: vi.fn(async () => ({})),
    createFolder: vi.fn(async () => ({})),
    adapter: { exists: vi.fn(async () => false) },
  };
}

function managerFor(sharedFolder: string, paths: string[]): ManifestManager {
  const settings: LiveShareSettings = { ...DEFAULT_SETTINGS, sharedFolder, role: "guest" };
  return new ManifestManager(createVault(paths) as never, settings as never);
}

/** The guest's own vault: private notes plus the folder the host actually shares. */
const GUEST_VAULT = [
  "Journal/2026-08-07.md",
  "Journal/2026-08-06.md",
  "Taxes/2025 return.md",
  "Thesis/chapter 3.md",
  "attachments/passport.png",
  "_liveshare-test/shared note.md",
];

/** What the host published — only the shared subfolder. */
const HOST_MANIFEST = new Set(["_liveshare-test/shared note.md"]);

/** The candidate-set computation, transcribed from `main.ts:1670-1676`. */
function staleCandidates(manager: ManifestManager, vaultPaths: string[]): string[] {
  return vaultPaths.filter((p) => manager.isSharedPath(p)).filter((p) => !HOST_MANIFEST.has(p));
}

describe("S115 — the guest's stale-reconcile candidate set follows the GUEST's setting", () => {
  it("🚨 with the shipped default (empty), every private note is a trash candidate", () => {
    const candidates = staleCandidates(managerFor("", GUEST_VAULT), GUEST_VAULT);
    // This is the list `cleanupStaleFiles` hands to `trashFile`, one by one.
    expect(candidates).toEqual([
      "Journal/2026-08-07.md",
      "Journal/2026-08-06.md",
      "Taxes/2025 return.md",
      "Thesis/chapter 3.md",
      "attachments/passport.png",
    ]);
    expect(candidates).toHaveLength(GUEST_VAULT.length - 1);
    // The one file the host actually shares is the ONLY survivor.
    expect(candidates).not.toContain("_liveshare-test/shared note.md");
  });

  it("with the guest's folder set to the host's, the candidate set is empty", () => {
    // The same vault, the same manifest, one setting different — and nothing is
    // touched. That is the whole distance between the two outcomes.
    const candidates = staleCandidates(managerFor("_liveshare-test", GUEST_VAULT), GUEST_VAULT);
    expect(candidates).toEqual([]);
  });

  it("a guest whose folder DIFFERS from the host's trashes that folder's contents", () => {
    // Not only the empty case: any mismatch reconciles the guest's own scope
    // against a manifest that was never about it.
    const candidates = staleCandidates(managerFor("Journal", GUEST_VAULT), GUEST_VAULT);
    expect(candidates).toEqual(["Journal/2026-08-07.md", "Journal/2026-08-06.md"]);
  });

  it("the existing dataloss fixture pins the SAFE configuration only", () => {
    // `test_stale_reconcile_evidence_gate.test.ts:26` hardcodes
    // `sharedFolder: "shared"`. Every assertion in that file is about whether
    // the reconcile RUNS; none is about what it selects once it does. The
    // dangerous value was never in the fixture, so no green there could have
    // failed for this reason. Recorded as a property of the suite, not a jab.
    const safe = staleCandidates(managerFor("shared", GUEST_VAULT), GUEST_VAULT);
    const shipped = staleCandidates(managerFor("", GUEST_VAULT), GUEST_VAULT);
    expect(safe).toEqual([]);
    expect(shipped.length).toBeGreaterThan(0);
  });
});
