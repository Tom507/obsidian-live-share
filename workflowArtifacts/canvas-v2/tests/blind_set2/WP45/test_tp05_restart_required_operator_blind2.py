"""WP45 / AC2 / TP05 (blind2) — both roles need a restart: one reason, stable, no launch.

Angle: the visible test trips a single role. Here both are stale, so the run must still
report exactly one reason (not a list of two, not the last one to be evaluated), must be
stable across repeated invocation, and must leave both roles unlaunched.

DATA SAFETY: fakes only; the abort path starts nothing.
"""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

TOOLS_DIR = Path(__file__).resolve().parents[5] / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from obsidian_e2e import constants, lifecycle  # noqa: E402

ROLES = getattr(constants, "ROLES", (constants.ROLE_A, constants.ROLE_B))


class InertConsole:
    def __init__(self):
        self.calls = []

    def run_command(self, argv, *, title=""):
        self.calls.append(list(argv))
        return "cid"

    def run_python(self, script, *, args=None, title=""):
        self.calls.append([str(script)])
        return "cid"

    def await_console(self, console_id, *, timeout=None):
        return {"exit_code": 0}


def _both_stale():
    return [
        SimpleNamespace(role=constants.ROLE_A, vault_path="h:/tmp/wp45b2/Erste",
                        vault_name="Erste Halle", control_port=constants.REAL_CONTROL_PORT_A,
                        port_provisioned_while_running=True),
        SimpleNamespace(role=constants.ROLE_B, vault_path="h:/tmp/wp45b2/Zweite",
                        vault_name="Zweite Halle", control_port=constants.REAL_CONTROL_PORT_B,
                        port_provisioned_while_running=True),
    ]


def _run(console=None):
    return lifecycle.ensure_endpoints(
        _both_stale(), probe=lambda r, p: False,
        console=console or InertConsole(), resolve_exe=lambda: "C:/anywhere/Obsidian.exe",
    )


def test_exactly_one_reason_is_reported():
    record = _run()
    assert record["ok"] is False
    assert isinstance(record["reason"], str)
    assert record["reason"] == constants.RESTART_REQUIRED_OPERATOR


def test_neither_role_is_launched_and_nothing_is_started():
    console = InertConsole()
    record = _run(console)
    assert console.calls == []
    for role in ROLES:
        assert record["roles"][role]["launched_by_rig"] is False
        assert record["roles"][role]["mode"] != "launch"


def test_the_verdict_is_stable_across_repeated_invocations():
    first, second = _run(), _run()
    assert first["reason"] == second["reason"]
    assert first["ok"] == second["ok"] is False
    assert first["operator_instruction"] == second["operator_instruction"]


def test_the_instruction_is_addressed_to_a_human_and_names_a_vault():
    record = _run()
    text = record["operator_instruction"]
    assert isinstance(text, str) and len(text.strip()) > 20
    assert "Erste Halle" in text or "Zweite Halle" in text
    assert record["terminated"] == []


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
