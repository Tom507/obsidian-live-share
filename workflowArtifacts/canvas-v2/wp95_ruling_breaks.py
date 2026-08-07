"""WP95 ruling — falsifiability pass over the REWRITTEN fixtures.

The Dispatcher's ruling separated two properties that WP26/WP68/WP90 had
conflated in one fixture. A rewritten test that has not been shown able to fail
is worth less than the one it replaced, so each break below targets ONE of the
two separated properties and must redden it:

  BR1  the protected gate stops refusing        -> the REFUSED rows must red
  BR2  the predicate is narrowed (.obsidian out) -> every ruled row must red
  BR3  the predicate over-refuses (everything)   -> the RELOCATED ADMISSION rows
                                                    must red. This is the one
                                                    that proves moving them did
                                                    not turn them into decoration.
  BR4  isSidecarPath loses its `/` boundary      -> the PRESERVED PREFIX property
                                                    must red. This is the one
                                                    that proves the near-miss
                                                    property survived the move.

Copy-aside restore, sha256-verified byte-identical. Never checkout, never stash.
"""

import hashlib
import re
import shutil
import subprocess
import sys
from pathlib import Path

SRC = Path("src")
SUITES = [
    "src/__tests__/v2/wp68/",
    "src/__tests__/v2/wp26/",
    "src/__tests__/v2/wp90/",
    "src/__tests__/v2/wp95/",
]
VITEST = ["node", "node_modules/vitest/vitest.mjs", "run", *SUITES]


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def run_suite():
    r = subprocess.run(VITEST, capture_output=True, shell=False)
    out = (r.stdout or b"").decode("utf-8", "replace") + (r.stderr or b"").decode("utf-8", "replace")
    clean = re.sub(r"\x1b\[[0-9;]*m", "", out)
    m = re.search(r"Tests\s+(?:(\d+) failed\s*\|\s*)?(\d+) passed", clean)
    failed = int(m.group(1)) if m and m.group(1) else 0
    passed = int(m.group(2)) if m else -1
    names = sorted(set(re.findall(r"FAIL .*? > .*? > (.+)", clean)))
    return failed, passed, names


BREAKS = [
    (
        "BR1",
        "sync/control-handlers.ts",
        "const protectedPath = paths.find((path) => isProtectedPath(path));",
        "const protectedPath = paths.find((path) => false && isProtectedPath(path));",
        "the protected file-op gate stops refusing",
    ),
    (
        "BR2",
        "files/protected-paths.ts",
        'export const PROTECTED_ROOTS: readonly string[] = [".obsidian", ".git"];',
        'export const PROTECTED_ROOTS: readonly string[] = [".git"];',
        "the predicate is NARROWED - `.obsidian` drops out",
    ),
    (
        "BR3",
        "files/protected-paths.ts",
        "  return segmentsOf(path).some((segment) => PROTECTED_SET.has(segment));",
        "  return segmentsOf(path).length > 0;",
        "the predicate OVER-REFUSES - every path is protected",
    ),
    (
        "BR4",
        "files/canvas-sidecar.ts",
        "  const prefix = `${SIDECAR_DIR}/`;",
        "  const prefix = SIDECAR_DIR;",
        "isSidecarPath loses its `/` boundary - `stateful` matches `state`",
    ),
]


def main():
    base_failed, base_passed, _ = run_suite()
    print(f"BASELINE  failed={base_failed} passed={base_passed}\n")
    if base_failed:
        print("refusing to plant against a red baseline")
        return 1

    rows = []
    for bid, rel, old, new, desc in BREAKS:
        target = SRC / rel
        aside = target.with_suffix(target.suffix + f".{bid}.aside")
        before = sha(target)
        shutil.copy2(target, aside)

        text = target.read_text(encoding="utf-8")
        if text.count(old) != 1:
            print(f"{bid}: anchor not unique ({text.count(old)}) in {rel} - SKIPPED")
            aside.unlink()
            continue
        target.write_text(text.replace(old, new), encoding="utf-8")

        try:
            failed, passed, names = run_suite()
        finally:
            shutil.copy2(aside, target)
            aside.unlink()

        after = sha(target)
        assert after == before, f"{bid}: restoration NOT byte-identical for {rel}"

        rows.append((bid, rel, desc, failed, passed, names))
        print(f"{bid}  {rel:34s} failed={failed:3d} passed={passed:3d}  restored OK")
        for n in names[:10]:
            print(f"      RED: {n}")
        print()

    f2, p2, _ = run_suite()
    print(f"AFTER ALL RESTORES  failed={f2} passed={p2}")

    print("\n=== RULING BREAK TABLE ===")
    for bid, rel, desc, failed, passed, names in rows:
        print(f"\n{bid} | {rel} | {desc}")
        print(f"   result: {failed} red / {passed} green")
        for n in names:
            print(f"   reddened: {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
