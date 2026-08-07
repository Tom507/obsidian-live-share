import { describe, expect, it, vi } from "vitest";
import { ManifestManager } from "../../../files/manifest";
import { DEFAULT_SETTINGS, type LiveShareSettings } from "../../../types";

/**
 * S115 — WHY `isSharedPath` IS THE WRONG PREDICATE TO SCOPE A DELETION WITH.
 *
 * ⚠ STATUS: this file is the DIAGNOSIS, kept as the record of what the defect
 * was and how large it was. It is NOT a specification of current behaviour, and
 * it must not be read as one. `cleanupStaleFiles` no longer uses this
 * predicate: it scopes its candidate set to the root the HOST publishes on the
 * manifest attestation, and refuses outright when no host has stated one. The
 * fix and the executed trash loop live in
 * `test_s115_stale_reconcile_is_scoped_by_the_host.test.ts`.
 *
 * Every assertion below remains TRUE and remains a correct statement about
 * `ManifestManager.isSharedPath`, which is unchanged: it still answers from the
 * local `sharedFolder`, because "what do I publish?" is the question it exists
 * to answer. What changed is that the reconcile stopped asking it. That is why
 * the rows are kept rather than deleted — they measure the SIZE of the gap
 * between the two questions, which is the whole argument for separating them,
 * and they would redden if anyone ever widened `isSharedPath` itself.
 *
 * Historical description of the defect follows, at `main.ts:1672`
 * (`cleanupStaleFiles`), AS IT WAS:
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

/**
 * The candidate-set computation AS IT WAS, transcribed from the pre-fix
 * `main.ts:1670-1676`. Retained deliberately in its historical form: the point
 * of every row below is what THIS rule selected. The current rule takes a host
 * root as a parameter and is exercised for real — not transcribed — in the
 * companion file.
 */
function staleCandidatesUnderTheOldRule(manager: ManifestManager, vaultPaths: string[]): string[] {
  return vaultPaths.filter((p) => manager.isSharedPath(p)).filter((p) => !HOST_MANIFEST.has(p));
}

describe("S115 (DIAGNOSIS) — `isSharedPath` answers from the LOCAL setting, so it cannot scope a deletion", () => {
  it("🚨 with the shipped default (empty), every private note was a trash candidate", () => {
    const candidates = staleCandidatesUnderTheOldRule(managerFor("", GUEST_VAULT), GUEST_VAULT);
    // This WAS the list `cleanupStaleFiles` handed to `trashFile`, one by one.
    // It no longer is — the host's published root scopes it now — but the
    // predicate still selects exactly this, which is why it had to stop being
    // the reconcile's filter rather than merely being patched.
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
    const candidates = staleCandidatesUnderTheOldRule(
      managerFor("_liveshare-test", GUEST_VAULT),
      GUEST_VAULT,
    );
    expect(candidates).toEqual([]);
  });

  it("a guest whose folder DIFFERS from the host's trashes that folder's contents", () => {
    // Not only the empty case: any mismatch reconciles the guest's own scope
    // against a manifest that was never about it.
    const candidates = staleCandidatesUnderTheOldRule(
      managerFor("Journal", GUEST_VAULT),
      GUEST_VAULT,
    );
    expect(candidates).toEqual(["Journal/2026-08-07.md", "Journal/2026-08-06.md"]);
  });

  it("the dataloss fixture pinned the SAFE configuration only — why this was invisible", () => {
    // `test_stale_reconcile_evidence_gate.test.ts:26` hardcodes
    // `sharedFolder: "shared"`. Before S115 every assertion in that file was
    // about whether the reconcile RUNS; none was about what it selects once it
    // does. The dangerous value was never in the fixture, so no green there
    // could have failed for this reason. Recorded as a property of the suite,
    // not a jab — and the missing dimension has since been added to that file
    // (`describe("S115 — the attestation states the scope …")`), so the gap
    // this row describes is closed rather than merely noted.
    const safe = staleCandidatesUnderTheOldRule(managerFor("shared", GUEST_VAULT), GUEST_VAULT);
    const shipped = staleCandidatesUnderTheOldRule(managerFor("", GUEST_VAULT), GUEST_VAULT);
    expect(safe).toEqual([]);
    expect(shipped.length).toBeGreaterThan(0);
  });
});
