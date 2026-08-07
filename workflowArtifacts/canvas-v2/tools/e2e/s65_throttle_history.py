#!/usr/bin/env python3
"""S65 — reconstruct the renderer's timer stretch over the WHOLE log history.

Why this works. `SyncManager` pulses awareness on a `setInterval(4000)` and logs
the measured gap on EVERY pulse:

    gap  > 20000ms  ->  WARN  "AWARENESS GAP: <gap>ms ... (source=tick, ...)"
    gap <= 20000ms  ->  DEBUG "awareness pulse: gap <gap>ms (source=tick)"

So the debug log carries a continuous, self-recorded measurement of how far the
host stretched a 4 s interval timer. That is the same clamp that stretches
`DebugLogger`'s `setTimeout(FLUSH_DELAY_MS = 500)`, in a different module. It
therefore lets us ask, retroactively and for any past window:

    "was this process's timer machinery throttled at the time that
     measurement was taken?"

which is exactly what decides whether a 2 s read margin was adequate then.

Read-only. Never writes to a vault.
"""

import json
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

VAULTS = {
    "A": Path(r"H:\Developement\_NeuralAngels\ObsidianOrga\.obsidian\live-share-debug.md"),
    "B": Path(r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie\.obsidian\live-share-debug.md"),
}

STAMP = re.compile(r"^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}\.\d{3})Z")
GAP_WARN = re.compile(r"AWARENESS GAP: (\d+)ms")
GAP_DEBUG = re.compile(r"awareness pulse: gap (\d+)ms")

# Signatures whose ABSENCE has been used as evidence somewhere in canvas-v2.
SIGNATURES = [
    "CANVAS WRITE HELD:",
    "SHADOW STALE:",
    "CANVAS MIRROR:",
    "CANVAS WRITER:",
    "SEED REFUSED:",
    "LOG SINK:",
    "local modify ",
    "reconcile ",
]


def ts_of(line):
    m = STAMP.match(line)
    if not m:
        return None
    return datetime.strptime(m.group(1) + "T" + m.group(2) + "Z",
                             "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)


def bucket(ms):
    if ms <= 8000:
        return "<=8s (unthrottled: deadline is 8s)"
    if ms <= 20000:
        return "8-20s (mild)"
    if ms <= 40000:
        return "20-40s (throttled)"
    if ms <= 70000:
        return "40-70s (1-minute clamp)"
    return ">70s (severe)"


def main():
    report = {}
    for key, path in VAULTS.items():
        if not path.exists():
            print("MISSING: %s" % path)
            continue
        gaps = []          # (datetime, gap_ms)
        sig_hits = Counter()
        sig_first = {}
        sig_last = {}
        days = Counter()
        total = 0
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                total += 1
                t = ts_of(line)
                if t is not None:
                    days[t.date().isoformat()] += 1
                m = GAP_WARN.search(line) or GAP_DEBUG.search(line)
                if m and t is not None:
                    gaps.append((t, int(m.group(1))))
                for sig in SIGNATURES:
                    if sig in line:
                        sig_hits[sig] += 1
                        if t is not None:
                            sig_first.setdefault(sig, t)
                            sig_last[sig] = t

        print("=" * 78)
        print("VAULT %s  %s" % (key, path))
        print("  total lines: %d   distinct days: %d" % (total, len(days)))
        print("  lines per day: %s" % ", ".join(
            "%s=%d" % (d, n) for d, n in sorted(days.items())))
        print()
        print("  --- timer stretch, self-recorded (%d awareness pulses) ---" % len(gaps))
        b = Counter(bucket(g) for _, g in gaps)
        for name in ["<=8s (unthrottled: deadline is 8s)", "8-20s (mild)",
                     "20-40s (throttled)", "40-70s (1-minute clamp)", ">70s (severe)"]:
            if b.get(name):
                print("    %-34s %6d  (%5.1f%%)"
                      % (name, b[name], 100.0 * b[name] / max(1, len(gaps))))
        if gaps:
            vals = sorted(g for _, g in gaps)
            print("    min=%dms  median=%dms  p90=%dms  max=%dms"
                  % (vals[0], vals[len(vals) // 2], vals[int(len(vals) * 0.9)], vals[-1]))
            # per-day stretch profile: was the renderer throttled on that day?
            perday = {}
            for t, g in gaps:
                perday.setdefault(t.date().isoformat(), []).append(g)
            print()
            print("    per-day pulse-gap profile (decides whether a 2 s read margin")
            print("    was adequate on that day):")
            print("      %-12s %7s %9s %9s %9s" % ("day", "pulses", "median", "p90", "max"))
            for d in sorted(perday):
                v = sorted(perday[d])
                print("      %-12s %7d %8dms %8dms %8dms"
                      % (d, len(v), v[len(v) // 2], v[int(len(v) * 0.9)], v[-1]))
        print()
        print("  --- signature census over the WHOLE history (fully flushed) ---")
        for sig in SIGNATURES:
            n = sig_hits.get(sig, 0)
            if n:
                print("    %-22r %6d   first=%s  last=%s"
                      % (sig, n, sig_first[sig].isoformat(), sig_last[sig].isoformat()))
            else:
                print("    %-22r %6d   << ZERO over the entire retained history" % (sig, n))
        report[key] = {
            "total_lines": total,
            "pulses": len(gaps),
            "sig_hits": dict(sig_hits),
        }
    Path(r"H:\tmp\s65_throttle_history.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
