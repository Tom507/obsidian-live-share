"""WP45 / AC2 / TP05 (visible) — a run that would need a restart STOPS and instructs.

Obsidian is single-instance and loads `data.json` at window open. If WP44 provisioned the
control port while Obsidian was already running, the live window cannot have that port and
no re-issued `obsidian://open` URI can give it one — only a restart could. D15 forbids the
restart, so the run must abort under `RESTART_REQUIRED_OPERATOR` with an instruction the
operator can act on, and must not launch, close or restart anything.

DATA SAFETY: injected probe + injected console; the abort path starts nothing.
"""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

REPO_ROOT = Path(__file__).resolve().parents[5]
TOOLS_DIR = REPO_ROOT / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from obsidian_e2e import constants, lifecycle  # noqa: E402


def _desc(role, vault_name, port, *, provisioned_while_running=False):
    return SimpleNamespace(
        role=role,
        vault_path=str(Path("h:/tmp/wp45-fixture") / vault_name),
        vault_name=vault_name,
        control_port=port,
        port_provisioned_while_running=provisioned_while_running,
    )


class FakeConsole:
    def __init__(self):
        self.calls = []
        self._n = 0

    def run_command(self, argv, *, title=""):
        assert isinstance(argv, list)
        self._n += 1
        cid = f"console-{self._n}"
        self.calls.append(("run_command", list(argv), cid))
        return cid

    def run_python(self, script, *, args=None, title=""):
        self._n += 1
        cid = f"console-{self._n}"
        self.calls.append(("run_python", [str(script), *(args or [])], cid))
        return cid

    def await_console(self, console_id, *, timeout=None):
        self.calls.append(("await_console", [console_id], console_id))
        return {"console_id": console_id, "exit_code": 0}


def test_already_open_vault_needing_a_restart_aborts_with_operator_instruction(tmp_path):
    exe = tmp_path / "Obsidian.exe"
    exe.write_bytes(b"")

    instances = [
        # role a is fine and already reachable
        _desc(constants.ROLE_A, "ObsidianOrga", constants.REAL_CONTROL_PORT_A),
        # role b: window already open, port provisioned afterwards -> silent endpoint
        _desc(
            constants.ROLE_B,
            "ObsidianOrga - Kopie",
            constants.REAL_CONTROL_PORT_B,
            provisioned_while_running=True,
        ),
    ]
    console = FakeConsole()

    record = lifecycle.ensure_endpoints(
        instances,
        probe=lambda role, port: role == constants.ROLE_A,
        console=console,
        resolve_exe=lambda: str(exe),
    )

    # --- stops, under the pinned reason -------------------------------------
    assert record["ok"] is False
    assert record["reason"] == constants.RESTART_REQUIRED_OPERATOR
    assert record["reason"] == "RESTART_REQUIRED_OPERATOR"

    # --- and tells the operator what to do, naming the vault ----------------
    instruction = record["operator_instruction"]
    assert isinstance(instruction, str) and instruction.strip()
    assert "ObsidianOrga - Kopie" in instruction
    lowered = instruction.lower()
    assert "restart" in lowered or "reopen" in lowered or "close" in lowered

    # --- and does exactly nothing else --------------------------------------
    assert console.calls == [], "the abort path must not start or wait on any process"
    assert record["terminated"] == []
    assert record["roles"][constants.ROLE_B]["mode"] != "launch"
    assert record["roles"][constants.ROLE_B]["launched_by_rig"] is False
    # the role that was already reachable stays attached, it is not torn down
    assert record["roles"][constants.ROLE_A]["mode"] == "attach"


# ---------------------------------------------------------------------------
# DATA SAFETY GUARD (T3_SharedContract S1/S2/S5) — autouse, every test.
# The owner's Obsidian is installed and its vaults are live. No WP45 test may
# reach a real OS process primitive, not even when the implementation under
# test is wrong. `_ForbiddenProcessCall` derives from BaseException so a stray
# `except Exception` inside the implementation cannot swallow the trip-wire.
# ---------------------------------------------------------------------------
class _ForbiddenProcessCall(BaseException):
    pass


@pytest.fixture(autouse=True)
def _no_real_process(monkeypatch):
    import os as _os
    import subprocess as _sp

    def _forbid(label):
        def _f(*args, **kwargs):
            raise _ForbiddenProcessCall(
                f"WP45 test tried to reach a real process primitive: {label}{args!r}"
            )

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
