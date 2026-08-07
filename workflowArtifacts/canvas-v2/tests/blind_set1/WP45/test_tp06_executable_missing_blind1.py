"""WP45 / AC3 / TP06 (blind1) — unresolvable executable, checked from the reason enum.

Angle: the visible test pins the literal. Here the reason must additionally be a member of
the shared failure-reason enum in constants.py and must NOT be one of the neighbouring
reasons that a sloppy implementation reaches for (a missing exe is not a missing plugin).

DATA SAFETY: nothing exists to launch; the guard blocks the primitives regardless.
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


def _inst(role, name, port):
    return SimpleNamespace(
        role=role, vault_path=f"h:/tmp/wp45b1/{name}", vault_name=name,
        control_port=port, port_provisioned_while_running=False,
    )


class RecordingConsole:
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


def _run(resolve_exe):
    return lifecycle.ensure_endpoints(
        [_inst(constants.ROLE_A, "AlphaVault", constants.REAL_CONTROL_PORT_A),
         _inst(constants.ROLE_B, "Beta Vault", constants.REAL_CONTROL_PORT_B)],
        probe=lambda r, p: False,
        console=RecordingConsole(),
        resolve_exe=resolve_exe,
    )


def test_none_from_the_resolver_names_the_executable_reason():
    record = _run(lambda: None)
    assert record["ok"] is False
    assert record["reason"] == constants.LAUNCH_EXECUTABLE_MISSING


def test_an_empty_string_from_the_resolver_is_also_a_miss_not_a_launch():
    """An empty path is falsy — it must never become argv[0]."""
    console = RecordingConsole()
    record = lifecycle.ensure_endpoints(
        [_inst(constants.ROLE_A, "AlphaVault", constants.REAL_CONTROL_PORT_A)],
        probe=lambda r, p: False, console=console, resolve_exe=lambda: "",
    )
    assert record["ok"] is False
    assert record["reason"] == constants.LAUNCH_EXECUTABLE_MISSING
    assert console.calls == []


def test_the_reason_is_not_confused_with_a_neighbouring_failure():
    record = _run(lambda: None)
    for other in ("PLUGIN_MISSING", "PLUGIN_NOT_E2E_CAPABLE", "RESTART_REQUIRED_OPERATOR",
                  "VAULT_PATH_MISSING", "READINESS_TIMEOUT"):
        if hasattr(constants, other):
            assert record["reason"] != getattr(constants, other)


def test_the_resolver_never_guesses_a_path_when_nothing_exists():
    assert lifecycle.resolve_executable(exists=lambda p: False) is None
    assert lifecycle.resolve_executable("D:/moved/Obsidian.exe", exists=lambda p: False) is None


def test_no_role_is_marked_launched_after_the_abort():
    record = _run(lambda: None)
    for role in ROLES:
        assert record["roles"][role]["launched_by_rig"] is False
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
