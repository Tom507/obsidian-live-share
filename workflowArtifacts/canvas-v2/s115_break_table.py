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

TESTS = [
    "src/__tests__/v2/ux01/test_s115_stale_reconcile_is_scoped_by_the_host.test.ts",
    "src/__tests__/v2/ux01/test_s115_guest_stale_reconcile_candidate_set.test.ts",
    "src/__tests__/dataloss/test_stale_reconcile_evidence_gate.test.ts",
    "src/__tests__/v2/ux01/test_s116_a_guest_only_trashes_what_the_session_gave_it.test.ts",
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
    targets = {MAIN, MANIFEST}
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
