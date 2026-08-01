"""Stage -> run -> ALWAYS clean up a WP's blind test sets.

Worker 3 tooling for the Canvas V2 batches. Addresses the B1 automation candidate:
manual staging into plugin/src/__tests__/v2blind/ was error-prone and a forgotten
cleanup breached context isolation for a later sub-agent.

Usage:  python _run_blind.py <WP-number> [set1|set2|both]

Guarantees:
  - staging dir is removed in a finally block, even on failure or KeyboardInterrupt
  - uses the trailing-slash path form (src/__tests__/v2blind/) because vitest
    matches 'v2' against 'v2blind' by substring
  - --reporter=dot (Vitest 4 removed the 'basic' reporter)
"""

import shutil
import subprocess
import sys
from pathlib import Path

ART = Path(__file__).resolve().parent
REPO = ART.parent.parent
PLUGIN = REPO / "plugin"
STAGE_ROOT = PLUGIN / "src" / "__tests__" / "v2blind"


def run_set(wp: str, which: str) -> tuple[str, int, str]:
    src = ART / "tests" / f"blind_{which}" / f"WP{wp}"
    if not src.is_dir():
        return (which, -1, f"NO SUCH SET: {src}")

    stage = STAGE_ROOT / f"wp{wp}_{which}"
    try:
        if STAGE_ROOT.exists():
            shutil.rmtree(STAGE_ROOT)
        stage.mkdir(parents=True)
        for f in sorted(src.glob("*.ts")):
            shutil.copy2(f, stage / f.name)

        rel = f"src/__tests__/v2blind/wp{wp}_{which}/"
        proc = subprocess.run(
            ["npx", "vitest", "run", rel, "--reporter=dot"],
            cwd=str(PLUGIN),
            capture_output=True,
            text=True,
            shell=True,
            timeout=600,
        )
        out = (proc.stdout or "") + (proc.stderr or "")
        return (which, proc.returncode, out)
    finally:
        # ALWAYS clean up - a leftover staging dir leaks blind tests to the next
        # coder sub-agent and breaks context isolation (B1 process failure #3).
        if STAGE_ROOT.exists():
            shutil.rmtree(STAGE_ROOT, ignore_errors=True)


def tail(text: str, n: int = 30) -> str:
    lines = [ln for ln in text.splitlines() if ln.strip()]
    return "\n".join(lines[-n:])


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    wp = sys.argv[1].lstrip("wWpP")
    which = sys.argv[2] if len(sys.argv) > 2 else "both"
    sets = ["set1", "set2"] if which == "both" else [which]

    worst = 0
    for s in sets:
        name, code, out = run_set(wp, s)
        print(f"\n{'=' * 70}\n== WP{wp} blind_{name}  (exit {code})\n{'=' * 70}")
        print(tail(out))
        if code != 0:
            worst = code if code > 0 else 1

    # paranoia: assert the staging dir is really gone
    if STAGE_ROOT.exists():
        print(f"\n!! STAGING NOT CLEANED: {STAGE_ROOT}")
        return 99
    print(f"\n[staging clean: {STAGE_ROOT} absent]")
    return worst


if __name__ == "__main__":
    sys.exit(main())
