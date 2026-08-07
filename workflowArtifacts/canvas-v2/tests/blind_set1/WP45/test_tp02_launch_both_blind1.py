"""WP45 / AC1 / TP02 (blind1) — both launch, roles supplied in reverse order.

Angle: the record must be keyed by role, not by position, and the spawn order must
follow the order the caller supplied. Data safety: fakes only, no real executable.
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
        self.spawns = []
        self.awaited = []
        self._n = 0

    def run_command(self, argv, *, title=""):
        assert isinstance(argv, list)
        self._n += 1
        cid = f"c{self._n}"
        self.spawns.append((cid, list(argv), title))
        return cid

    def run_python(self, script, *, args=None, title=""):
        self._n += 1
        cid = f"c{self._n}"
        self.spawns.append((cid, [str(script), *(args or [])], title))
        return cid

    def await_console(self, console_id, *, timeout=None):
        self.awaited.append(console_id)
        return {"exit_code": 0}


def test_reverse_order_instances_still_key_the_record_by_role(tmp_path):
    exe = tmp_path / "ObsidianPortable.exe"
    exe.write_bytes(b"")
    reversed_pair = [
        _inst(constants.ROLE_B, "Zweiter Vault", constants.REAL_CONTROL_PORT_B),
        _inst(constants.ROLE_A, "ErsterVault", constants.REAL_CONTROL_PORT_A),
    ]
    console = RecordingConsole()

    record = lifecycle.ensure_endpoints(
        reversed_pair, probe=lambda r, p: False, console=console, resolve_exe=lambda: str(exe)
    )

    assert record["ok"] is True
    assert record["roles"][constants.ROLE_A]["vault_name"] == "ErsterVault"
    assert record["roles"][constants.ROLE_B]["vault_name"] == "Zweiter Vault"
    assert record["roles"][constants.ROLE_A]["port"] == constants.REAL_CONTROL_PORT_A
    assert record["roles"][constants.ROLE_B]["port"] == constants.REAL_CONTROL_PORT_B
    for role in ROLES:
        assert record["roles"][role]["mode"] == "launch"
        assert record["roles"][role]["launched_by_rig"] is True

    # spawn order follows the supplied order: b first, then a
    uris = [argv[-1] for _cid, argv, _t in console.spawns]
    assert uris == [
        "obsidian://open?vault=Zweiter%20Vault",
        "obsidian://open?vault=ErsterVault",
    ]


def test_every_spawn_id_is_awaited_exactly_once(tmp_path):
    exe = tmp_path / "ObsidianPortable.exe"
    exe.write_bytes(b"")
    console = RecordingConsole()

    lifecycle.ensure_endpoints(
        [_inst(constants.ROLE_A, "ErsterVault", constants.REAL_CONTROL_PORT_A),
         _inst(constants.ROLE_B, "Zweiter Vault", constants.REAL_CONTROL_PORT_B)],
        probe=lambda r, p: False, console=console, resolve_exe=lambda: str(exe),
    )

    spawn_ids = [cid for cid, _argv, _t in console.spawns]
    assert sorted(console.awaited) == sorted(spawn_ids)
    assert len(set(console.awaited)) == len(console.awaited)


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
