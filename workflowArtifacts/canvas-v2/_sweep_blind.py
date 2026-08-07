"""WP56/WP57 driver: re-run EVERY blind set in the project under the repaired
WP55 runner and leave one machine-readable record per (WP, set, framework).

This is measurement only. It changes no test, no implementation and no blind
file. It exists so the ledger can be transcribed from recorded evidence rather
than from a re-interpretation of console prose.

Usage:  python _sweep_blind.py [only-these-wp-numbers ...]
"""

from __future__ import annotations

import importlib.util
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent

_spec = importlib.util.spec_from_file_location("_run_blind", HERE / "_run_blind.py")
rb = importlib.util.module_from_spec(_spec)
sys.modules["_run_blind"] = rb
_spec.loader.exec_module(rb)


def wp_key(name: str) -> tuple[int, str]:
    digits = "".join(c for c in name if c.isdigit())
    return (int(digits) if digits else 0, name)


def main() -> int:
    wanted = {a.lstrip("wWpP") for a in sys.argv[1:]}

    sets: list[tuple[str, str]] = []
    for which in ("set1", "set2"):
        root = HERE / "tests" / f"blind_{which}"
        if not root.is_dir():
            continue
        for d in sorted((p for p in root.iterdir() if p.is_dir()), key=lambda p: wp_key(p.name)):
            wp = d.name[2:] if d.name.upper().startswith("WP") else d.name
            if wanted and wp not in wanted:
                continue
            sets.append((wp, which))

    print(f"[sweep] {len(sets)} (WP, set) pairs to run\n", flush=True)
    t0 = time.time()
    summary: list[str] = []

    for i, (wp, which) in enumerate(sets, 1):
        t = time.time()
        print(f"[{i}/{len(sets)}] WP{wp} {which} ...", flush=True)
        try:
            recs = rb.run_set(wp, which)
        except Exception as exc:  # never let one set abort the sweep
            print(f"    !! sweep-level exception: {exc}", flush=True)
            summary.append(f"WP{wp:>6} {which} {'sweep':8} SWEEP_EXCEPTION {exc}")
            continue
        for r in recs:
            line = (f"WP{wp:>6} {which} {r.framework:8} {r.verdict:20} "
                    f"collected={r.tests_collected:<5} pass={r.tests_passed:<5} "
                    f"fail={r.tests_failed:<4} files={r.files_staged:<3} "
                    f"{r.package}/{r.depth}")
            print(f"    {line}  [{time.time() - t:.1f}s]", flush=True)
            summary.append(line)

    rb.cleanup()
    print("\n" + "=" * 90)
    print(f"SWEEP COMPLETE in {time.time() - t0:.0f}s")
    print("=" * 90)
    for line in summary:
        print(line)

    leftover = [str(p) for p in rb.stage_roots() if p.exists()]
    print(f"\n[staging dirs remaining: {leftover or 'none'}]")
    print(f"[records: {rb.RECORDS}]")
    return 0


if __name__ == "__main__":
    sys.exit(main())
