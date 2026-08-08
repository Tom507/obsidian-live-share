"""S134 / WP109 — Rule 9 falsifiability driver.

Its own file rather than more rows on `s115_break_table.py`, and that is a
decision about the TREE, not about the table: a sibling worker (W3d/WP110) is
live in this working copy and the cumulative driver is a file both of us would
have to edit. `S100` is exactly this — a shared tree makes any "what did I
change?" instrument change subject underneath you. The mechanics are copied
verbatim from `s115_break_table.py` (copy-aside, exact string replacement,
restore in a `finally`, sha256 equality) including its `^\\s*[x×]` failure
parser, whose unanchored ancestor manufactured a false red (`S133`).

For each planted break: copy the target aside, apply an EXACT string
replacement, run the WP109 test set, record which rows reddened, restore from
the copy-aside, verify the restore is byte-identical. Never `git checkout`,
never `git stash`.

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
BGSYNC = PLUGIN / "src" / "files" / "background-sync.ts"
COLLAB = PLUGIN / "src" / "editor" / "collab.ts"
COLLABDEC = PLUGIN / "src" / "editor" / "collab-bind-decision.ts"

TESTS = [
    "src/__tests__/v2/wp109/test_s134_a_note_born_in_a_session.test.ts",
    # The neighbours S134 must not have re-opened. S129 owns the same `catch`'s
    # sibling path and S119/S126 own the floor the guest arm meets.
    "src/__tests__/dataloss/test_s129_opening_a_note_cannot_empty_it.test.ts",
    "src/__tests__/dataloss/test_s126_a_real_delete_reaches_a_closed_note.test.ts",
    "src/__tests__/dataloss/test_s119_empty_write_floor.test.ts",
    "src/__tests__/background-sync.test.ts",
    "src/__tests__/collab.test.ts",
]

# (id, acceptance criterion, description, [(file, old, new), ...])
BREAKS = [
    (
        "W1",
        "AC1/AC2 — THE DEFECT ITSELF",
        "restore the active-file exemption in front of the whole host arm "
        "(the shipped defect, verbatim)",
        [(BGSYNC,
          "      if (this.role === \"host\") {\n        const file = getFileByPath(this.vault, diskPath);",
          "      if (this.role === \"host\" && path !== this.activeFile) {\n        const file = getFileByPath(this.vault, diskPath);")],
    ),
    (
        "W2",
        "AC2 — the seed itself",
        "the host stops seeding altogether (the branch is inert for every path, "
        "not only the active one)",
        [(BGSYNC,
          "            if (!isActive || !yTextHeldContent(docHandle.text)) {",
          "            if (false) {")],
    ),
    (
        "W3",
        "AC2 — the tombstone gate on the NEWLY reachable case",
        "an emptied note is resurrected under the user's cursor (the inverse of S126)",
        [(BGSYNC,
          "            if (!isActive || !yTextHeldContent(docHandle.text)) {",
          "            if (true) {")],
    ),
    (
        "W4",
        "AC2 — the single-writer invariant",
        "the disk-write branch is let through for the ACTIVE file "
        "(the thing the original guard was really protecting)",
        [(BGSYNC,
          "          } else if (isActive) {",
          "          } else if (false) {")],
    ),
    (
        "W5",
        "AC3 — the bind stops lying",
        "the failed bind no longer reports its state, so `collabBoundFile` keeps naming it",
        [(COLLAB,
          "      this.bindStateSink?.(filePath, false);\n      new Notice(\"Live Share: sync timed out\");",
          "      new Notice(\"Live Share: sync timed out\");")],
    ),
    (
        "W6",
        "AC3 — the counter",
        "the failure is no longer counted",
        [(COLLAB,
          "      noteCollabBindFailure(filePath);",
          "      if (false) noteCollabBindFailure(filePath);")],
    ),
    (
        "W7",
        "AC3 — the debug-log line",
        "the failure stops reaching the debug log (Notice-only again, the S117 shape)",
        [(COLLAB, "`bind FAILED for ${filePath}", "`bind quietly for ${filePath}")],
    ),
    (
        "W8",
        "AC3 — the identity guard",
        "the sink clears the flag for ANY path, so a late failure clears a file "
        "the user already moved to",
        [(COLLABDEC,
          "    if (flag.getCollabBoundFile() !== path) return;",
          "    if (false) return;")],
    ),
    (
        "W9",
        "AC3 — the ledgers stay separable (S132)",
        "a timeout is filed as a REFUSAL, so the two classes collapse into one counter",
        [(COLLAB,
          "      noteCollabBindFailure(filePath);",
          "      noteCollabBindRefusal(filePath);\n      noteCollabBindFailure(filePath);")],
    ),
    (
        "W10",
        "AC3 — event recovery",
        "a failed bind no longer re-activates when the document arrives",
        [(COLLAB,
          "      // S123's lesson, same as the refusal path below: recover on the EVENT.\n"
          "      // A failed bind that needs the user to close and reopen the file is how\n"
          "      // three peers end up editing three copies of one note for a whole\n"
          "      // session — the document arriving is exactly the moment to try again.\n"
          "      this.watchForContent(view, filePath, syncManager, role, permission, cursorUser);\n",
          "")],
    ),
    (
        "W11",
        "NEGATIVE CONTROL",
        "the failure log line is reworded but everything still happens",
        [(COLLAB,
          '"unbound and this file is NOT collaborating"',
          '"unbound and the file is not collaborating at all"')],
    ),
]

TARGETS = {BGSYNC, COLLAB, COLLABDEC}


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
    # S133 — ANCHORED AT LINE START. The unanchored ancestor harvested any line
    # containing a literal `x` followed by a space as a failing test name.
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

    print("\n\n================ WP109 BREAK TABLE ================")
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
