"""Re-verify every B2 (P1 cores) blind set with the WP55-repaired runner.

Worker 3 / batch B2. The first eight WPs of this batch had their blind sets run
with the PRE-repair runner, which had three no-op paths. This driver re-runs all
ten WPs through the repaired `_run_blind.py` and prints one aggregate table with
the COLLECTED test count per set, so a zero-collection set is impossible to
mistake for a pass.
"""

import re
import subprocess
import sys
from pathlib import Path

ART = Path(__file__).resolve().parent
RUNNER = ART / "_run_blind.py"
WPS = ["8", "9", "10", "11", "12", "13", "14", "15", "16", "17"]

# The body runs until the NEXT "== WPn blind_setX" header (or EOF). It must NOT
# stop at the next "=====" rule, because the runner prints that rule immediately
# AFTER each header line -- terminating there captures an empty body and reports
# a false zero for every set.
ROW = re.compile(
    r"==\s*WP(\d+)\s+blind_(set\d)\s*\[[^\]]*\]\s*->\s*(\w+)"
    r"(.*?)(?=^==\s*WP\d+\s+blind_set|\Z)",
    re.S | re.M,
)
COLLECTED = re.compile(r"collected\s*:\s*(\d+)")
PASSFAIL = re.compile(r"passed/failed\s*:\s*(\d+)\s*/\s*(\d+)")
STAGED = re.compile(r"files staged\s*:\s*(\d+)")


def main() -> int:
    rows, bad = [], 0
    for wp in WPS:
        proc = subprocess.run(
            [sys.executable, str(RUNNER), wp, "both"],
            capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=900,
        )
        out = (proc.stdout or "") + (proc.stderr or "")
        found = ROW.findall(out)
        if not found:
            rows.append((wp, "?", "NO-PARSE", 0, 0, 0))
            bad += 1
            print(f"--- WP{wp} raw (unparsed) ---\n{out[-1500:]}")
            continue
        for _wp, s, verdict, body in found:
            c = int(COLLECTED.search(body).group(1)) if COLLECTED.search(body) else 0
            st = int(STAGED.search(body).group(1)) if STAGED.search(body) else 0
            pf = PASSFAIL.search(body)
            p, f = (int(pf.group(1)), int(pf.group(2))) if pf else (0, 0)
            rows.append((wp, s, verdict, st, c, f))
            if verdict.upper() != "PASS" or c == 0 or f != 0:
                bad += 1

    print("\n" + "=" * 74)
    print(f"{'WP':>4} {'set':>5} {'verdict':>8} {'staged':>7} {'collected':>10} {'failed':>7}")
    print("=" * 74)
    total = 0
    for wp, s, v, st, c, f in rows:
        flag = "" if (v.upper() == "PASS" and c > 0 and f == 0) else "   <== PROBLEM"
        total += c
        print(f"{wp:>4} {s:>5} {v:>8} {st:>7} {c:>10} {f:>7}{flag}")
    print("=" * 74)
    print(f"TOTAL BLIND TESTS EXECUTED ACROSS B2: {total}")
    print(f"PROBLEM SETS: {bad}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
