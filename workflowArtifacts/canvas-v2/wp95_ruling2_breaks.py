"""WP95 rulings 1 and 2 — falsifiability pass over the two converted assertions.

Ruling 1 (`wp92/tp06`): the wp63/wp90 rows were converted from whole-file diff
PRESENCE to the ATTRIBUTION form the function's own comment prescribes. The break
that matters is a GENUINE MARKER planted in an out-of-scope file — if the
converted rows cannot see that, the conversion swapped one unproven assertion for
another.

Ruling 2 (`wp68/tp04`): the "every other op type" row now asserts WHICH gate
refused. The break that matters is removing the gate it names while leaving the
op still refused by its neighbour — the exact situation the row stayed green
through before, and the one it must now redden on.

Copy-aside restore, sha256-verified byte-identical. Never checkout, never stash.
"""

import hashlib
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(".")
VITEST = ["node", "node_modules/vitest/vitest.mjs", "run"]


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def run(suites):
    r = subprocess.run([*VITEST, *suites], capture_output=True, shell=False)
    out = (r.stdout or b"").decode("utf-8", "replace") + (r.stderr or b"").decode("utf-8", "replace")
    clean = re.sub(r"\x1b\[[0-9;]*m", "", out)
    m = re.search(r"Tests\s+(?:(\d+) failed\s*\|\s*)?(\d+) passed", clean)
    failed = int(m.group(1)) if m and m.group(1) else 0
    passed = int(m.group(2)) if m else -1
    names = sorted(set(re.findall(r"FAIL .*? > .*? > (.+)", clean)))
    return failed, passed, names


# (id, file, old, new, suites, description)
BREAKS = [
    (
        "CR1",
        "src/__tests__/v2/wp90/test_tp06_the_durable_record_is_peer_unreachable_visible.test.ts",
        "describe(",
        "// WP92 marker planted by the falsifiability pass\ndescribe(",
        ["src/__tests__/v2/wp92/"],
        "a GENUINE WP92 marker added to an out-of-scope wp90/ file",
    ),
    (
        "CR2",
        "src/sync/control-handlers.ts",
        "const protectedPath = paths.find((path) => isProtectedPath(path));",
        "const protectedPath = paths.find((path) => false && isProtectedPath(path));",
        ["src/__tests__/v2/wp68/test_tp04_no_collateral_visible.test.ts"],
        "WP95's gate removed; the op is STILL refused by isSharedPath underneath",
    ),
]


def main():
    rows = []
    for bid, rel, old, new, suites, desc in BREAKS:
        target = ROOT / rel
        base_failed, base_passed, _ = run(suites)
        print(f"{bid} BASELINE  failed={base_failed} passed={base_passed}")
        if base_failed:
            print(f"{bid}: refusing to plant against a red baseline")
            return 1

        aside = target.with_suffix(target.suffix + f".{bid}.aside")
        before = sha(target)
        shutil.copy2(target, aside)

        text = target.read_text(encoding="utf-8")
        if text.count(old) < 1:
            print(f"{bid}: anchor not found in {rel} - SKIPPED")
            aside.unlink()
            continue
        target.write_text(text.replace(old, new, 1), encoding="utf-8")

        try:
            failed, passed, names = run(suites)
        finally:
            shutil.copy2(aside, target)
            aside.unlink()

        after = sha(target)
        assert after == before, f"{bid}: restoration NOT byte-identical for {rel}"

        post_failed, post_passed, _ = run(suites)
        rows.append((bid, rel, desc, failed, passed, names, post_failed))
        print(f"{bid}  PLANTED   failed={failed:3d} passed={passed:3d}")
        for n in names:
            print(f"      RED: {n}")
        print(f"{bid}  RESTORED  failed={post_failed} passed={post_passed}  byte-identical OK\n")

    print("=== CONVERSION BREAK TABLE ===")
    for bid, rel, desc, failed, passed, names, post in rows:
        print(f"\n{bid} | {rel}")
        print(f"   plant:  {desc}")
        print(f"   result: {failed} red / {passed} green   (restored: {post} red)")
        for n in names:
            print(f"   reddened: {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
