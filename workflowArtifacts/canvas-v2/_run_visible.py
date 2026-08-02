"""WP58 regression gate: run the visible suites that cover the touched seam.

Targets the four WPs that share `plugin/src/testing/e2e-control.ts` (WP44, WP46,
WP47, WP49) plus the control-module suite itself. Counts come from vitest's JSON
reporter, never from prose.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
PLUGIN = REPO / "plugin"
OUT = HERE / "_blind_records" / "_raw"

TARGETS = [
    "src/__tests__/e2e-control.test.ts",
    "src/__tests__/wp46/",
    "src/__tests__/wp47/",
    "src/__tests__/wp49/",
    "src/__tests__/t3/wp44/",
]

for s in (sys.stdout, sys.stderr):
    try:
        s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    jf = OUT / "visible_wp58_gate.json"
    if jf.exists():
        jf.unlink()
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    proc = subprocess.run(
        ["npx", "vitest", "run", *TARGETS, "--reporter=json", f"--outputFile={jf}"],
        cwd=str(PLUGIN), capture_output=True, text=True,
        encoding="utf-8", errors="replace", shell=True, timeout=900, env=env,
    )
    print(f"exit={proc.returncode}")
    if not jf.is_file():
        print("NO STRUCTURED OUTPUT -- cannot evidence a pass")
        print((proc.stdout or "")[-3000:])
        print((proc.stderr or "")[-3000:])
        return 1
    d = json.loads(jf.read_text(encoding="utf-8", errors="replace"))
    tot = d.get("numTotalTests", 0)
    ok = d.get("numPassedTests", 0)
    bad = d.get("numFailedTests", 0)
    print(f"VISIBLE GATE: collected={tot} passed={ok} failed={bad}")
    if bad:
        for tr in d.get("testResults", []):
            for a in tr.get("assertionResults", []):
                if a.get("status") == "failed":
                    print("  FAIL:", os.path.basename(tr.get("name", "?")), "::",
                          (a.get("fullName") or a.get("title"))[:120])
    if tot <= 0:
        print("ZERO COLLECTION -- not a pass")
        return 1
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
