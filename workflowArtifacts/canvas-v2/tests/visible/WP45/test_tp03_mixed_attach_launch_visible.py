"""WP45 / AC1 / TP03 (visible) — mixed: role a attaches, role b launches.

The per-role record must distinguish the two; a run where one role answered and the
other did not is the case a single global flag would silently get wrong.

DATA SAFETY: injected probe + injected console; nothing real is started or stopped.
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


def test_role_a_attaches_and_role_b_launches_is_recorded_per_role(tmp_path):
    exe = tmp_path / "Obsidian.exe"
    exe.write_bytes(b"")

    instances = [
        _desc(constants.ROLE_A, "ObsidianOrga", constants.REAL_CONTROL_PORT_A),
        _desc(constants.ROLE_B, "ObsidianOrga - Kopie", constants.REAL_CONTROL_PORT_B),
    ]
    console = FakeConsole()

    # only role a's endpoint answers
    def probe(role, port):
        return role == constants.ROLE_A

    record = lifecycle.ensure_endpoints(
        instances, probe=probe, console=console, resolve_exe=lambda: str(exe)
    )

    assert record["ok"] is True
    assert record["reason"] is None

    a = record["roles"][constants.ROLE_A]
    b = record["roles"][constants.ROLE_B]
    assert a["mode"] == "attach"
    assert a["launched_by_rig"] is False
    assert a["console_id"] is None
    assert b["mode"] == "launch"
    assert b["launched_by_rig"] is True
    assert b["console_id"] is not None
    assert a["mode"] != b["mode"], "the record must distinguish the two roles"

    # exactly ONE spawn, and it is role b's vault — the attached window is untouched
    spawns = [c for c in console.calls if c[0] in ("run_command", "run_python")]
    assert len(spawns) == 1
    argv = spawns[0][1]
    assert argv[-1] == "obsidian://open?vault=ObsidianOrga%20-%20Kopie"
    assert "ObsidianOrga%20-%20Kopie" in argv[-1]
    assert not any("ObsidianOrga - Kopie" in part for part in argv), "unencoded vault name"

    assert record["terminated"] == []


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
