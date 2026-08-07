"""WP45 / AC1 / TP03 (blind2) — the mixed run seen through the console-id column.

Angle: the record must be self-consistent — an attached role owns no console, a launched
role owns exactly one, and the number of console ids in the record equals the number of
launches. That invariant catches a record that "remembers" a launch it did not perform.

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

ROLES = getattr(constants, "ROLES", (constants.ROLE_A, constants.ROLE_B))


class CountingConsole:
    def __init__(self):
        self.spawn_count = 0

    def run_command(self, argv, *, title=""):
        self.spawn_count += 1
        return f"cid-{self.spawn_count}"

    def run_python(self, script, *, args=None, title=""):
        self.spawn_count += 1
        return f"cid-{self.spawn_count}"

    def await_console(self, console_id, *, timeout=None):
        return {"exit_code": 0}


def _pair():
    return [
        SimpleNamespace(role=constants.ROLE_A, vault_path="h:/tmp/wp45b2/Eins",
                        vault_name="Eins", control_port=constants.REAL_CONTROL_PORT_A,
                        port_provisioned_while_running=False),
        SimpleNamespace(role=constants.ROLE_B, vault_path="h:/tmp/wp45b2/Zwei Drei",
                        vault_name="Zwei Drei", control_port=constants.REAL_CONTROL_PORT_B,
                        port_provisioned_while_running=False),
    ]


@pytest.mark.parametrize("answering_role", [constants.ROLE_A, constants.ROLE_B])
def test_console_ids_line_up_with_the_launch_count(answering_role, tmp_path):
    exe = tmp_path / "Obsidian.exe"
    exe.write_bytes(b"")
    console = CountingConsole()

    record = lifecycle.ensure_endpoints(
        _pair(),
        probe=lambda role, port: role == answering_role,
        console=console,
        resolve_exe=lambda: str(exe),
    )

    launched = [r for r in ROLES if record["roles"][r]["mode"] == "launch"]
    attached = [r for r in ROLES if record["roles"][r]["mode"] == "attach"]
    assert attached == [answering_role]
    assert len(launched) == 1
    assert console.spawn_count == len(launched)

    ids = [record["roles"][r]["console_id"] for r in ROLES]
    assert ids.count(None) == len(attached)
    assert len([i for i in ids if i is not None]) == len(launched)


def test_an_attached_role_never_claims_to_have_been_launched(tmp_path):
    exe = tmp_path / "Obsidian.exe"
    exe.write_bytes(b"")
    record = lifecycle.ensure_endpoints(
        _pair(),
        probe=lambda role, port: role == constants.ROLE_B,
        console=CountingConsole(),
        resolve_exe=lambda: str(exe),
    )
    for role in ROLES:
        entry = record["roles"][role]
        assert entry["launched_by_rig"] is (entry["mode"] == "launch")
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
