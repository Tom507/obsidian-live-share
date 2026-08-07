"""Enforce SIGNAL_REGISTER.md against the canvas-v2 corpus.

The register has been declared repaired twice and broke both times, because the
rule that governed it had no instrument. This is the instrument.

It checks CITATION HYGIENE, not truth:

  1. a BARE citation of an ambiguous number (S50 rather than S50(WP86)),
  2. a citation of a BURNED number (S58, S60),
  3. a citation AT OR ABOVE the next free number -- an allocation the register
     does not know about, which is precisely the event that broke it twice.

WHY A BASELINE. The first run found 136 violations, and most of them are in
TaskCharters and ImplementationReports: the immutable record of what a worker
did on a day. Rewriting those would falsify history to satisfy a linter. Leaving
the check permanently red would be worse -- a check that is always failing is a
check nobody runs, which is how the register broke the second time. So the
existing set is FROZEN into signal_register_baseline.json and the check fails
only on a citation that is NEW. The debt stays visible and stops growing.

The baseline is keyed by (file, kind, number) with a COUNT, not by line number:
line numbers drift on every edit, and a baseline that drifts is one that gets
regenerated instead of read.

POSITIVE CONTROL. Before it reports anything it plants one of each violation in
an in-memory sample and requires all three to be caught, requires two legal
citations NOT to be caught, and requires a new violation in a baselined file to
survive the baseline. If any of that fails it exits 2 with POSITIVE CONTROL
FAILED and reports NOTHING. A census that says "0 violations" without having
proved it can find one is a green that cannot fail, and this run has produced
twelve-plus of those across eight surfaces. A checker written to police the
bookkeeping is the last place to add another.

Usage:
    python check_signal_register.py            # check
    python check_signal_register.py --freeze   # rewrite the baseline (Dispatcher only)

Exit codes: 0 clean * 1 new violations * 2 the checker itself is broken.
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
BASELINE_PATH = HERE / "signal_register_baseline.json"

# -- the register's own facts. Change SIGNAL_REGISTER.md and this together. --
NEXT_FREE = 114
BURNED = {58, 60, 108}
AMBIGUOUS = {25, 28, 29, 30, 31, 50, 56, 57}

# The register defines these numbers, so it must be able to name them bare.
SELF = "SIGNAL_REGISTER.md"

# A citation is `S` + digits NOT followed by a qualifier `(...)`. The negative
# lookahead is what distinguishes S50 from S50(WP86); without it every correct
# citation would be reported and the checker would be noise from its first run.
BARE = re.compile(r"\bS(\d{1,3})\b(?!\s*\()")
QUALIFIED = re.compile(r"\bS(\d{1,3})\s*\(")

META = "<!-- signal-register: meta -->"
FENCE = re.compile(r"^\s*```")


def scan(text: str, origin: str) -> list[tuple[str, int, str, int, str]]:
    """Return (origin, lineno, kind, number, detail). Fences and META lines are exempt."""
    out: list[tuple[str, int, str, int, str]] = []
    in_fence = False
    for n, line in enumerate(text.splitlines(), 1):
        if FENCE.match(line):
            in_fence = not in_fence
            continue
        if in_fence or META in line:
            continue

        for m in BARE.finditer(line):
            num = int(m.group(1))
            if num in BURNED:
                out.append((origin, n, "BURNED", num, f"S{num} is burned - never allocate it"))
            elif num >= NEXT_FREE:
                out.append((origin, n, "UNKNOWN", num, f"S{num} >= next free S{NEXT_FREE}"))
            elif num in AMBIGUOUS:
                out.append((origin, n, "BARE", num, f"S{num} is ambiguous - needs a qualifier"))

        # A qualifier does not license an unallocated or burned number.
        for m in QUALIFIED.finditer(line):
            num = int(m.group(1))
            if num in BURNED:
                out.append((origin, n, "BURNED", num, f"S{num}(...) is burned - never allocate it"))
            elif num >= NEXT_FREE:
                out.append((origin, n, "UNKNOWN", num, f"S{num}(...) >= next free S{NEXT_FREE}"))
    return out


def census() -> tuple[list[tuple[str, int, str, int, str]], int]:
    files = sorted(p for p in HERE.rglob("*.md") if "node_modules" not in p.parts)
    found: list[tuple[str, int, str, int, str]] = []
    for path in files:
        rel = path.relative_to(HERE).as_posix()
        if rel == SELF:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError as e:
            print(f"WARN: unreadable {rel}: {e}")
            continue
        found.extend(scan(text, rel))
    return found, len(files)


def key(v: tuple[str, int, str, int, str]) -> str:
    origin, _line, kind, num, _detail = v
    return f"{origin}|{kind}|S{num}"


def positive_control() -> bool:
    """Every class must be caught; every legal form must not be; the baseline must
    not swallow a NEW violation in a file that already has baselined ones."""
    sample = "\n".join(
        [
            "the producing-side fix is S50 and unowned",   # BARE
            "raised as S58 during the sweep",              # BURNED
            f"filed as S{NEXT_FREE + 3} by the batch",     # UNKNOWN
        ]
    )
    kinds = {k for _, _, k, _, _ in scan(sample, "control")}
    if kinds != {"BARE", "BURNED", "UNKNOWN"}:
        print(f"POSITIVE CONTROL FAILED: caught {sorted(kinds)}, expected BARE/BURNED/UNKNOWN")
        return False

    for legal in ("S50(WP86) is the producing side", "S61 over-reports an editor"):
        if scan(legal, "control"):
            print(f"POSITIVE CONTROL FAILED: flagged a legal citation - {legal!r}")
            return False

    for exempt in (f"```\nS50 and S58 and S{NEXT_FREE}\n```", f"S50 bare {META}"):
        if scan(exempt, "control"):
            print("POSITIVE CONTROL FAILED: an exemption did not exempt")
            return False

    # The baseline must gate on COUNT, not on presence: one more bare S50 in a
    # file that already has one is exactly the regression this whole file exists
    # to catch, and a presence-keyed baseline would silently allow it.
    base = {"doc.md|BARE|S50": 1}
    got = Counter({"doc.md|BARE|S50": 2})
    if not [k for k, c in got.items() if c > base.get(k, 0)]:
        print("POSITIVE CONTROL FAILED: baseline did not catch an INCREASED count")
        return False
    return True


def main() -> int:
    if not positive_control():
        print("Reporting nothing: an unproven checker's silence is not evidence.")
        return 2

    found, n_files = census()
    if n_files <= 1:
        print(f"POSITIVE CONTROL FAILED: no markdown corpus under {HERE}")
        return 2

    counts = Counter(key(v) for v in found)

    if "--freeze" in sys.argv:
        BASELINE_PATH.write_text(
            json.dumps({"next_free": NEXT_FREE, "counts": dict(sorted(counts.items()))}, indent=2),
            encoding="utf-8",
        )
        print(f"froze {sum(counts.values())} existing citations across {len(counts)} keys")
        print(f"-> {BASELINE_PATH.name}. These are the historical record and will not fail the check.")
        return 0

    if not BASELINE_PATH.exists():
        print(f"No baseline at {BASELINE_PATH.name}. Run with --freeze once, then commit it.")
        return 2
    baseline = json.loads(BASELINE_PATH.read_text(encoding="utf-8")).get("counts", {})

    regressions = sorted(k for k, c in counts.items() if c > baseline.get(k, 0))
    print(f"scanned {n_files - 1} files under {HERE.name}/  (control: all classes proved)")
    print(f"baselined debt: {sum(baseline.values())} citations across {len(baseline)} keys")

    if not regressions:
        healed = sum(baseline.values()) - sum(counts.values())
        print(f"clean - no NEW violations." + (f" ({healed} baselined citations have since gone)" if healed > 0 else ""))
        return 0

    print(f"\n{len(regressions)} NEW violation key(s):")
    for k in regressions:
        origin, kind, sig = k.split("|")
        was, now = baseline.get(k, 0), counts[k]
        lines = [str(v[1]) for v in found if key(v) == k]
        print(f"  {kind:8} {origin}  {sig}  {was} -> {now}  (line(s) {', '.join(lines)})")
    print("\nFix by qualifying the citation (SIGNAL_REGISTER.md section 5), not by renumbering:")
    print("the bare numbers are already committed in charters, reports and source comments.")
    print("If the line is ABOUT the numbers, mark it with the meta comment - see section 5.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
