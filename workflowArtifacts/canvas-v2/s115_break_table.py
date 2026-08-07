"""S115 / WP96 — Rule 9 falsifiability driver.

For each planted break: copy the target aside, apply an EXACT string
replacement, run the S115 test set, record which rows reddened, restore from the
copy-aside, and verify the restore is byte-identical with sha256. Never
`git checkout`, never `git stash` — a sibling agent shares this working tree.

A break that reddens NOTHING is reported as such, not silently dropped.
"""

import hashlib
import pathlib
import re
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
PLUGIN = ROOT / "plugin"
MAIN = PLUGIN / "src" / "main.ts"
MANIFEST = PLUGIN / "src" / "files" / "manifest.ts"
BGSYNC = PLUGIN / "src" / "files" / "background-sync.ts"
CONFLICT = PLUGIN / "src" / "files" / "conflict-copy.ts"
MIRROR = PLUGIN / "src" / "files" / "canvas-mirror.ts"
YTEXT = PLUGIN / "src" / "files" / "ytext-history.ts"
SYNC = PLUGIN / "src" / "sync" / "sync.ts"

TESTS = [
    "src/__tests__/v2/ux01/test_s115_stale_reconcile_is_scoped_by_the_host.test.ts",
    "src/__tests__/v2/ux01/test_s115_guest_stale_reconcile_candidate_set.test.ts",
    "src/__tests__/dataloss/test_stale_reconcile_evidence_gate.test.ts",
    "src/__tests__/v2/ux01/test_s116_a_guest_only_trashes_what_the_session_gave_it.test.ts",
    "src/__tests__/dataloss/test_s119_empty_text_write_truncates_a_note.test.ts",
    "src/__tests__/dataloss/test_s119_empty_write_floor.test.ts",
    "src/__tests__/dataloss/test_s125_the_guests_version_is_preserved.test.ts",
    "src/__tests__/v2/wp101/test_s123_canvas_mirror_race.test.ts",
    "src/__tests__/dataloss/test_s126_a_real_delete_reaches_a_closed_note.test.ts",
    "src/__tests__/v2/wp103/test_s128_waitforsync_says_why.test.ts",
]

# (id, acceptance criterion, description, [(file, old, new), ...])
BREAKS = [
    (
        "B1",
        "AC2",
        "candidate set filtered by the LOCAL setting again (the original defect)",
        [(MAIN,
          "this.manifestManager.isWithinSharedRoot(file.path, scope.root)",
          "this.manifestManager.isSharedPath(file.path)")],
    ),
    (
        "B2",
        "AC3",
        "an unknown scope is coerced to the permissive default ('' = whole vault)",
        [(MANIFEST,
          'if (typeof pub.sharedRoot !== "string") {',
          'if (typeof pub.sharedRoot !== "string" && false) {'),
         (MANIFEST,
          "return { known: true, root: pub.sharedRoot.trim() };",
          'return { known: true, root: (pub.sharedRoot ?? "").trim() };')],
    ),
    (
        "B3",
        "AC4",
        "the reconcile selects nothing at all (the 'just disable it' non-fix)",
        [(MAIN,
          "(file) => !manifestPaths.has(toCanonicalPath(normalizePath(file.path))),",
          "() => false,")],
    ),
    (
        "B4a",
        "AC5",
        "the success log line is renamed, i.e. the observable stops being emitted",
        # NOTE: re-anchored for S116, which rewrote this line to carry the rule
        # token. The original anchor silently stopped matching, which the driver
        # reported as ANCHOR NOT FOUND rather than as a pass — that distinction
        # is the reason it prints it.
        [(MAIN, "stale reconcile ran [", "stale reconcile XX [")],
    ),
    (
        "B4b",
        "AC5",
        "the decision no longer reports the scope it used",
        # Re-anchored for S116 (the return became a multi-line object literal).
        [(MAIN,
          "      scope: scope.root,\n      rule: STALE_RECONCILE_RULE.RAN,",
          "      scope: null,\n      rule: STALE_RECONCILE_RULE.RAN,")],
    ),
    (
        "B5",
        "AC2/AC6",
        "the HOST stops publishing its shared root on the attestation",
        [(MANIFEST, "        sharedRoot: this.settings.sharedFolder.trim(),\n", "")],
    ),
    (
        "B6",
        "AC2",
        "the remote-root predicate drops the LOCAL safety floors",
        [(MANIFEST,
          "  isWithinSharedRoot(rawPath: string, root: string): boolean {\n"
          "    const path = toCanonicalPath(normalizePath(rawPath));\n"
          "    if (!this.passesLocalSafetyFloors(path)) return false;\n"
          "    return matchesSharedRoot(path, root);",
          "  isWithinSharedRoot(rawPath: string, root: string): boolean {\n"
          "    const path = toCanonicalPath(normalizePath(rawPath));\n"
          "    return matchesSharedRoot(path, root);")],
    ),
    (
        "B7",
        "AC3 (negative control)",
        "the refusal reason text is reworded but the refusal still happens",
        [(MAIN,
          "the host's shared folder is unknown: ",
          "the host's shared directory is not known: ")],
    ),
    # ---- S116 / WP98 ----
    (
        "B8",
        "S116 AC1",
        "the pre-join baseline no longer filters the candidate set",
        [(MAIN,
          "      (file) => !baseline.has(toCanonicalPath(normalizePath(file.path))),",
          "      () => true,")],
    ),
    (
        "B9",
        "S116 AC1/AC4",
        "a missing baseline is treated as permissive instead of refusing",
        [(MAIN,
          "    const baseline = this.vaultBaseline;\n    if (!baseline) {",
          "    const baseline = this.vaultBaseline ?? new Set<string>();\n    if (!baseline && false) {")],
    ),
    (
        "B10",
        "S116 AC3",
        "the whole-vault consent floor is removed",
        [(MAIN,
          'if (scope.root === "" && !this.settings.allowWholeVaultReconcile) {',
          'if (false && scope.root === "" && !this.settings.allowWholeVaultReconcile) {')],
    ),
    (
        "B11",
        "S116 AC3",
        "the consent refusal becomes SILENT (the S114 shape: a quiet degradation)",
        [(MAIN,
          '"Live Share: the host shares their entire vault. Stale-file cleanup is OFF "',
          '"Live Share: cleanup skipped. "')],
    ),
    (
        "B12",
        "S116 AC2",
        "the baseline over-protects everything (the 'just refuse' non-fix)",
        [(MAIN,
          "      (file) => !baseline.has(toCanonicalPath(normalizePath(file.path))),",
          "      () => false,")],
    ),
    (
        "B13",
        "S116 AC5",
        "two distinct refusals collapse onto one rule token",
        [(MAIN,
          "        STALE_RECONCILE_RULE.WHOLE_VAULT_NO_CONSENT,",
          "        STALE_RECONCILE_RULE.NO_BASELINE,")],
    ),
    (
        "B14",
        "S116 wiring",
        "one guest entry point stops capturing the baseline",
        [(MAIN,
          "        // S116 — BEFORE the first reconcile and before `syncFromManifest`.\n        this.captureVaultBaseline();\n",
          "")],
    ),
    # ---- S119 / WP99 : the empty-write floor ----
    (
        "B15",
        "S119 AC3",
        "the manifest writer's empty-write floor is removed (THE INCIDENT)",
        [(MANIFEST,
          '        if (verdict.decision !== EMPTY_WRITE_DECISION.ALLOW) {\n          noteEmptyWriteRefusal("manifest-sync");',
          '        if (false) {\n          noteEmptyWriteRefusal("manifest-sync");')],
    ),
    (
        "B16",
        "S119 AC3",
        "the background-sync writer's empty-write floor is removed (the amplifier)",
        [(BGSYNC,
          '        if (verdict.decision !== EMPTY_WRITE_DECISION.ALLOW) {\n          noteEmptyWriteRefusal("doc-write");',
          '        if (false) {\n          noteEmptyWriteRefusal("doc-write");')],
    ),
    (
        "B17",
        "S119 AC3",
        "the manifest evidence weakens from the host's hash to a bare emptiness test",
        [(MANIFEST,
          "          intentional: (await hashContent(content)) === entry.hash,",
          "          intentional: content.length === 0,")],
    ),
    (
        "B18",
        "S119 AC4",
        "background-sync evidence is always true (the floor becomes inert)",
        # Re-anchored for S126, which replaced the session-local witness with the
        # replicated CRDT tombstone probe.
        [(BGSYNC,
          "          intentional: yTextHeldContent(docText) || this.observedNonEmpty.has(path),",
          "          intentional: true,")],
    ),
    (
        "B19",
        "S119 AC4",
        "evidence is never recorded, so select-all-and-delete stops propagating",
        [(BGSYNC,
          "    if (content.length > 0) this.observedNonEmpty.add(path);",
          "    if (false) this.observedNonEmpty.add(path);")],
    ),
    (
        "B20",
        "S119 AC5",
        "refusals stop being counted, so the floor becomes unobservable",
        [(BGSYNC,
          '          noteEmptyWriteRefusal("doc-write");',
          '          noteEmptyWriteRefusal("doc-write-NOT-COUNTED");')],
    ),
    # ---- S125 / WP99 part 2 : preserve the guest's version ----
    (
        "B21",
        "S125 AC7 (worst blast radius)",
        "the conflicts folder is placed INSIDE the shared folder",
        [(CONFLICT,
          "  return trimmed ? `${trimmed}${CONFLICTS_SUFFIX}` : WHOLE_VAULT_CONFLICTS_ROOT;",
          "  return trimmed ? `${trimmed}/conflicts` : WHOLE_VAULT_CONFLICTS_ROOT;")],
    ),
    (
        "B22",
        "S125 AC6b (worst consequence)",
        "an absent or malformed timestamp DISCARDS instead of preserving",
        # NOTE: the anchor is the DECISION line plus the reason line that
        # follows it, so this cannot accidentally match the other three
        # PRESERVE branches in the same function.
        [(CONFLICT,
          '      decision: CONFLICT_PRESERVATION.PRESERVE,\n      reason: "no usable record',
          '      decision: CONFLICT_PRESERVATION.DISCARD,\n      reason: "no usable record')],
    ),
    (
        "B23",
        "S125 AC6a",
        "the staleness gate is removed, so every divergent file is copied",
        [(MANIFEST,
          "    if (verdict.decision === CONFLICT_PRESERVATION.DISCARD) return false;",
          "    if (false) return false;")],
    ),
    (
        "B24",
        "S125 AC7",
        "the owned exclusion is removed, so conflict copies become shareable",
        [(MANIFEST,
          "    if (isConflictsPath(path, this.settings.sharedFolder)) return false;",
          "    if (false) return false;")],
    ),
    (
        "B25",
        "S125 AC9",
        "the filename stamp is dropped, so a second conflict overwrites the first",
        [(CONFLICT,
          "  const stamped = `${stem} (${conflictStamp(when)})${ext}`;",
          "  const stamped = `${stem}${ext}`;")],
    ),
    (
        "B26",
        "S125 AC6c",
        "onunload stops stamping, making the gate inert after a normal quit",
        [(MAIN,
          "    if (this.sessionManager?.isActive) this.stampSessionEnd();\n",
          "")],
    ),
    (
        "B27",
        "S125 AC10",
        "copies stop being counted, so the join notice never mentions them",
        [(MANIFEST,
          "      noteConflictCopy(arm);",
          "      noteConflictCopy(`${arm}-NOT-COUNTED`);")],
    ),
    # ---- S123 / WP101 : the canvas mirror race ----
    (
        "B28",
        "S123 AC3/AC4",
        "the mirror stops re-asking when records arrive (the race returns)",
        [(MIRROR,
          "      deps.watchForRecords?.(path);",
          "      void path;")],
    ),
    (
        "B29",
        "S123 AC4 (the real watcher)",
        "the production watcher never fires, so the re-arm is inert",
        [(MAIN,
          "      if (!maps.some((map) => map.size > 0)) return;",
          "      return;")],
    ),
    (
        "B30",
        "S123 AC3",
        "a settled skip also installs a watcher (a leak, and a wrong re-arm)",
        [(MIRROR,
          "      post.identityResolves === true &&",
          "      true &&")],
    ),
    # ---- S126 / WP103 part 1 : the evidence is the DOCUMENT, not this peer ----
    (
        "B32",
        "S126 AC2",
        "the floor falls back to the session-local witness (the shipped regression)",
        [(BGSYNC,
          "          intentional: yTextHeldContent(docText) || this.observedNonEmpty.has(path),",
          "          intentional: this.observedNonEmpty.has(path),")],
    ),
    (
        "B33",
        "S126 AC1",
        "the tombstone probe stops finding tombstones",
        [(YTEXT,
          "      if (node.deleted === true) return true;",
          "      if (false) return true;")],
    ),
    (
        "B34",
        "S126 AC2 (the S119 half)",
        "the tombstone probe answers true for a document that never held content",
        [(YTEXT,
          "  if (!text) return false;",
          "  if (!text) return false;\n  if (true) return true;")],
    ),
    # ---- S128 / WP103 part 2 : the readiness signal says why ----
    (
        "B35",
        "S128 AC5",
        "the two resolutions collapse onto one token again",
        [(SYNC,
          "      this.setSynced(docId, true, SYNC_RESOLUTION.NO_PEERS);",
          "      this.setSynced(docId, true, SYNC_RESOLUTION.PEER_STATE);")],
    ),
    (
        "B36",
        "S128 AC5",
        "an unknown reason masquerades as the STRONGER fact",
        # The FIRST of the three ALREADY_SYNCED fallbacks — the one taken by a
        # caller whose doc was already synced before it asked.
        [(SYNC,
          "      return Promise.resolve(this.syncResolution.get(filePath) ?? SYNC_RESOLUTION.ALREADY_SYNCED);",
          "      return Promise.resolve(this.syncResolution.get(filePath) ?? SYNC_RESOLUTION.PEER_STATE);")],
    ),
    (
        "B37",
        "S128 AC5 (behaviour unchanged)",
        "the reason survives releaseDoc, so a re-subscribe inherits a stale answer",
        [(SYNC,
          "    this.syncResolution.delete(filePath);",
          "    void filePath;")],
    ),
]


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_tests():
    proc = subprocess.run(
        ["npx", "vitest", "run", "--reporter=verbose", *TESTS],
        cwd=PLUGIN, capture_output=True, text=True, shell=True,
        encoding="utf-8", errors="replace",
    )
    out = (proc.stdout or "") + (proc.stderr or "")
    clean = re.sub(r"\x1b\[[0-9;]*m", "", out)
    failed = sorted({
        m.group(1).strip()
        for m in re.finditer(r"[x×]\s+(.+?)(?:\s+\d+ms)?$", clean, re.M)
    })
    m = re.search(r"Tests\s+(?:(\d+) failed \| )?(\d+) passed", clean)
    summary = clean_summary(clean)
    return failed, summary


def clean_summary(clean):
    m = re.search(r"Tests\s+(.+?)\n", clean)
    return m.group(1).strip() if m else "UNPARSED"


def main():
    # Test names in this suite carry emoji and em-dashes. Under redirection
    # Windows hands us a cp1252 stdout, which raises on them and killed a run
    # mid-table — after the break was applied. The restore is in a `finally` so
    # nothing was left broken, but the table was lost. Force UTF-8 here.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    targets = {MAIN, MANIFEST, BGSYNC, CONFLICT, MIRROR, YTEXT, SYNC}
    baseline_sha = {p: sha256(p) for p in targets}

    print("=== BASELINE (no break) ===")
    failed, summary = run_tests()
    print(f"  {summary}")
    if failed:
        print("  !! baseline is not green, aborting:", failed)
        return 1

    rows = []
    for bid, ac, desc, edits in BREAKS:
        for p in targets:
            shutil.copyfile(p, p.with_suffix(p.suffix + ".pre-v2-smoke"))
        applied = True
        for path, old, new in edits:
            text = path.read_text(encoding="utf-8")
            if old not in text:
                print(f"  !! {bid}: anchor not found in {path.name}")
                applied = False
                break
            path.write_text(text.replace(old, new, 1), encoding="utf-8", newline="")
        # The restore is in a `finally`: a crash between applying a break and
        # restoring it would otherwise leave a deliberate defect on disk in a
        # tree a sibling agent is also using. (This is not hypothetical — an
        # encoding crash did exactly that on the first run of this script.)
        try:
            if applied:
                failed, summary = run_tests()
            else:
                failed, summary = ["ANCHOR NOT FOUND"], "NOT RUN"
        finally:
            for p in targets:
                shutil.copyfile(p.with_suffix(p.suffix + ".pre-v2-smoke"), p)
                p.with_suffix(p.suffix + ".pre-v2-smoke").unlink()
        restored = all(sha256(p) == baseline_sha[p] for p in targets)

        rows.append((bid, ac, desc, failed, summary, restored))
        print(f"\n=== {bid} ({ac}) {desc}")
        print(f"  {summary}   restore byte-identical: {restored}")
        for f in failed:
            print(f"    RED: {f}")

    print("\n\n================ BREAK TABLE ================")
    for bid, ac, desc, failed, summary, restored in rows:
        print(f"\n{bid} [{ac}] {desc}")
        print(f"  result   : {summary}")
        print(f"  restored : {'byte-identical (sha256)' if restored else '!! MISMATCH !!'}")
        if failed:
            for f in failed:
                print(f"  RED      : {f}")
        else:
            print("  RED      : NOTHING — this break reddened no test")

    print("\n=== FINAL GREEN CHECK ===")
    failed, summary = run_tests()
    print(f"  {summary}  failures={failed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
