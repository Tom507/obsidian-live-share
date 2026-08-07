#!/usr/bin/env python3
"""S65 — re-adjudicate past zero-hit claims against the NOW-FLUSHED log.

The key asymmetry S65 does NOT invalidate: the flush lag corrupts a read taken
SHORTLY AFTER an action. It does not corrupt the log's eventual content. A batch
that read its window 2 s after the action saw an empty file; the same window read
25 hours later is fully flushed and settles the question outright.

So every past "zero hits" claim whose window is still inside the retained log can
be RE-DECIDED rather than merely doubted - provided the scan carries a positive
control.

POSITIVE CONTROL (the whole point). For each signature the scan is first pointed
at a window where the signature IS known to occur. If it does not find it there,
the scan is broken and this script reports NOTHING. A census that returns "0"
without having proved it can return non-zero is not a measurement.

Read-only.
"""

import re
import sys
from datetime import datetime, timezone
from pathlib import Path

VAULTS = {
    "A": Path(r"H:\Developement\_NeuralAngels\ObsidianOrga\.obsidian\live-share-debug.md"),
    "B": Path(r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie\.obsidian\live-share-debug.md"),
}

STAMP = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3})Z")


def ts(line):
    m = STAMP.match(line)
    if not m:
        return None
    return datetime.strptime(m.group(1), "%Y-%m-%dT%H:%M:%S.%f").replace(
        tzinfo=timezone.utc)


def U(s):
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def scan(sig, lo, hi):
    """Literal substring scan (never a regex - no metacharacter can widen it)."""
    out = {}
    for role, path in VAULTS.items():
        hits = []
        if not path.exists():
            out[role] = None
            continue
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if sig not in line:
                    continue
                t = ts(line)
                if t is None:
                    continue
                if lo <= t <= hi:
                    hits.append((t, line.rstrip()))
        out[role] = hits
    return out


def coverage(lo, hi):
    """Does the retained log even span this window? Absence outside it is void."""
    out = {}
    for role, path in VAULTS.items():
        first = last = None
        n = 0
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                t = ts(line)
                if t is None:
                    continue
                if first is None:
                    first = t
                last = t
                if lo <= t <= hi:
                    n += 1
        out[role] = (first, last, n)
    return out


# --- the windows under adjudication -----------------------------------------
# B44's three ladder runs: local stamps 00:45:34 / 00:54:27 / 00:55:42 on
# 2026-08-07 (+02:00), from the artefact filenames b41_observe_*.json in H:\tmp.
B44 = (U("2026-08-06T22:40:00Z"), U("2026-08-06T23:05:00Z"))
# B41's earlier ladder run 130817 -> 2026-08-05 13:08 local = 11:08 UTC.
B41_LADDER = (U("2026-08-05T11:00:00Z"), U("2026-08-05T11:35:00Z"))

# Windows where the signatures ARE known to occur, from the whole-history census.
CTL = {
    "CANVAS WRITE HELD:": (U("2026-08-05T09:30:00Z"), U("2026-08-05T10:20:00Z")),
    "SHADOW STALE:": (U("2026-08-05T09:00:00Z"), U("2026-08-05T10:00:00Z")),
}

SIGS = ["CANVAS WRITE HELD:", "SHADOW STALE:"]


def main():
    print("=" * 78)
    print("S65 RE-ADJUDICATION — past zero-hit claims vs. the now-flushed log")
    print("=" * 78)
    print("TOOL: Python literal `sig in line`. No regex, no `grep -o`, no")
    print("      metacharacter. Same discipline the corpus calls rule 15.")

    # ---- POSITIVE CONTROL FIRST. Report nothing if it fails. ----------------
    print("\n" + "-" * 78)
    print("POSITIVE CONTROL — the scan must find each signature where it IS present")
    print("-" * 78)
    control_ok = True
    for sig in SIGS:
        lo, hi = CTL[sig]
        res = scan(sig, lo, hi)
        tot = sum(len(v) for v in res.values() if v is not None)
        ok = tot > 0
        control_ok = control_ok and ok
        print("  %-22r %s..%s  -> A=%d B=%d  %s"
              % (sig, lo.strftime("%m-%dT%H:%M"), hi.strftime("%H:%M"),
                 len(res["A"] or []), len(res["B"] or []),
                 "OK" if ok else "<< CONTROL FAILED"))
        if ok:
            for role in ("A", "B"):
                if res[role]:
                    print("       e.g. [%s] %s" % (role, res[role][0][1][:118]))
    if not control_ok:
        print("\nPOSITIVE CONTROL FAILED — the scan cannot find these signatures")
        print("anywhere. Reporting nothing; no absence claim may be made.")
        return 1
    print("\n  Control green: the literals are matchable and this product does")
    print("  emit them. A zero elsewhere is therefore a real absence.")

    # ---- the windows -------------------------------------------------------
    for name, (lo, hi) in [("B44 ladder runs (004534/005427/005542)", B44),
                           ("B41 ladder run 130817", B41_LADDER)]:
        print("\n" + "-" * 78)
        print("WINDOW: %s" % name)
        print("        %s .. %s UTC" % (lo.isoformat(), hi.isoformat()))
        print("-" * 78)
        cov = coverage(lo, hi)
        spanned = True
        for role, (first, last, n) in cov.items():
            inside = first is not None and first <= lo and last >= hi
            spanned = spanned and inside
            print("  [%s] retained log spans %s .. %s ; %d stamped lines inside "
                  "the window ; window covered=%s"
                  % (role, first.isoformat() if first else "?",
                     last.isoformat() if last else "?", n, inside))
        if not spanned:
            print("  !! the retained log does NOT span this window - the claim is")
            print("     UNDECIDABLE from this instrument, not confirmed.")
            continue
        if all(n == 0 for _, _, n in cov.values()):
            print("  !! ZERO lines of ANY kind in this window on at least one vault.")
            print("     The log was not being written then; absence proves nothing.")
            continue
        for sig in SIGS:
            res = scan(sig, lo, hi)
            a, b = len(res["A"] or []), len(res["B"] or [])
            verdict = "ABSENT (confirmed)" if a + b == 0 else "PRESENT"
            print("  %-22r A=%-4d B=%-4d  -> %s" % (sig, a, b, verdict))
            for role in ("A", "B"):
                for t, line in (res[role] or [])[:3]:
                    print("       [%s] %s" % (role, line[:118]))

    print("\n" + "=" * 78)
    print("Note on what this can and cannot settle: it re-decides the CONTENT of")
    print("the log for a past window. It does not retroactively make the original")
    print("2 s-margin reader sound - that reader could not have known, and on a")
    print("window where the signature HAD fired it would have reported zero all")
    print("the same. The instrument stays condemned; this only rescues the answer.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
