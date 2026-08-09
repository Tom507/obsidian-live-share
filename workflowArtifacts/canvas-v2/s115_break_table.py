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
COLLAB = PLUGIN / "src" / "editor" / "collab.ts"
COLLABDEC = PLUGIN / "src" / "editor" / "collab-bind-decision.ts"
FILEOPS = PLUGIN / "src" / "files" / "file-ops.ts"
VEVENTS = PLUGIN / "src" / "files" / "vault-events.ts"
CTRL = PLUGIN / "src" / "sync" / "control-handlers.ts"

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
    "src/__tests__/dataloss/test_s129_opening_a_note_cannot_empty_it.test.ts",
    "src/__tests__/v2/wp108/test_s120_mute_does_not_swallow_intent.test.ts",
    "src/__tests__/v2/wp108/test_s124_peers_do_not_follow_a_file_out.test.ts",
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
    # ---- S129 / WP104 : opening a note cannot empty it ----
    (
        "B38",
        "S129 AC1",
        "the expiry falls through to the bind again (THE DEFECT)",
        [(COLLAB,
          "      if (verdict.decision !== COLLAB_BIND.BIND) {",
          "      if (false) {")],
    ),
    (
        "B39",
        "S129 AC1",
        "an unproven emptiness is decided as proven",
        [(COLLABDEC,
          "    decision: COLLAB_BIND.REFUSE_UNPROVEN_EMPTY,",
          "    decision: COLLAB_BIND.BIND,")],
    ),
    (
        "B40",
        "S129 AC3",
        "the host re-seeds over a document somebody emptied (undoing the delete)",
        [(COLLABDEC,
          "  return !observation.docHeldContent;",
          "  return true;")],
    ),
    (
        "B41",
        "S129 AC2",
        "the recovery watcher never fires, so a refused note never starts syncing",
        [(COLLAB,
          "      if (fired || text.length === 0) return;",
          "      return;")],
    ),
    (
        "B42",
        "S129 AC5",
        "refusals stop being recorded, so the fail-safe becomes unobservable",
        [(COLLABDEC,
          "  refusedPaths.add(path);",
          "  void path;")],
    ),
    # ---- S120 / WP108 : the mute stops swallowing user intent ----
    (
        "B43",
        "S120 AC1",
        "the mute predicate goes type-blind again (THE DEFECT)",
        [(FILEOPS,
          "    return live.some((entry) => entry.consumes.has(kind));",
          "    return true;")],
    ),
    (
        "B44",
        "S120 AC1 (the fail-closed half)",
        # RELABELLED by W3b. The predecessor called this "the mute stops
        # suppressing the echo it was armed for", which is not what the edit
        # does: it flips the branch taken when NO entry is armed. The row is a
        # good one — that branch is the conservative default the three
        # un-armed release sites depend on — but the old label named a
        # different property from the one it reddens.
        "the fail-closed default goes permissive: a mute with no armed entry stops suppressing",
        [(FILEOPS,
          "    if (live.length === 0) return true;",
          "    if (live.length === 0) return false;")],
    ),
    (
        "B45",
        "S120 AC2",
        "drops stop being counted, so a lost gesture is silent again",
        [(FILEOPS,
          "    this.muteDrops.total += 1;",
          "    this.muteDrops.total += 0;")],
    ),
    (
        "B46",
        "S120 AC4",
        "one gate reverts to the type-blind predicate",
        [(VEVENTS,
          'if (plugin.fileOpsManager.isPathMutedFor(originalPath, "create")) {',
          "if (plugin.fileOpsManager.isPathMuted(originalPath)) {")],
    ),
    # ---- S124 / WP108 : peers do not follow a file out of the share ----
    (
        "B47",
        "S124 AC5 (worst blast radius)",
        "the host accepts a rename whose destination leaves the shared tree",
        [(CTRL,
          "        !plugin.manifestManager.isSharedPath(renameDestination)",
          "        false")],
    ),
    (
        "B48",
        "S124 AC5",
        "the destination reader returns null, so nothing is ever checked",
        [(CTRL,
          "    op?.type === \"rename\" && typeof op.newPath === \"string\" ? op.newPath : null;",
          "    null;")],
    ),
    (
        "B49",
        "S124 (the reversal)",
        "the inbound-only predicate is borrowed sideways onto the OUTBOUND gate again",
        # W3b REPLACED the predecessor's B49. Its version broke a guard that
        # this run REMOVED: `isProtectedPath` is documented "INBOUND PEER
        # OPERATIONS ONLY", and putting it on `onFileRename` reddened three
        # WP68 AC4 near-miss rows. The break now plants the REGRESSION rather
        # than removing the fix — the pin is an ABSENCE, so the way to redden
        # it is to put the thing back.
        [(FILEOPS,
          "    const prev = this.sendQueues.get(localOld) ?? Promise.resolve();",
          "    for (const candidate of [localOld, localNew, wireOld, wireNew]) {\n"
          "      if (isProtectedPath(candidate)) {\n"
          '        noteProtectedRefusal("file-op-gate", candidate);\n'
          "        return;\n"
          "      }\n"
          "    }\n"
          "    const prev = this.sendQueues.get(localOld) ?? Promise.resolve();")],
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
    # ⚠ ANCHORED AT LINE START, and it was not — a W3b finding, found the only
    # way findings like this are found: it reported a GREEN run as red.
    #
    # The old pattern was `[x×]\s+(.+?)…$` with no anchor, so ANY line containing
    # a literal `x` followed by a space was harvested as a failing test name. A
    # test titled "…the fix is on the RECEIVER" made the baseline abort with
    # `['is on the RECEIVER']` against a suite that was 165/165 passing.
    #
    # This fails SAFE (a false red aborts the run) rather than silently, so no
    # earlier row in this table can have been a false green from it. But a break
    # table whose oracle fires on prose is not an oracle, and every row it prints
    # is only as trustworthy as this regex.
    #
    # vitest's verbose reporter puts the marker FIRST on the line, after indent
    # only. `^\s*` says exactly that and nothing else changes.
    failed = sorted({
        m.group(1).strip()
        for m in re.finditer(r"^\s*[x×]\s+(.+?)(?:\s+\d+ms)?$", clean, re.M)
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
    targets = {MAIN, MANIFEST, BGSYNC, CONFLICT, MIRROR, YTEXT, SYNC, COLLAB, COLLABDEC,
               FILEOPS, VEVENTS, CTRL}
    baseline_sha = {p: sha256(p) for p in targets}

    # OPTIONAL FILTER, added by W3b: `python s115_break_table.py B43 B44 ...`
    # runs only those rows. The table is CUMULATIVE across work packages and a
    # full sweep is ~50 vitest runs, so a WP that adds seven rows re-proves those
    # seven rather than restarting. WITHOUT AN ARGUMENT NOTHING CHANGES: the
    # default is still every row, so a filtered run can never be mistaken for a
    # full one — the header below prints which it was.
    wanted = {a.upper() for a in sys.argv[1:]}
    selected = [b for b in BREAKS if not wanted or b[0].upper() in wanted]
    if wanted:
        missing = wanted - {b[0].upper() for b in BREAKS}
        if missing:
            print(f"  !! unknown break ids: {sorted(missing)}")
            return 2
        print(f"=== FILTERED RUN: {len(selected)} of {len(BREAKS)} rows "
              f"({', '.join(b[0] for b in selected)}) ===")
    else:
        print(f"=== FULL RUN: all {len(BREAKS)} rows ===")

    print("=== BASELINE (no break) ===")
    failed, summary = run_tests()
    print(f"  {summary}")
    if failed:
        print("  !! baseline is not green, aborting:", failed)
        return 1

    rows = []
    for bid, ac, desc, edits in selected:
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
