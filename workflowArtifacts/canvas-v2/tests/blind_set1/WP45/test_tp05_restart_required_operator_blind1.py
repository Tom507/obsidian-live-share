"""WP45 / AC2 / TP05 (blind1) — the FIRST role is the one needing a restart.

Angle: the visible case trips on role b, after role a already attached. Here role a trips
first, so the abort must happen before role b is launched at all — an implementation that
collects all roles and only then decides would leak a launch for b.

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


def _inst(role, name, port, *, dirty=False):
    return SimpleNamespace(
        role=role, vault_path=f"h:/tmp/wp45b1/{name}", vault_name=name,
        control_port=port, port_provisioned_while_running=dirty,
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


def test_first_role_needing_a_restart_stops_the_run_before_any_launch(tmp_path):
    exe = tmp_path / "Obsidian.exe"
    exe.write_bytes(b"")
    console = RecordingConsole()

    record = lifecycle.ensure_endpoints(
        [_inst(constants.ROLE_A, "Haupt Vault", constants.REAL_CONTROL_PORT_A, dirty=True),
         _inst(constants.ROLE_B, "NebenVault", constants.REAL_CONTROL_PORT_B)],
        probe=lambda r, p: False,
        console=console,
        resolve_exe=lambda: str(exe),
    )

    assert record["ok"] is False
    assert record["reason"] == constants.RESTART_REQUIRED_OPERATOR
    assert console.calls == [], "role b must not be launched after the abort"
    assert record["roles"][constants.ROLE_B]["launched_by_rig"] is False
    assert record["roles"][constants.ROLE_B]["console_id"] is None


def test_the_instruction_names_the_offending_vault_and_asks_the_operator(tmp_path):
    exe = tmp_path / "Obsidian.exe"
    exe.write_bytes(b"")

    record = lifecycle.ensure_endpoints(
        [_inst(constants.ROLE_A, "Haupt Vault", constants.REAL_CONTROL_PORT_A, dirty=True)],
        probe=lambda r, p: False,
        console=RecordingConsole(),
        resolve_exe=lambda: str(exe),
    )

    text = record["operator_instruction"]
    assert isinstance(text, str) and text.strip()
    assert "Haupt Vault" in text
    low = text.lower()
    assert any(word in low for word in ("restart", "reopen", "close", "neu starten"))
    # it must be an instruction to a human, not an announcement that the rig did it
    assert "killed" not in low and "terminated" not in low


def test_the_abort_is_returned_not_raised(tmp_path):
    """A bare exception is explicitly forbidden: every abort names a pinned reason."""
    exe = tmp_path / "Obsidian.exe"
    exe.write_bytes(b"")
    record = lifecycle.ensure_endpoints(
        [_inst(constants.ROLE_B, "NebenVault", constants.REAL_CONTROL_PORT_B, dirty=True)],
        probe=lambda r, p: False,
        console=RecordingConsole(),
        resolve_exe=lambda: str(exe),
    )
    assert isinstance(record, dict)
    assert record["reason"] == "RESTART_REQUIRED_OPERATOR"
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
