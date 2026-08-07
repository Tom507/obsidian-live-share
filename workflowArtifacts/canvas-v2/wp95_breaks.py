"""WP95 break table driver.

Plant one regression, run the WP95 suite, restore the file BYTE-IDENTICALLY by
copy-aside, verify the restoration with a sha256 comparison, and report what
each break reddened. Never `git checkout`, never `git stash` — a sibling agent
shares this working tree.
"""

import hashlib
import re
import shutil
import subprocess
import sys
from pathlib import Path

SRC = Path("src")
VITEST = ["node", "node_modules/vitest/vitest.mjs", "run", "src/__tests__/v2/wp95/"]


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


# (id, file, old, new, description)
BREAKS = [
    (
        "B1",
        "sync/control-handlers.ts",
        'const protectedPath = paths.find((path) => isProtectedPath(path));',
        'const protectedPath = paths.find((path) => false && isProtectedPath(path));',
        "inbound file-op gate: the protected-path refusal never fires",
    ),
    (
        "B2",
        "sync/control-handlers.ts",
        "      if (isProtectedPath(msg.path)) {\n        noteProtectedRefusal(\"chunk-gate\", msg.path);",
        "      if (false && isProtectedPath(msg.path)) {\n        noteProtectedRefusal(\"chunk-gate\", msg.path);",
        "chunk-transfer gate: the separate chunk door is left unguarded",
    ),
    (
        "B3",
        "files/file-ops.ts",
        "      if (!isProtectedPath(candidate)) continue;",
        "      if (true || !isProtectedPath(candidate)) continue;",
        "applyRemoteOpInner: the independent second refusal is removed",
    ),
    (
        "B4",
        "files/manifest.ts",
        '      if (isProtectedPath(path)) {\n        noteProtectedRefusal("manifest-sync", path);',
        '      if (false && isProtectedPath(path)) {\n        noteProtectedRefusal("manifest-sync", path);',
        "syncFromManifest: the manifest-driven materialisation arm is unguarded",
    ),
    (
        "B5",
        "files/manifest.ts",
        '    if (isProtectedPath(path)) {\n      noteProtectedRefusal("shared-path", path);',
        '    if (false && isProtectedPath(path)) {\n      noteProtectedRefusal("shared-path", path);',
        "isSharedPath: the scope predicate stops refusing protected paths",
    ),
    (
        "B6",
        "files/manifest-removal-decision.ts",
        "  if (isProtectedPath(newPath)) {",
        "  if (false && isProtectedPath(newPath)) {",
        "decideManifestRename: a protected rename DESTINATION is admitted again",
    ),
    (
        "B7",
        "files/protected-paths.ts",
        'export const PROTECTED_ROOTS: readonly string[] = [".obsidian", ".git"];',
        'export const PROTECTED_ROOTS: readonly string[] = [".git"];',
        "the predicate is NARROWED — `.obsidian/**` drops out of the protected set",
    ),
    (
        "B8",
        "files/protected-paths.ts",
        "    .map((segment) => segment.toLowerCase());",
        "    .map((segment) => segment);",
        "the predicate becomes case-SENSITIVE — `.OBSIDIAN/**` is a bypass again",
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
            print(f"{bid}: anchor not unique ({text.count(old)} matches) in {rel} — SKIPPED")
            aside.unlink()
            rows.append((bid, rel, desc, "ANCHOR-MISS", []))
            continue
        target.write_text(text.replace(old, new), encoding="utf-8")

        try:
            failed, passed, names = run_suite()
        finally:
            shutil.copy2(aside, target)
            aside.unlink()
        after = sha(target)
        assert after == before, f"{bid}: restoration is NOT byte-identical for {rel}"

        rows.append((bid, rel, desc, f"{failed} red / {passed} green", names))
        print(f"{bid}  {rel:40s} failed={failed:3d} passed={passed:3d}  restored OK")
        for n in names[:8]:
            print(f"      RED: {n}")
        print()

    f2, p2, _ = run_suite()
    print(f"AFTER ALL RESTORES  failed={f2} passed={p2}")

    print("\n\n=== BREAK TABLE ===")
    for bid, rel, desc, result, names in rows:
        print(f"\n{bid} | {rel} | {desc}")
        print(f"   result: {result}")
        for n in names:
            print(f"   reddened: {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
