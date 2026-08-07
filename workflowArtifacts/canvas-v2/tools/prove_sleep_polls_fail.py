"""S56 FALSIFICATION HARNESS - executed proof that every converted wait FAILS.

A poll that cannot time out, or whose failure message does not name the
condition, is not an improvement over the sleep it replaced. This harness runs
each converted script's own `await_state` (imported from the file, not a copy)
against:

  NEGATIVE  a predicate that is known false          -> must return False,
                                                        must print a timeout
                                                        line NAMING the label,
                                                        must not exceed budget
  POSITIVE  a predicate that is known true           -> must return True
  RAISING   a predicate that raises every time       -> must return False, and
                                                        must NOT propagate

The POSITIVE arm is the control: without it a helper hard-wired to return False
would pass the negative arm perfectly, which is this project's own vacuity class
one level down.
"""
from __future__ import annotations

import importlib.util
import io
import contextlib
import sys
import time
from pathlib import Path

FILES = [
    "liveshare_e2e.py",
    "liveshare_wp80_e2e.py",
    "liveshare_wp86_e2e.py",
    "liveshare_wp82.py",
    "liveshare_dataloss_e2e.py",
]

LABEL = "a state NOTHING will ever produce (falsification probe)"
BUDGET = 0.6

rows: list[tuple[str, str, bool, str]] = []


def load(name: str):
    spec = importlib.util.spec_from_file_location(f"_b39_{name[:-3]}", Path("H:/tmp") / name)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def row(f: str, arm: str, ok: bool, detail: str) -> None:
    rows.append((f, arm, ok, detail))
    print(f"  {'PASS' if ok else '>>> FAIL'}  {f} :: {arm}    {detail}")


def raiser():
    raise RuntimeError("the probe cannot answer")


for f in FILES:
    mod = load(f)
    aw = getattr(mod, "await_state")

    # --- NEGATIVE -----------------------------------------------------------
    buf = io.StringIO()
    t0 = time.monotonic()
    with contextlib.redirect_stdout(buf):
        got = aw(LABEL, lambda: False, BUDGET)
    took = time.monotonic() - t0
    out = buf.getvalue()
    row(f, "NEGATIVE returns False", got is False, f"returned={got!r}")
    row(f, "NEGATIVE says it TIMED OUT", "WAIT TIMED OUT" in out, repr(out.strip()[:110]))
    row(f, "NEGATIVE NAMES the condition", LABEL in out, "the label appears verbatim in the message")
    row(f, "NEGATIVE states the budget it burned", f"{BUDGET:.1f}s" in out, repr(out.strip()[:60]))
    row(f, "NEGATIVE terminates within the budget (+1 s)", took < BUDGET + 1.0, f"took={took:.2f}s")

    # --- POSITIVE (the control) --------------------------------------------
    buf = io.StringIO()
    t0 = time.monotonic()
    with contextlib.redirect_stdout(buf):
        got = aw("a state that is ALREADY true (positive control)", lambda: True, BUDGET)
    took_pos = time.monotonic() - t0
    out_pos = buf.getvalue()
    row(f, "POSITIVE returns True", got is True, f"returned={got!r}")
    row(f, "POSITIVE does NOT report a timeout", "WAIT TIMED OUT" not in out_pos,
        repr(out_pos.strip()[:110]))

    # --- FAST band ends early, SCHEDULE band does not -----------------------
    row(f, "POSITIVE holds the budget in the SCHEDULE band (the default)",
        (took_pos >= BUDGET * 0.8) if not mod.S56_FAST else (took_pos < BUDGET * 0.8),
        f"S56_FAST={mod.S56_FAST} took={took_pos:.2f}s of {BUDGET}s")

    # --- RAISING ------------------------------------------------------------
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            got = aw("a probe that always raises", raiser, BUDGET)
        raised = False
    except Exception as exc:  # noqa: BLE001
        got, raised = None, True
    row(f, "RAISING does not propagate and returns False", raised is False and got is False,
        f"raised={raised} returned={got!r}")

bad = [r for r in rows if not r[2]]
print(f"\nS56 FALSIFICATION HARNESS: {len(rows) - len(bad)}/{len(rows)} rows pass "
      f"across {len(FILES)} converted scripts")
for r in bad:
    print(f"  FAILED: {r[0]} :: {r[1]}  {r[3]}")
sys.exit(1 if bad else 0)
