// WP92 / C92 AC5 — THE OTHER SIDECAR ARTEFACTS, SURVEYED AND REPORTED.
//
// The brief's question is "do the other sidecar artefacts share this exposure?"
// and it must be answered by a DERIVATION, not by a table in a charter. The
// charter's own reading is an INPUT to be re-measured here, never a result to be
// quoted — and it is re-measured below, and it holds.
//
// DISPOSITION IS FIXED AND IT IS NOT "REPAIR": anything found outside
// `seed-refusals.json` is carried up with its receipt. `index.json` in
// particular is WP24/WP27 territory and is explicitly out of scope; a WP92 line
// in `canvas-sidecar.ts` would be unattributable by construction, since that
// file is under a sibling batch.
//
// THE POSITIVE CONTROL HAS TWO HALVES (S53), and both are shown firing:
//   ├── HALF A — it FINDS a known-present platform-dependent key on the
//   │   pre-repair source (`this.diskPath` reaching the store), and it finds
//   │   BOTH classes of artefact (key-in-filename and key-inside-file), so it
//   │   has demonstrated it can find two rather than one.
//   └── HALF B — an empty input set THROWS instead of reporting a closed class.
//
// ── WHAT WOULD MAKE THIS FILE FAIL ──────────────────────────────────────────
// Add a fifth `SIDECAR_DIR` path builder to `canvas-sidecar.ts` and the pinned
// artefact set reddens. Remove `store.unbind(oldPath)` from `handleRename` and
// the rename-follower derivation reddens on `index.json`'s row. VERIFIED RED by
// deriving over a modified source string, without touching the shared tree.

import { describe, expect, it } from "vitest";

import {
  PRE_REPAIR_HYDRATE,
  deriveRenameFollowers,
  deriveSidecarArtefacts,
  deriveStoreKeyCensus,
  readProductionSources,
} from "./census";

describe("WP92 AC5 — the sidecar artefact census, derived", () => {
  const sources = readProductionSources();
  const sidecar = sources.get("files/canvas-sidecar.ts") as string;
  const canvasSync = sources.get("files/canvas-sync.ts") as string;

  it("every SIDECAR_DIR artefact is enumerated from its own path builder", () => {
    expect(sidecar, "canvas-sidecar.ts was not read").toBeDefined();
    const artefacts = deriveSidecarArtefacts(sidecar);

    // The set, pinned. A fifth artefact reddens here rather than being missed.
    expect(artefacts.map((a) => a.builder)).toEqual([
      "seedRefusalStorePath",
      "sidecarCheckpointPath",
      "sidecarHistoryPath",
      "sidecarIndexPath",
    ]);

    // BOTH CLASSES are present, which is what proves the deriver can find two
    // rather than one (AC5(b)).
    const keyedByFilename = artefacts.filter((a) => a.keyParameter !== null);
    const wholeVaultFiles = artefacts.filter((a) => a.keyParameter === null);
    expect(keyedByFilename.map((a) => a.builder)).toEqual([
      "sidecarCheckpointPath",
      "sidecarHistoryPath",
    ]);
    expect(wholeVaultFiles.map((a) => a.builder)).toEqual([
      "seedRefusalStorePath",
      "sidecarIndexPath",
    ]);

    // The charter's claim, RE-MEASURED: `.yhistory` / `.ycheckpoint` are keyed
    // by the GUID in their filename, so no rename can orphan them and no host
    // spelling can reach them.
    for (const artefact of keyedByFilename) {
      expect(artefact.keyParameter, `${artefact.builder} is not guid-keyed`).toBe("guid");
      expect(
        artefact.template,
        `${artefact.builder} composes its name from something other than the guid`,
      ).toContain("${guid}");
    }
  });

  it("HALF B — an empty / builder-free source THROWS rather than reporting a closed class", () => {
    expect(() => deriveSidecarArtefacts("")).toThrow(/refusing to emit a census/);
    expect(() => deriveSidecarArtefacts("export const x = 1;")).toThrow(/refusing to emit/);
  });

  it("HALF A — the store-key deriver finds the known-present platform-dependent key", () => {
    const found = deriveStoreKeyCensus(
      new Map([["files/canvas-persistence.ts", PRE_REPAIR_HYDRATE]]),
    );
    expect(found.writeKeys, "the deriver cannot see the defect on the tree that HAD it").toEqual([
      "this.diskPath",
    ]);
  });

  it("index.json IS followed on rename; seed-refusals.json now needs no follower", () => {
    const followers = deriveRenameFollowers(canvasSync);

    // Derived from `handleRename`'s own body: the identity store is re-pointed
    // in both directions, bind BEFORE unbind, and `rekeyPathState` moves the
    // in-memory registries — including WP63's ledger map.
    expect(followers, "the identity store is no longer re-pointed on rename").toContain("store.bind");
    expect(followers).toContain("store.unbind");
    expect(followers).toContain("this.rekeyPathState");

    // AND THE FINDING, restated as a measurement: `handleRename` still tells the
    // seed-refusal store NOTHING, and after WP92 it does not need to — the key
    // is not a path, so there is nothing for a rename to re-point. That is the
    // difference between "the orphan is repaired" and "the orphan is patched".
    expect(
      followers.some((f) => /seedRefusal|durableRefusal/i.test(f)),
      "a rename now notifies the store — WP92 chose a key that makes that unnecessary; " +
        "if this is deliberate, canvas-sync.ts left WP92's declared out-of-scope set",
    ).toBe(false);
  });

  it("REDDENS ON A REAL CHANGE — removing unbind from a copy of handleRename is seen", () => {
    // The negative control for the case above, run over a MODIFIED SOURCE STRING
    // so the shared working tree is never touched (rule 14).
    const withoutUnbind = canvasSync.replace(/await store\.unbind\(oldPath\);/, "void oldPath;");
    expect(withoutUnbind, "the substitution did not apply — this control is vacuous").not.toBe(
      canvasSync,
    );
    expect(deriveRenameFollowers(withoutUnbind)).not.toContain("store.unbind");
  });

  it("seed-refusals.json's key expression is derived, and it is no longer a path", () => {
    const census = deriveStoreKeyCensus(sources);
    expect(census.writeKeys).toEqual(["key"]);
    // The one artefact whose keys live INSIDE the file and used to be paths.
    expect(
      census.sites.every((s) => !/toLocalPath|diskPath/.test(s.key) || s.key === "legacyKey"),
      "a path-derived expression still reaches the store as a key",
    ).toBe(true);
  });
});
