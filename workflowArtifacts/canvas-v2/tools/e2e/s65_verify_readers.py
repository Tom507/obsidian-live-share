#!/usr/bin/env python3
"""S65 — positive control for the reader retrofit.

Asserts, by parsing the AST rather than grepping text, that in every patched
reader the flush guard is called INSIDE the reader helper and BEFORE the seek
that reads from the remembered offset. A guard that sits after the read, or in a
function nobody calls, would pass a grep and fail here.

THE POSITIVE CONTROL: the identical check is run against the PRE-PATCH backups
in H:\\tmp\\_s65_backup. It must FAIL on every one of them. A verifier that
cannot detect the defect it is looking for is not a verifier - that is the S65
error committed one level up, and this run has produced it once already
(the 2 s margin was itself an unverified assumption).
"""

import ast
import sys
from pathlib import Path

TMP = Path(r"H:\tmp")
BACKUP = TMP / "_s65_backup"
GUARD = "_s65_wait_for_flush"

TARGETS = {
    "liveshare_b41_ladder.py": "log_since",
    "liveshare_b41_observe_then_write.py": "log_since",
    "liveshare_b41_shapes.py": "log_since",
    "liveshare_b41_schedule_dependence.py": "log_since",
    "liveshare_b41_suite_with_receipts.py": "since",
    "liveshare_b44_mute_burst.py": "log_since",
    "liveshare_wp82.py": "log_delta",
    "liveshare_wp83_e2e.py": "log_since",
    "liveshare_wp85_e2e.py": "log_tail",
    "liveshare_wp87_e2e.py": "log_since",
}


def guarded_before_seek(path: Path, helper: str):
    """(ok, detail). True iff `helper` calls the guard before any `.seek(`."""
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"), str(path))
    except SyntaxError as exc:
        return False, "syntax error: %s" % exc
    fn = None
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == helper:
            fn = node
            break
    if fn is None:
        return False, "helper %r not found" % helper

    guard_line = seek_line = None
    for node in ast.walk(fn):
        if not isinstance(node, ast.Call):
            continue
        f = node.func
        if isinstance(f, ast.Name) and f.id == GUARD and guard_line is None:
            guard_line = node.lineno
        if isinstance(f, ast.Attribute) and f.attr == "seek" and seek_line is None:
            seek_line = node.lineno
    if guard_line is None:
        return False, "no %s() call inside %s()" % (GUARD, helper)
    if seek_line is None:
        return False, "no .seek() inside %s() - is this the right helper?" % helper
    if guard_line >= seek_line:
        return False, "guard at line %d is NOT before the seek at line %d" % (
            guard_line, seek_line)
    return True, "guard line %d < seek line %d" % (guard_line, seek_line)


def main():
    print("=" * 76)
    print("S65 READER RETROFIT — structural verification")
    print("=" * 76)

    # ---- POSITIVE CONTROL FIRST -------------------------------------------
    print("\nPOSITIVE CONTROL — the same check run on the UNPATCHED backups.")
    print("Every one must FAIL, or the check cannot see the defect.\n")
    ctl_ok = True
    for name, helper in TARGETS.items():
        p = BACKUP / name
        if not p.exists():
            print("  %-42s BACKUP MISSING - control void" % name)
            ctl_ok = False
            continue
        ok, detail = guarded_before_seek(p, helper)
        detected = not ok
        ctl_ok = ctl_ok and detected
        print("  %-42s %s  (%s)" % (
            name, "detects defect" if detected else "<< MISSED THE DEFECT", detail))
    if not ctl_ok:
        print("\nPOSITIVE CONTROL FAILED. Reporting nothing about the patched files.")
        return 2
    print("\n  Control green: the check fails on all 10 unpatched originals.")

    # ---- the real check ----------------------------------------------------
    print("\n" + "-" * 76)
    print("PATCHED FILES")
    print("-" * 76)
    bad = 0
    for name, helper in TARGETS.items():
        p = TMP / name
        ok, detail = guarded_before_seek(p, helper)
        if not ok:
            bad += 1
        print("  %-42s %-4s %s" % (name, "OK" if ok else "FAIL", detail))

    print("\n%d/%d readers guarded before the offset read." % (len(TARGETS) - bad, len(TARGETS)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
