"""WP45 / AC1 / TP01 (blind1) — attaching is idempotent and probes exactly once.

Angle: a healthy pair of endpoints must not provoke a retry storm, and a second
invocation on an unchanged host must produce the same record. Data safety: fakes only.
"""

from __future__ import annotations

import sys
from collections import Counter
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
        self.calls.append(("run_command", list(argv)))
        return "cid"

    def run_python(self, script, *, args=None, title=""):
        self.calls.append(("run_python", [str(script)]))
        return "cid"

    def await_console(self, console_id, *, timeout=None):
        self.calls.append(("await_console", [console_id]))
        return {"exit_code": 0}


def _pair():
    return [
        _inst(constants.ROLE_A, "VaultOne", constants.REAL_CONTROL_PORT_A),
        _inst(constants.ROLE_B, "Vault Two Spaced", constants.REAL_CONTROL_PORT_B),
    ]


def test_healthy_endpoints_are_probed_once_each_and_never_relaunched():
    hits = Counter()

    def probe(role, port):
        hits[role] += 1
        return True

    console = RecordingConsole()
    record = lifecycle.ensure_endpoints(
        _pair(), probe=probe, console=console, resolve_exe=lambda: None
    )

    assert dict(hits) == {role: 1 for role in ROLES}
    assert console.calls == []
    assert all(record["roles"][r]["mode"] == "attach" for r in ROLES)
    assert record["ok"] is True


def test_a_second_invocation_on_an_unchanged_host_is_identical():
    console_1, console_2 = RecordingConsole(), RecordingConsole()
    first = lifecycle.ensure_endpoints(
        _pair(), probe=lambda r, p: True, console=console_1, resolve_exe=lambda: None
    )
    second = lifecycle.ensure_endpoints(
        _pair(), probe=lambda r, p: True, console=console_2, resolve_exe=lambda: None
    )

    assert first["roles"] == second["roles"]
    assert first["rig_kind"] == second["rig_kind"]
    assert first["reason"] is second["reason"] is None
    assert console_1.calls == console_2.calls == []
    assert first["terminated"] == second["terminated"] == []


def test_mode_values_come_from_a_closed_set():
    record = lifecycle.ensure_endpoints(
        _pair(), probe=lambda r, p: True, console=RecordingConsole(), resolve_exe=lambda: None
    )
    for role in ROLES:
        assert record["roles"][role]["mode"] in ("attach", "launch")


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
