"""S143 / S144 / S157 — WP113 Rule 11 falsifiability driver.

Mechanics copied verbatim from `wp115_break_table.py` (which copied
`wp109_break_table.py`): copy-aside, EXACT string replacement, restore in a
`finally`, sha256 equality, the `S133`-anchored failure parser. Its own file for
`S100`'s reason — a shared driver was forked once already in this run (`S146`).

For each planted break: copy the four targets aside, apply an exact string
replacement, run the WP113 set plus the neighbours this package could re-open,
record which rows reddened, restore from the copy-aside, verify the restore is
byte-identical. Never `git checkout`, never `git stash`.

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
OUTCOME = PLUGIN / "src" / "files" / "path-outcome.ts"
BGSYNC = PLUGIN / "src" / "files" / "background-sync.ts"
MANIFEST = PLUGIN / "src" / "files" / "manifest.ts"
UTILS = PLUGIN / "src" / "utils.ts"

TESTS = [
    "src/__tests__/v2/wp113/test_s143_a_subscribe_that_gives_up_says_so.test.ts",
    "src/__tests__/v2/wp113/test_s144_a_folder_failure_is_reported_as_itself.test.ts",
    "src/__tests__/v2/wp113/test_s157_manifest_sync_says_which_door_it_left_by.test.ts",
    # The neighbours this package could re-open. WP114 owns `subscribe()`'s
    # ordering, WP115 owns the seam `syncFromManifest`'s catch now labels,
    # S119/S126 own the floor whose refusal is now double-recorded, and
    # background-sync/utils/manifest pin the three functions edited.
    "src/__tests__/v2/wp114/test_s147_a_subscribe_under_a_clamp.test.ts",
    "src/__tests__/v2/wp115/test_s148_the_guests_offline_work_is_never_silently_lost.test.ts",
    "src/__tests__/dataloss/test_s119_empty_write_floor.test.ts",
    "src/__tests__/dataloss/test_s126_a_real_delete_reaches_a_closed_note.test.ts",
    "src/__tests__/background-sync.test.ts",
    "src/__tests__/utils.test.ts",
    "src/__tests__/manifest.test.ts",
]

# (id, acceptance criterion, description, [(file, old, new), ...])
BREAKS = [
    (
        "W1",
        "A2 — THE DEFECT ITSELF, exit 1 of 2",
        "restore the silent `no-doc` return: the one exit that still leaves a path "
        "unobserved goes back to saying nothing",
        [(BGSYNC,
          "      if (!docHandle) return this.endSubscribe(path, SUBSCRIBE_OUTCOMES.NO_DOC);",
          "      if (!docHandle) return;")],
    ),
    (
        "W2",
        "A2 — THE DEFECT ITSELF, exit 2 of 2",
        "restore the bare `catch { return; }` around `waitForSync`",
        [(BGSYNC,
          "        return this.endSubscribe(\n"
          "          path,\n"
          "          SUBSCRIBE_OUTCOMES.SYNC_FAILED,\n"
          "          err instanceof Error ? err.message : String(err),\n"
          "        );",
          "        return;")],
    ),
    (
        "W3",
        "A3 — the recovery",
        "the re-arm no longer re-drives anything: the abandoned set is never read",
        [(BGSYNC,
          "    const paths = [...this.abandonedSubscribes.keys()];",
          "    const paths: string[] = [];")],
    ),
    (
        "W4",
        "A3 — the retry must actually RE-RUN the reconciliation",
        "the detach before a `sync-failed` re-drive is removed, so `subscribe()`'s own "
        "idempotence guard turns the retry into a counted do-nothing",
        [(BGSYNC,
          "      if (previous === SUBSCRIBE_OUTCOMES.SYNC_FAILED && this.syncManager.getDoc(path)) {\n"
          "        this.detachObserver(path);\n"
          "      }",
          "      void previous;")],
    ),
    (
        "W5",
        "A3 / I11 — THE SAFETY RAIL",
        "a deliberate cancellation becomes retryable, so a stop is queued for resurrection",
        [(OUTCOME,
          "    [SUBSCRIBE_OUTCOMES.CANCELLED]: {\n      disposition: TERMINAL,",
          "    [SUBSCRIBE_OUTCOMES.CANCELLED]: {\n      disposition: RETRYABLE,")],
    ),
    (
        "W6",
        "A4 — a removed file is never re-subscribed",
        "`onFileRemoved` stops dropping the path from the retry set",
        [(BGSYNC,
          "    this.abandonedSubscribes.delete(path);\n"
          "    // S147 — the document is about to be destroyed",
          "    // S147 — the document is about to be destroyed")],
    ),
    (
        "W7",
        "S155 — the success branch, subscribe arm",
        "`subscribe()` stops counting its own completion, so a zero is ambiguous again",
        [(BGSYNC,
          "      this.endSubscribe(path, SUBSCRIBE_OUTCOMES.COMPLETED);",
          "      void 0;")],
    ),
    (
        "W8",
        "B1 — S144's DEFECT ITSELF",
        "restore the swallowing `catch`: every `createFolder` error is discarded again",
        [(UTILS,
          "        const message = err instanceof Error ? err.message : String(err);\n"
          "        if (vault.getAbstractFileByPath(current)) {\n"
          "          raced = current;\n"
          "        } else {\n"
          "          failed = { segment: current, detail: message };\n"
          "        }",
          "        void err;")],
    ),
    (
        "W9",
        "B1 — the classification is by EVIDENCE, not by assumption",
        "every throw is treated as the benign concurrent create, which is what the "
        "shipped comment assumed",
        [(UTILS,
          "        if (vault.getAbstractFileByPath(current)) {\n"
          "          raced = current;",
          "        if (true) {\n"
          "          raced = current;")],
    ),
    (
        "W10",
        "C1 — S157's give-up 1 of 2",
        "restore the silent `getDoc -> null` continue",
        [(MANIFEST,
          "      if (!tempHandle) {",
          "      if (!tempHandle) continue;\n      if (false) {")],
    ),
    (
        "W11",
        "C1 — S157's give-up 2 of 2",
        "restore the bare `catch`: the throw is swallowed with no path, no phase and "
        "no error",
        [(MANIFEST,
          "        notePathOutcome(\n"
          "          {\n"
          "            arm: \"manifest-sync\",\n"
          "            outcome: MANIFEST_SYNC_OUTCOMES.THREW,",
          "        if (false) notePathOutcome(\n"
          "          {\n"
          "            arm: \"manifest-sync\",\n"
          "            outcome: MANIFEST_SYNC_OUTCOMES.THREW,")],
    ),
    (
        "W12",
        "C1 — the phase, which is what attributes the throw",
        "the phase never advances, so a failed WRITE reports as a failed WAIT",
        [(MANIFEST,
          "        phase = \"writing to disk\";",
          "        void 0;")],
    ),
    (
        "W13",
        "S155/C2 — the success branch, manifest arm",
        "`syncFromManifest` stops counting the paths it actually wrote",
        [(MANIFEST,
          "        notePathOutcome(\n"
          "          { arm: \"manifest-sync\", outcome: MANIFEST_SYNC_OUTCOMES.SYNCED, path },\n"
          "          this.logger,\n"
          "        );",
          "        void 0;")],
    ),
    (
        "W14",
        "the closed set is CLOSED",
        "an unknown outcome is counted instead of rejected, so a typo silently invents "
        "a cell nobody can interpret",
        [(OUTCOME,
          "    throw new Error(`path-outcome: '${outcome}' is not an outcome of arm '${arm}'`);",
          "    return { disposition: DO_NOTHING, logged: false, why: \"unknown\" };")],
    ),
    (
        "W15",
        "NEGATIVE CONTROL",
        "the log CATEGORY is reworded. No decision, no counter and no disposition moves; "
        "nothing may redden",
        [(OUTCOME,
          "export const PATH_OUTCOME_LOG_CATEGORY = \"file-op\";",
          "export const PATH_OUTCOME_LOG_CATEGORY = \"file-operation\";")],
    ),
]

TARGETS = {OUTCOME, BGSYNC, MANIFEST, UTILS}


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def clean_summary(clean):
    m = re.search(r"Tests\s+(.+?)\n", clean)
    return m.group(1).strip() if m else "UNPARSED"


def run_tests():
    proc = subprocess.run(
        ["npx", "vitest", "run", "--reporter=verbose", *TESTS],
        cwd=PLUGIN, capture_output=True, text=True, shell=True,
        encoding="utf-8", errors="replace",
    )
    out = (proc.stdout or "") + (proc.stderr or "")
    clean = re.sub(r"\x1b\[[0-9;]*m", "", out)
    # S133 — ANCHORED AT LINE START.
    failed = sorted({
        m.group(1).strip()
        for m in re.finditer(r"^\s*[x×]\s+(.+?)(?:\s+\d+ms)?$", clean, re.M)
    })
    return failed, clean_summary(clean)


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    baseline_sha = {p: sha256(p) for p in TARGETS}

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
        for p in TARGETS:
            shutil.copyfile(p, p.with_suffix(p.suffix + ".pre-v2-smoke"))
        applied = True
        for path, old, new in edits:
            text = path.read_text(encoding="utf-8")
            if old not in text:
                print(f"  !! {bid}: anchor not found in {path.name}")
                applied = False
                break
            path.write_text(text.replace(old, new, 1), encoding="utf-8", newline="")
        try:
            if applied:
                failed, summary = run_tests()
            else:
                failed, summary = ["ANCHOR NOT FOUND"], "NOT RUN"
        finally:
            for p in TARGETS:
                shutil.copyfile(p.with_suffix(p.suffix + ".pre-v2-smoke"), p)
                p.with_suffix(p.suffix + ".pre-v2-smoke").unlink()
        restored = all(sha256(p) == baseline_sha[p] for p in TARGETS)

        rows.append((bid, ac, desc, failed, summary, restored))
        print(f"\n=== {bid} ({ac}) {desc}")
        print(f"  {summary}   restore byte-identical: {restored}")
        for f in failed:
            print(f"    RED: {f}")

    print("\n\n================ WP113 BREAK TABLE ================")
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
    leftovers = sorted(str(p) for p in PLUGIN.rglob("*.pre-v2-smoke"))
    print(f"=== COPY-ASIDE LEFTOVERS: {len(leftovers)} {leftovers} ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
