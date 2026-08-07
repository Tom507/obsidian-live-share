"""B11 falsification harness — WP60 + WP61.

Proves the amended assertions still BITE: perturb the pinned production surface,
confirm the amended assertion goes red (and record everything else that went red
alongside it), then restore the file byte-clean and verify by sha256.

The file under perturbation (`plugin/src/testing/e2e-control.ts`) has PRE-EXISTING
uncommitted changes, so `git checkout --` is NOT a safe restore path. We snapshot
the exact bytes up front and restore from that snapshot, asserting the sha256
matches after every single perturbation.

Usage:  python _falsify_b11.py
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
TARGET = REPO / "plugin" / "src" / "testing" / "e2e-control.ts"
RAW = HERE / "_blind_records" / "_raw"
RUNNER = HERE / "_run_blind.py"

ORIGINAL = TARGET.read_bytes()
ORIGINAL_SHA = hashlib.sha256(ORIGINAL).hexdigest()


def restore() -> None:
    TARGET.write_bytes(ORIGINAL)
    got = hashlib.sha256(TARGET.read_bytes()).hexdigest()
    if got != ORIGINAL_SHA:
        raise SystemExit(f"FATAL: restore mismatch {got} != {ORIGINAL_SHA}")


def perturb(old: str, new: str) -> None:
    text = TARGET.read_text(encoding="utf-8")
    if text.count(old) != 1:
        restore()
        raise SystemExit(f"FATAL: anchor not unique ({text.count(old)}x): {old[:70]!r}")
    TARGET.write_text(text.replace(old, new), encoding="utf-8")


def run(wp: str, which: str) -> None:
    subprocess.run(
        [sys.executable, str(RUNNER), wp, which, "--ts-only"],
        cwd=str(HERE), capture_output=True, text=True,
    )


def failures(wp: str, sets: list[str]) -> list[str]:
    out: list[str] = []
    for s in sets:
        p = RAW / f"WP{wp}_{s}_vitest.json"
        if not p.exists():
            out.append(f"{s}: <no reporter artefact>")
            continue
        d = json.loads(p.read_text(encoding="utf-8"))
        for tr in d.get("testResults", []):
            fname = Path(tr.get("name", "")).name
            for a in tr.get("assertionResults", []):
                if a.get("status") != "passed":
                    out.append(f"{s}::{fname}::{a.get('title')}")
    return out


CASES = [
    (
        "P1  WP60 pin still catches a NEW node builtin",
        "44", "set2", ["set2"],
        'import { createHash } from "node:crypto";',
        'import { createHash } from "node:crypto";\nimport { format as _falsify } from "node:util";',
        ["imports exactly the sanctioned node builtins: node:crypto, node:http"],
    ),
    (
        "P2  class A: timeoutMs 0 collapsing to the 2000 default",
        "49", "both", ["set1", "set2"],
        "const deadline = Date.now() + timeoutMs;",
        "const deadline = Date.now() + (timeoutMs || 2000);",
        [
            "timeoutMs 0 answers true when already idle and false immediately after activity",
            "a remote node removal blocks a zero-budget quiescence probe",
        ],
    ),
    (
        "P3  class B: session.info payload narrowed (canvasSurface pinned false)",
        "49", "set2", ["set2"],
        "canvasSurface: resolveCanvasSurface(plugin),",
        "canvasSurface: false,",
        ["session.info is untouched by the new seam"],
    ),
    (
        "P4  class C #5: absent-file content softened from null to empty string",
        "49", "set2", ["set2"],
        'return { exists: false, sha256: "", size: 0, content: null };',
        'return { exists: false, sha256: "", size: 0, content: "" };',
        ["the requested path is missing even though similar files exist"],
    ),
    (
        "P5  class C #4: activity seam made ORIGIN-AWARE (the WP49 AC1 violation)",
        "49", "set2", ["set2"],
        'doc.on("update", markActivity);',
        'doc.on("update", (_u: unknown, origin: unknown) => {\n      if (origin === "canvas-view-user") return;\n      markActivity();\n    });',
        ["a user edit landing during a pending wait pushes the answer to false"],
    ),
]


def main() -> int:
    print(f"target : {TARGET}")
    print(f"sha256 : {ORIGINAL_SHA}\n")
    verdicts: list[tuple[str, bool, list[str], list[str]]] = []

    for label, wp, which, sets, old, new, expected in CASES:
        print("=" * 78)
        print(label)
        print("=" * 78)
        try:
            perturb(old, new)
            run(wp, which)
            got = failures(wp, sets)
        finally:
            restore()

        got_titles = [g.split("::")[-1] for g in got]
        hit = all(e in got_titles for e in expected)
        extra = [g for g in got if g.split("::")[-1] not in expected]
        verdicts.append((label, hit and not extra, got, expected))

        print(f"  expected red ({len(expected)}):")
        for e in expected:
            mark = "OK " if e in got_titles else "MISS"
            print(f"    [{mark}] {e}")
        print(f"  actually red ({len(got)}):")
        for g in got:
            print(f"    - {g}")
        if extra:
            print(f"  !! UNEXPECTED collateral ({len(extra)}): {extra}")
        print(f"  restored byte-clean: sha256 OK\n")

    # Baseline re-run: everything green again on the restored tree.
    print("=" * 78)
    print("RESTORE VERIFICATION — re-run all three sets unperturbed")
    print("=" * 78)
    run("44", "set2")
    run("49", "both")
    post = failures("44", ["set2"]) + failures("49", ["set1", "set2"])
    print(f"  failures after restore: {len(post)} {post}")

    final_sha = hashlib.sha256(TARGET.read_bytes()).hexdigest()
    print(f"\n  final sha256 : {final_sha}")
    print(f"  matches orig : {final_sha == ORIGINAL_SHA}")

    print("\n" + "=" * 78)
    print("SUMMARY")
    print("=" * 78)
    ok = True
    for label, good, got, expected in verdicts:
        print(f"  [{'PASS' if good else 'FAIL'}] {label}  ({len(got)} red, {len(expected)} expected)")
        ok = ok and good
    print(f"  [{'PASS' if not post else 'FAIL'}] restored tree is green again ({len(post)} failures)")
    print(f"  [{'PASS' if final_sha == ORIGINAL_SHA else 'FAIL'}] e2e-control.ts byte-identical to snapshot")
    return 0 if (ok and not post and final_sha == ORIGINAL_SHA) else 1


if __name__ == "__main__":
    raise SystemExit(main())
