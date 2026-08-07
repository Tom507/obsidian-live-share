"""WP45 / D13 / TP11 (blind1) — the separation is visible in the PORTS too.

Angle: the visible test proves the rig-kind strings differ. This one adds the port-level
expression of D13 (the real rig owns a disjoint port pair, so a stale headless process can
never satisfy a real-rig readiness check) and proves the two entrypoints are two distinct
files with two distinct self-descriptions.

DATA SAFETY: imports and source reads; neither `main()` is run except `--help`.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

TOOLS_DIR = Path(__file__).resolve().parents[5] / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import launch_liveshare_e2e  # noqa: E402
import launch_obsidian_e2e  # noqa: E402
from obsidian_e2e import constants, lifecycle  # noqa: E402

HEADLESS_PORTS = (39421, 39422)


def _const(*names):
    for name in names:
        if hasattr(constants, name):
            return getattr(constants, name)
    raise AssertionError(f"constants.py must pin one of {names} (T3_SharedContract)")


RIG_REAL = _const("RIG_KIND_REAL", "RIG_KIND_REAL_OBSIDIAN")
RIG_MOCK = _const("RIG_KIND_HEADLESS_MOCK", "RIG_KIND_MOCK", "RIG_KIND_HEADLESS")


def test_the_real_rig_ports_are_disjoint_from_the_headless_rig_ports():
    real = {constants.REAL_CONTROL_PORT_A, constants.REAL_CONTROL_PORT_B}
    assert real.isdisjoint(set(HEADLESS_PORTS)), (
        "a stale headless process must never be able to satisfy a real-rig probe"
    )
    assert len(real) == 2


def test_the_headless_rig_keeps_its_own_ports_unchanged():
    src = (TOOLS_DIR / "launch_liveshare_e2e.py").read_text(encoding="utf-8")
    assert "39421" in src and "39422" in src, "the headless rig's ports must not be retuned"


def test_the_two_entrypoints_are_two_distinct_files():
    real = TOOLS_DIR / "launch_obsidian_e2e.py"
    mock = TOOLS_DIR / "launch_liveshare_e2e.py"
    assert real.is_file() and mock.is_file()
    assert real.resolve() != mock.resolve()
    assert real.read_bytes() != mock.read_bytes()


def test_the_rig_kinds_cannot_collide():
    assert RIG_REAL != RIG_MOCK
    assert launch_obsidian_e2e.RIG_KIND == RIG_REAL
    assert launch_liveshare_e2e.RIG_KIND == RIG_MOCK
    assert lifecycle.RIG_KIND == RIG_REAL
    # a run record stamped by the real rig can never read as the mock one
    assert lifecycle.RIG_KIND != launch_liveshare_e2e.RIG_KIND


def test_the_headless_rig_still_aliases_the_obsidian_mock():
    """D13 keeps the mock rig; it is demoted in status, not deleted."""
    src = (TOOLS_DIR / "launch_liveshare_e2e.py").read_text(encoding="utf-8")
    assert "--alias:obsidian=" in src
    assert "__mocks__" in src
    assert Path(str(launch_liveshare_e2e.OBSIDIAN_MOCK)).name == "obsidian.ts"
    assert "__mocks__" in str(launch_liveshare_e2e.OBSIDIAN_MOCK)


def test_the_headless_rig_says_out_loud_that_it_is_not_the_gate():
    blob = " ".join(
        str(getattr(launch_liveshare_e2e, attr, "")) for attr in ("HEADLESS_BANNER", "__doc__")
    ).lower()
    blob = " ".join(blob.split())
    assert "mock" in blob
    assert "cannot satisfy" in blob
    assert "gate" in blob


class _ForbiddenProcessCall(BaseException):
    pass


@pytest.fixture(autouse=True)
def _no_real_process(monkeypatch):
    """DATA SAFETY: no WP45 test may reach a real OS process primitive."""
    import os as _os
    import subprocess as _sp

    def _forbid(label):
        def _f(*args, **kwargs):
            raise _ForbiddenProcessCall(f"real process primitive reached: {label}{args!r}")

        return _f

    for _mod, _attr in (
        (_os, "system"), (_os, "popen"), (_os, "kill"), (_os, "startfile"),
        (_os, "execv"), (_os, "execvp"), (_os, "spawnv"),
        (_sp, "Popen"), (_sp, "run"), (_sp, "call"),
        (_sp, "check_call"), (_sp, "check_output"),
    ):
        if hasattr(_mod, _attr):
            monkeypatch.setattr(_mod, _attr, _forbid(f"{_mod.__name__}.{_attr}"))
    yield
