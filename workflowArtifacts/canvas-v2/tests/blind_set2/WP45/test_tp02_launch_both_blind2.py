"""WP45 / AC1 / TP02 (blind2) — no cross-role mix-up when both roles launch.

Angle: two launches in one run is where role a's vault gets opened twice, or role b's port
gets stamped on role a's record. Each role's spawn is matched back to that role's own vault
name, and the two spawns must be distinct.

DATA SAFETY: fakes only.
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

VAULT_A = "Orga Haupt"
VAULT_B = "Orga Haupt - Kopie"


class TrackingConsole:
    def __init__(self):
        self.argvs = []
        self._n = 0

    def run_command(self, argv, *, title=""):
        self._n += 1
        self.argvs.append(list(argv))
        return f"cid-{self._n}"

    def run_python(self, script, *, args=None, title=""):
        self._n += 1
        self.argvs.append([str(script), *(args or [])])
        return f"cid-{self._n}"

    def await_console(self, console_id, *, timeout=None):
        return {"exit_code": 0}


def _pair():
    return [
        SimpleNamespace(role=constants.ROLE_A, vault_path=f"h:/tmp/wp45b2/{VAULT_A}",
                        vault_name=VAULT_A, control_port=constants.REAL_CONTROL_PORT_A,
                        port_provisioned_while_running=False),
        SimpleNamespace(role=constants.ROLE_B, vault_path=f"h:/tmp/wp45b2/{VAULT_B}",
                        vault_name=VAULT_B, control_port=constants.REAL_CONTROL_PORT_B,
                        port_provisioned_while_running=False),
    ]


def test_the_two_launches_open_two_different_vaults(tmp_path):
    exe = tmp_path / "Obsidian.exe"
    exe.write_bytes(b"")
    console = TrackingConsole()

    lifecycle.ensure_endpoints(
        _pair(), probe=lambda r, p: False, console=console, resolve_exe=lambda: str(exe)
    )

    uris = [argv[-1] for argv in console.argvs]
    assert len(uris) == 2
    assert len(set(uris)) == 2, "both roles were opened on the same vault"
    assert "obsidian://open?vault=Orga%20Haupt" in uris
    assert "obsidian://open?vault=Orga%20Haupt%20-%20Kopie" in uris


def test_the_prefix_vault_is_not_confused_with_the_longer_one(tmp_path):
    """'Orga Haupt' is a prefix of 'Orga Haupt - Kopie' — substring logic gets this wrong."""
    exe = tmp_path / "Obsidian.exe"
    exe.write_bytes(b"")
    console = TrackingConsole()

    lifecycle.ensure_endpoints(
        _pair(), probe=lambda r, p: False, console=console, resolve_exe=lambda: str(exe)
    )

    exact = [argv[-1] for argv in console.argvs]
    assert exact.count("obsidian://open?vault=Orga%20Haupt") == 1
    assert exact.count("obsidian://open?vault=Orga%20Haupt%20-%20Kopie") == 1


def test_each_role_record_keeps_its_own_port_and_vault(tmp_path):
    exe = tmp_path / "Obsidian.exe"
    exe.write_bytes(b"")
    record = lifecycle.ensure_endpoints(
        _pair(), probe=lambda r, p: False, console=TrackingConsole(),
        resolve_exe=lambda: str(exe),
    )
    a = record["roles"][constants.ROLE_A]
    b = record["roles"][constants.ROLE_B]
    assert (a["vault_name"], a["port"]) == (VAULT_A, constants.REAL_CONTROL_PORT_A)
    assert (b["vault_name"], b["port"]) == (VAULT_B, constants.REAL_CONTROL_PORT_B)
    assert a["console_id"] != b["console_id"]


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
