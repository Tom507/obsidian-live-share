"""WP45 / AC3 / TP07 (blind1) — resolution PRECEDENCE: a dead candidate falls back.

Angle: the visible test proves a live candidate wins. Here the candidate is dead and the
pinned default is alive, so the resolver must fall through rather than return the dead
candidate or give up. This is the ordering an "if candidate: return candidate" gets wrong.

DATA SAFETY: existence is a fake predicate; nothing on disk is opened or executed.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

TOOLS_DIR = Path(__file__).resolve().parents[5] / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from obsidian_e2e import constants, lifecycle  # noqa: E402


def _const(*names):
    for name in names:
        if hasattr(constants, name):
            return getattr(constants, name)
    raise AssertionError(f"constants.py must pin one of {names} (T3_SharedContract)")


OBSIDIAN_EXE = _const("OBSIDIAN_EXE_PATH", "OBSIDIAN_EXE", "OBSIDIAN_EXECUTABLE")
DEAD = "D:/uninstalled/Obsidian.exe"


def test_a_dead_candidate_falls_back_to_the_pinned_default():
    resolved = lifecycle.resolve_executable(
        DEAD, exists=lambda p: str(p) == str(OBSIDIAN_EXE)
    )
    assert resolved == str(OBSIDIAN_EXE)
    assert resolved != DEAD


def test_a_dead_candidate_and_a_dead_default_resolve_to_nothing():
    assert lifecycle.resolve_executable(DEAD, exists=lambda p: False) is None


def test_both_alive_prefers_the_explicit_candidate():
    alive = "E:/portable/Obsidian.exe"
    resolved = lifecycle.resolve_executable(alive, exists=lambda p: True)
    assert resolved == alive


def test_every_candidate_is_actually_tested_for_existence():
    probed = []

    def exists(path):
        probed.append(str(path))
        return False

    lifecycle.resolve_executable(DEAD, exists=exists)
    assert DEAD in probed
    assert str(OBSIDIAN_EXE) in probed, "the pinned default must also be probed"
    assert probed.index(DEAD) < probed.index(str(OBSIDIAN_EXE)), "candidate is tried first"


def test_the_resolved_value_is_a_plain_string_path():
    resolved = lifecycle.resolve_executable(exists=lambda p: True)
    assert isinstance(resolved, str)
    assert resolved.lower().endswith(".exe")


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
