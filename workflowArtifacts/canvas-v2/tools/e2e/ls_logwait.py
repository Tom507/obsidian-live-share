#!/usr/bin/env python3
"""S65 — a debug-log reader whose empty result can never be mistaken for evidence.

THE DEFECT THIS REPLACES
------------------------
Every offset-based receipt reader in `H:\\tmp` had this shape:

    off = log_offset(role)          # remember where the file ends
    do_the_action()
    time.sleep(2.0)                 # "let the sink flush"
    lines = log_since(role, off)    # read what arrived
    if not any(SIG in ln for ln in lines):
        report("the signature never fired")     # <-- UNSOUND

The 2 s is a guess about someone else's flush policy. Measured on the live rig
(2026-08-07), the stamp-to-flush lag is **~60 s**, not 2 s, whenever the Obsidian
renderer's timers are being clamped by the host. At that lag the read returns
zero lines *always*, and the zero is reported as a result. A reader that returns
"no lines" because it is broken is indistinguishable from one returning "no
lines" because nothing happened. That equivalence is S65.

THE MECHANISM CHOSEN, AND WHY
-----------------------------
Not a marker line injected by this script. The debug log is appended by the
plugin through `vault.adapter.append`; a second writer appending into the same
file races the sink and corrupts the very stream being measured. An external
marker is off the table.

Instead: **the log's own newest stamp is used as a flush watermark.**

    W(role) := the timestamp of the newest parseable line currently on disk

W is a correct lower bound on what has been flushed, and this follows from the
sink's source (`plugin/src/debug-logger.ts`) rather than from hope:

  - `record()` appends the formatted line to `this.buffer` in call order;
  - `flush()` takes the ENTIRE buffer as one batch and appends it in one
    `adapter.append`, preserving order, one write in flight at a time;
  - therefore if a line stamped `W` is on disk, every line `record()`ed before
    it is on disk too - in the same batch or an earlier one.

So the rule is:

  >  An absence claim over the window [t_start, t_end] is admissible ONLY IF
  >  W >= t_end. Until then the reader knows nothing and must say so.

The reader polls for that condition and, if it does not arrive, raises a NAMED
failure. There is no code path that returns a bare empty list.

THREE HOLES, ALL GUARDED RATHER THAN ASSUMED AWAY
-------------------------------------------------
1. **A failing sink can drop lines and still advance W.** `onWriteSettled`'s
   error path re-queues the batch at the FRONT of `buffer` and, on
   `PENDING_CAP = 500` overflow, `splice`s the OLDEST lines away
   (`debug-logger.ts:390-395`). W could then pass a line that will never appear.
   Guard: the window and the file tail are scanned for WP81's own
   `LOG SINK: cannot write` announcement; if it is present, absence is refused.
2. **A pattern that cannot match anything proves nothing** (Rule 15). Guard:
   every signature carries a control - how many times that exact literal occurs
   in the retained history, and a matcher self-test. A signature with zero
   historical hits yields `UNINFORMATIVE`, not `ABSENT`.
3. **Clock identity.** Log stamps come from the plugin's `new Date()` and the
   watermark is compared against this process's `time.time()`. Both are UTC and
   both are assumed to be the SAME HOST CLOCK. Cross-machine use is unsound and
   `require_same_host=True` documents that this was a decision.

Run this file directly to execute the positive-control suite:

    python H:\\tmp\\ls_logwait.py selftest
"""

from __future__ import annotations

import json
import os
import re
import sys
import tempfile
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

__all__ = [
    "LogWaiter",
    "Mark",
    "Evidence",
    "FlushNotProven",
    "AbsenceNotAdmissible",
    "ABSENT",
    "PRESENT",
    "UNINFORMATIVE",
]

STAMP_RE = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3})Z")

# WP81's own announcement that the sink could not write. Its presence in or near
# the measured window means lines may have been dropped, so W is not a sound
# watermark for that window.
SINK_FAILURE_SIG = "LOG SINK: cannot write"

# Defaults. The timeout MUST exceed (worst observed flush lag + the period of
# the slowest thing that produces a line), because on an idle rig the watermark
# only advances when the next awareness pulse lands. Measured 2026-08-07:
# flush lag ~60 s, awareness pulse period ~60 s under clamping. 180 s leaves
# headroom for one missed pulse and is still a bounded, named failure.
DEFAULT_TIMEOUT_S = 180.0
DEFAULT_POLL_S = 0.25
# Slack added to t_end before the watermark is accepted, to absorb sub-millisecond
# stamp truncation and any residual clock skew between the two readers of the
# same clock.
WATERMARK_GUARD_S = 0.05

ABSENT = "ABSENT"
PRESENT = "PRESENT"
UNINFORMATIVE = "UNINFORMATIVE"


class FlushNotProven(RuntimeError):
    """The log never demonstrably caught up with the action window.

    This is a FAILURE OF THE INSTRUMENT, not a measurement. It must never be
    rendered as "the signature did not fire".
    """


class AbsenceNotAdmissible(RuntimeError):
    """An absence was asserted that this reader cannot support."""


def parse_stamp(line: str):
    m = STAMP_RE.match(line)
    if not m:
        return None
    return (
        datetime.strptime(m.group(1), "%Y-%m-%dT%H:%M:%S.%f")
        .replace(tzinfo=timezone.utc)
        .timestamp()
    )


def newest_stamp(path: Path, tail_bytes: int = 262144):
    """W(role): the newest parseable stamp currently on disk, or None."""
    try:
        size = path.stat().st_size
    except OSError:
        return None
    if size == 0:
        return None
    start = max(0, size - tail_bytes)
    try:
        with path.open("rb") as fh:
            fh.seek(start)
            blob = fh.read(size - start)
    except OSError:
        return None
    text = blob.decode("utf-8", "replace")
    for line in reversed(text.split("\n")):
        if not line.strip():
            continue
        ts = parse_stamp(line)
        if ts is not None:
            return ts
    return None


@dataclass
class Mark:
    """Byte offsets and the action window. `close()` ends the window."""

    offsets: dict = field(default_factory=dict)
    t_start: float = 0.0
    t_end: float | None = None
    label: str = ""

    def close(self) -> "Mark":
        """Call IMMEDIATELY after the action under test. Ends the window."""
        if self.t_end is None:
            self.t_end = time.time()
        return self


@dataclass
class Evidence:
    """What the log actually supports. Absence is only reachable via `verdict`."""

    label: str
    lines: dict           # role -> [str]
    watermark: dict       # role -> float | None
    t_start: float
    t_end: float
    flush_proven: bool
    waited_s: float
    controls: dict        # signature -> {"history_hits", "matcher_ok"}
    sink_failed: dict     # role -> bool

    def hits(self, sig: str, role: str | None = None) -> list:
        roles = [role] if role else list(self.lines)
        return [ln for r in roles for ln in self.lines[r] if sig in ln]

    def verdict(self, sig: str, role: str | None = None) -> str:
        """PRESENT / ABSENT / UNINFORMATIVE — never a bare empty list.

        ABSENT is returned only when the reader has POSITIVELY established that
        the log was flushed past `t_end`, that the sink did not fail in the
        window, and that the signature is one this product has actually been
        observed to emit.
        """
        found = self.hits(sig, role)
        if found:
            return PRESENT
        if not self.flush_proven:
            raise FlushNotProven(
                "%s: watermark never reached t_end (waited %.1fs). "
                "The log was NOT shown to be flushed past the action, so this "
                "read says nothing about whether %r fired."
                % (self.label, self.waited_s, sig)
            )
        roles = [role] if role else list(self.lines)
        if any(self.sink_failed.get(r) for r in roles):
            return UNINFORMATIVE
        if self.controls.get(sig, {}).get("history_hits", 0) <= 0:
            return UNINFORMATIVE
        return ABSENT

    def assert_absent(self, sig: str, role: str | None = None) -> bool:
        v = self.verdict(sig, role)
        if v == ABSENT:
            return True
        if v == PRESENT:
            return False
        raise AbsenceNotAdmissible(
            "%s: cannot support an absence claim for %r - verdict %s. "
            "Either the sink reported a write failure in this window, or the "
            "signature has never been seen in the retained history (pattern "
            "unproven, rule 15)." % (self.label, sig, v)
        )

    def summary(self) -> str:
        out = ["%s  flush_proven=%s waited=%.1fs" % (self.label, self.flush_proven, self.waited_s)]
        for r in sorted(self.lines):
            w = self.watermark.get(r)
            out.append(
                "  [%s] %d lines  W=%s  W-t_end=%s  sink_failed=%s"
                % (
                    r,
                    len(self.lines[r]),
                    "None" if w is None else "%.3f" % w,
                    "n/a" if w is None else "%+.1fs" % (w - self.t_end),
                    self.sink_failed.get(r),
                )
            )
        for sig, c in sorted(self.controls.items()):
            out.append(
                "  control %-24r history_hits=%-6d matcher_ok=%s"
                % (sig, c["history_hits"], c["matcher_ok"])
            )
        return "\n".join(out)


class LogWaiter:
    """Bounded-poll reader over one or more append-only stamped log files."""

    def __init__(self, paths: dict, require_same_host: bool = True):
        self.paths = {k: Path(v) for k, v in paths.items()}
        self.require_same_host = require_same_host
        self._history_cache: dict = {}

    # -- offsets -----------------------------------------------------------
    def _size(self, role: str) -> int:
        try:
            return self.paths[role].stat().st_size
        except OSError:
            return 0

    def mark(self, label: str = "") -> Mark:
        return Mark(
            offsets={r: self._size(r) for r in self.paths},
            t_start=time.time(),
            label=label,
        )

    def _since(self, role: str, offset: int) -> list:
        p = self.paths[role]
        if not p.exists():
            return []
        try:
            with p.open("rb") as fh:
                fh.seek(offset)
                blob = fh.read()
        except OSError:
            return []
        return [ln for ln in blob.decode("utf-8", "replace").split("\n") if ln.strip()]

    # -- rule 15 control ---------------------------------------------------
    def history_hits(self, sig: str) -> int:
        """How many times this exact literal occurs in the retained history.

        A signature with zero historical hits cannot support an absence claim:
        the pattern has never been shown able to match anything this product
        emitted, so a zero now is uninformative rather than negative.
        """
        if sig in self._history_cache:
            return self._history_cache[sig]
        n = 0
        for p in self.paths.values():
            if not p.exists():
                continue
            try:
                with p.open("r", encoding="utf-8", errors="replace") as fh:
                    for line in fh:
                        if sig in line:
                            n += 1
            except OSError:
                pass
        self._history_cache[sig] = n
        return n

    @staticmethod
    def matcher_ok(sig: str) -> bool:
        """Self-test of the matcher on a fabricated line containing `sig`.

        Weak on its own - it proves the comparison works, not that `sig` is the
        right string - but it catches an empty/None pattern, which is the way a
        census silently matches nothing.
        """
        if not sig:
            return False
        probe = "2026-01-01T00:00:00.000Z [INFO] [ctl] %s synthetic-control" % sig
        return sig in probe

    # -- the main entry point ---------------------------------------------
    def collect(
        self,
        mark: Mark,
        signatures,
        timeout_s: float = DEFAULT_TIMEOUT_S,
        poll_s: float = DEFAULT_POLL_S,
        roles=None,
        on_wait=None,
    ) -> Evidence:
        """Wait until the log is provably flushed past `mark.t_end`, then read.

        Raises `FlushNotProven` only when the caller asks for a verdict it
        cannot have; `collect` itself always returns an Evidence carrying
        `flush_proven=False` so the caller can report the timeout honestly.
        """
        mark.close()
        watch = list(roles) if roles else list(self.paths)
        deadline = time.monotonic() + timeout_s
        target = mark.t_end + WATERMARK_GUARD_S
        t0 = time.monotonic()
        watermark = {}
        while True:
            watermark = {r: newest_stamp(self.paths[r]) for r in watch}
            proven = all(w is not None and w >= target for w in watermark.values())
            if proven or time.monotonic() >= deadline:
                break
            if on_wait:
                on_wait(watermark, target)
            time.sleep(poll_s)
        waited = time.monotonic() - t0

        lines = {r: self._since(r, mark.offsets.get(r, 0)) for r in watch}
        sink_failed = {}
        for r in watch:
            tail = lines[r]
            sink_failed[r] = any(SINK_FAILURE_SIG in ln for ln in tail)
        controls = {
            s: {"history_hits": self.history_hits(s), "matcher_ok": self.matcher_ok(s)}
            for s in signatures
        }
        return Evidence(
            label=mark.label or "unlabelled",
            lines=lines,
            watermark=watermark,
            t_start=mark.t_start,
            t_end=mark.t_end,
            flush_proven=all(
                w is not None and w >= target for w in watermark.values()
            ),
            waited_s=waited,
            controls=controls,
            sink_failed=sink_failed,
        )


def wait_for_flush(
    paths: dict,
    t_end: float | None = None,
    timeout_s: float = DEFAULT_TIMEOUT_S,
    poll_s: float = DEFAULT_POLL_S,
    label: str = "",
    strict: bool = True,
) -> dict:
    """Drop-in replacement for `time.sleep(FLUSH_MARGIN_S)` before a log read.

    Blocks until EVERY path's newest on-disk stamp has passed `t_end` (default:
    the moment of the call, which is >= the end of the action that just ran).

    On timeout it RAISES `FlushNotProven`. That is deliberate and is the whole
    repair: the caller is a measurement script, and a loud abort is strictly
    better than a silent zero that gets written into a report as "the signature
    never fired". Pass `strict=False` only if the caller is itself going to
    report `flush_proven=False` explicitly.

    Returns the per-role watermark dict.
    """
    if t_end is None:
        t_end = time.time()
    target = t_end + WATERMARK_GUARD_S
    paths = {k: Path(v) for k, v in paths.items()}
    deadline = time.monotonic() + timeout_s
    t0 = time.monotonic()
    while True:
        wm = {r: newest_stamp(p) for r, p in paths.items()}
        if all(w is not None and w >= target for w in wm.values()):
            return wm
        if time.monotonic() >= deadline:
            break
        time.sleep(poll_s)
    behind = {
        r: ("no stamped line" if w is None else "%.1fs behind t_end" % (t_end - w))
        for r, w in wm.items()
    }
    msg = (
        "FLUSH NOT PROVEN%s after %.1fs: %s. "
        "The log was NOT shown to be flushed past the action. Any zero-hit "
        "read taken now is UNINFORMATIVE and MUST NOT be reported as "
        "'the signature did not fire' (S65)."
        % (" [%s]" % label if label else "", time.monotonic() - t0, behind)
    )
    if strict:
        raise FlushNotProven(msg)
    print("!! " + msg)
    return wm


# =============================================================================
# POSITIVE CONTROL SUITE
# =============================================================================
# "It must not become the thing it repairs." Every one of these controls proves
# the reader can detect a signature that DID fire, or that it names its own
# failure, before anything is trusted to report one that did not.
#
# P1 is the direct S65 reproduction: the old sleep-2 s reader MISSES a line that
# really was emitted; the new reader FINDS it. If P1's old-reader arm ever stops
# missing, the control has gone vacuous and the suite says so.
# =============================================================================


class _FakeSink:
    """A stand-in for DebugLogger: stamps at record time, appends later."""

    def __init__(self, path: Path):
        self.path = path
        self.path.write_text("", encoding="utf-8")
        self._threads = []

    def emit(self, message: str, flush_lag_s: float, category: str = "canvas"):
        """Stamp NOW, land on disk `flush_lag_s` later. This is the whole defect."""
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
        line = "%s [INFO] [%s] %s\n" % (ts, category, message)

        def _later():
            time.sleep(flush_lag_s)
            with self.path.open("a", encoding="utf-8") as fh:
                fh.write(line)

        t = threading.Thread(target=_later, daemon=True)
        t.start()
        self._threads.append(t)

    def join(self):
        for t in self._threads:
            t.join(timeout=30)


def _old_style_read(path: Path, offset: int, margin: float, sig: str) -> bool:
    """The reader being replaced, reproduced exactly: sleep a fixed margin, read."""
    time.sleep(margin)
    with path.open("rb") as fh:
        fh.seek(offset)
        blob = fh.read()
    return any(sig in ln for ln in blob.decode("utf-8", "replace").split("\n"))


def selftest() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="s65_ctl_"))
    results = []

    def record(name, ok, detail=""):
        results.append((name, ok, detail))
        print("  %-4s %-58s %s" % ("PASS" if ok else "FAIL", name, detail))

    print("=" * 78)
    print("S65 POSITIVE CONTROL SUITE for ls_logwait.LogWaiter")
    print("=" * 78)

    LAG = 6.0          # simulated flush lag, well past the old 2-2.5 s margin
    OLD_MARGIN = 2.0   # the margin every existing reader used
    SIG = "CANVAS WRITE HELD:"

    # ---- P1: detects a signature that DID fire, where the old reader could not
    print("\nP1  a signature that DID fire, behind a %.0fs flush lag" % LAG)
    p = tmp / "p1.md"
    sink = _FakeSink(p)
    # history so the rule-15 control can pass (the literal has been emitted before)
    with p.open("a", encoding="utf-8") as fh:
        fh.write("2026-08-01T00:00:00.000Z [INFO] [canvas] %s historic\n" % SIG)
    w = LogWaiter({"A": p})
    m = w.mark("P1")
    off = m.offsets["A"]
    sink.emit("%s node=c1 reason=editor-open" % SIG, LAG)
    m.close()
    # The awareness tick that lands after the action and advances the watermark.
    # Without it the sink is silent and P1 would (correctly) time out. Stamped
    # 0.2 s after t_end, as a real tick would be.
    time.sleep(0.2)
    sink.emit("AWARENESS GAP: 60000ms since the previous awareness pulse", LAG, "sync")
    old_found = _old_style_read(p, off, OLD_MARGIN, SIG)
    ev = w.collect(m, [SIG], timeout_s=30)
    new_found = ev.verdict(SIG) == PRESENT
    record("P1a old sleep-%.1fs reader MISSES the line it should see" % OLD_MARGIN,
           old_found is False,
           "old_found=%s  <-- if this ever passes, the control is vacuous" % old_found)
    record("P1b new reader FINDS it", new_found,
           "waited=%.1fs flush_proven=%s" % (ev.waited_s, ev.flush_proven))
    record("P1c new reader waited past the lag", ev.waited_s >= LAG - OLD_MARGIN - 0.5,
           "waited=%.1fs vs lag=%.1fs" % (ev.waited_s, LAG))
    sink.join()

    # ---- P2: names its own failure instead of reporting absence
    print("\nP2  nothing is ever written after the action")
    p = tmp / "p2.md"
    p.write_text("2026-08-01T00:00:00.000Z [INFO] [canvas] %s historic\n" % SIG,
                 encoding="utf-8")
    w = LogWaiter({"A": p})
    m = w.mark("P2")
    m.close()
    ev = w.collect(m, [SIG], timeout_s=3, poll_s=0.2)
    record("P2a flush_proven is False", ev.flush_proven is False)
    raised = False
    try:
        ev.verdict(SIG)
    except FlushNotProven:
        raised = True
    record("P2b verdict() raises FlushNotProven, does not say ABSENT", raised)
    raised2 = False
    try:
        ev.assert_absent(SIG)
    except FlushNotProven:
        raised2 = True
    record("P2c assert_absent() also refuses", raised2)

    # ---- P3: a TRUE absence, admissible, once flush is proven
    print("\nP3  the signature genuinely did not fire, but the log moved on")
    p = tmp / "p3.md"
    sink = _FakeSink(p)
    with p.open("a", encoding="utf-8") as fh:
        fh.write("2026-08-01T00:00:00.000Z [INFO] [canvas] %s historic\n" % SIG)
    w = LogWaiter({"A": p})
    m = w.mark("P3")
    # the action happens and logs NOTHING; the next tick is stamped after t_end
    m.close()
    time.sleep(0.2)
    sink.emit("AWARENESS GAP: 60000ms since the previous awareness pulse", LAG, "sync")
    ev = w.collect(m, [SIG], timeout_s=30)
    record("P3a flush proven by an UNRELATED line advancing the watermark",
           ev.flush_proven is True, "waited=%.1fs" % ev.waited_s)
    record("P3b verdict is ABSENT", ev.verdict(SIG) == ABSENT)
    record("P3c assert_absent() returns True", ev.assert_absent(SIG) is True)
    sink.join()

    # ---- P4: a failing sink poisons the watermark, absence refused
    print("\nP4  the sink reported a write failure inside the window")
    p = tmp / "p4.md"
    sink = _FakeSink(p)
    with p.open("a", encoding="utf-8") as fh:
        fh.write("2026-08-01T00:00:00.000Z [INFO] [canvas] %s historic\n" % SIG)
    w = LogWaiter({"A": p})
    m = w.mark("P4")
    m.close()
    time.sleep(0.2)
    sink.emit("%s /x/y.md: EPERM (further failures are counted, not announced)"
              % SINK_FAILURE_SIG, LAG, "log-sink")
    ev = w.collect(m, [SIG], timeout_s=30)
    record("P4a sink failure detected", ev.sink_failed.get("A") is True)
    record("P4b verdict is UNINFORMATIVE, not ABSENT", ev.verdict(SIG) == UNINFORMATIVE)
    refused = False
    try:
        ev.assert_absent(SIG)
    except AbsenceNotAdmissible:
        refused = True
    record("P4c assert_absent() refuses", refused)
    sink.join()

    # ---- P5: rule 15 - a signature never seen cannot support an absence
    print("\nP5  rule 15: a pattern never shown able to match anything")
    p = tmp / "p5.md"
    sink = _FakeSink(p)
    p.write_text("", encoding="utf-8")
    w = LogWaiter({"A": p})
    m = w.mark("P5")
    m.close()
    time.sleep(0.2)
    sink.emit("AWARENESS GAP: 60000ms since the previous awareness pulse", 1.0, "sync")
    ev = w.collect(m, ["TYPO WRITE HELD:"], timeout_s=30)
    record("P5a flush proven", ev.flush_proven is True)
    record("P5b history_hits == 0 for the never-seen signature",
           ev.controls["TYPO WRITE HELD:"]["history_hits"] == 0)
    record("P5c verdict is UNINFORMATIVE, not ABSENT",
           ev.verdict("TYPO WRITE HELD:") == UNINFORMATIVE)
    sink.join()

    # ---- P6: the matcher self-test itself can fail
    print("\nP6  the matcher self-test is not vacuous")
    record("P6a a real signature passes the matcher", LogWaiter.matcher_ok(SIG) is True)
    record("P6b an empty pattern FAILS the matcher", LogWaiter.matcher_ok("") is False)

    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print("\n" + "=" * 78)
    print("POSITIVE CONTROL: %d/%d passed" % (passed, total))
    if passed != total:
        print("CONTROL FAILED - this reader is NOT trustworthy. Report nothing.")
        return 1
    print("Controls green. The reader detects a signature that fired (P1), names")
    print("its own failure instead of reporting absence (P2), admits a true")
    print("absence only once flush is proven (P3), and refuses an absence when")
    print("the sink failed (P4) or the pattern is unproven (P5).")
    return 0


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "selftest":
        sys.exit(selftest())
    print(__doc__)
    print("usage: python ls_logwait.py selftest")
