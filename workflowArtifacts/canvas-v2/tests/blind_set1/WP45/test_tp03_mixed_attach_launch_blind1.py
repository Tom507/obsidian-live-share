"""WP45 / AC1 / TP03 (blind1) — mirrored mix: role b attaches, role a launches.

Angle: the visible case has the host role (index 0) attaching. Here the *second* role is
the one already reachable, so an implementation that special-cases the host role is caught.
Data safety: fakes only.
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


def _inst(role, name, port):
    return SimpleNamespace(
        role=role, vault_path=f"h:/tmp/wp45b1/{name}", vault_name=name,
        control_port=port, port_provisioned_while_running=False,
    )


class RecordingConsole:
    def __init__(self):
        self.spawns = []

    def run_command(self, argv, *, title=""):
        self.spawns.append(list(argv))
        return "cid-1"

    def run_python(self, script, *, args=None, title=""):
        self.spawns.append([str(script), *(args or [])])
        return "cid-1"

    def await_console(self, console_id, *, timeout=None):
        return {"exit_code": 0}


def test_second_role_reachable_first_role_not(tmp_path):
    exe = tmp_path / "Obsidian.exe"
    exe.write_bytes(b"")
    console = RecordingConsole()

    record = lifecycle.ensure_endpoints(
        [_inst(constants.ROLE_A, "Arbeits Vault", constants.REAL_CONTROL_PORT_A),
         _inst(constants.ROLE_B, "KopieVault", constants.REAL_CONTROL_PORT_B)],
        probe=lambda role, port: port == constants.REAL_CONTROL_PORT_B,
        console=console,
        resolve_exe=lambda: str(exe),
    )

    a = record["roles"][constants.ROLE_A]
    b = record["roles"][constants.ROLE_B]
    assert a["mode"] == "launch" and a["launched_by_rig"] is True
    assert b["mode"] == "attach" and b["launched_by_rig"] is False
    assert b["console_id"] is None
    assert a["console_id"] is not None

    # exactly one spawn, for role a's vault only
    assert len(console.spawns) == 1
    assert console.spawns[0][-1] == "obsidian://open?vault=Arbeits%20Vault"
    assert "KopieVault" not in " ".join(console.spawns[0])


def test_the_probe_decides_per_role_not_globally(tmp_path):
    """A single global 'is anything listening' flag would get this wrong."""
    exe = tmp_path / "Obsidian.exe"
    exe.write_bytes(b"")
    seen_ports = []

    def probe(role, port):
        seen_ports.append(port)
        return port == constants.REAL_CONTROL_PORT_B

    record = lifecycle.ensure_endpoints(
        [_inst(constants.ROLE_A, "Arbeits Vault", constants.REAL_CONTROL_PORT_A),
         _inst(constants.ROLE_B, "KopieVault", constants.REAL_CONTROL_PORT_B)],
        probe=probe, console=RecordingConsole(), resolve_exe=lambda: str(exe),
    )

    assert set(seen_ports) == {constants.REAL_CONTROL_PORT_A, constants.REAL_CONTROL_PORT_B}
    modes = {record["roles"][r]["mode"] for r in (constants.ROLE_A, constants.ROLE_B)}
    assert modes == {"attach", "launch"}
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
