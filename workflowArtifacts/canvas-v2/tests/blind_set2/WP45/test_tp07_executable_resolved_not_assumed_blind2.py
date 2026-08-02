"""WP45 / AC3 / TP07 (blind2) — resolution happens BEFORE the console is engaged.

Angle: ordering. If the rig hands the console an argv and only then checks the executable,
a missing binary has already produced a console window and a half-started run. Both events
are written into one shared log and the order is asserted.

DATA SAFETY: fakes only; the "executable" is never executed.
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


def _instance(role, name, port):
    return SimpleNamespace(
        role=role, vault_path=f"h:/tmp/wp45b2/{name}", vault_name=name,
        control_port=port, port_provisioned_while_running=False,
    )


class LoggingConsole:
    def __init__(self, log):
        self.log = log

    def run_command(self, argv, *, title=""):
        self.log.append(("console.run_command", list(argv)))
        return "cid"

    def run_python(self, script, *, args=None, title=""):
        self.log.append(("console.run_python", [str(script)]))
        return "cid"

    def await_console(self, console_id, *, timeout=None):
        self.log.append(("console.await", [console_id]))
        return {"exit_code": 0}


def test_the_executable_is_resolved_before_any_console_call(tmp_path):
    exe = tmp_path / "Obsidian.exe"
    exe.write_bytes(b"")
    log = []

    def resolve_exe():
        log.append(("resolve_exe", []))
        return str(exe)

    lifecycle.ensure_endpoints(
        [_instance(constants.ROLE_A, "Solo Vault", constants.REAL_CONTROL_PORT_A)],
        probe=lambda r, p: False, console=LoggingConsole(log), resolve_exe=resolve_exe,
    )

    kinds = [entry[0] for entry in log]
    assert "resolve_exe" in kinds
    assert kinds.index("resolve_exe") < kinds.index("console.run_command")


def test_a_failed_resolution_produces_no_console_event_at_all(tmp_path):
    log = []
    lifecycle.ensure_endpoints(
        [_instance(constants.ROLE_A, "Solo Vault", constants.REAL_CONTROL_PORT_A)],
        probe=lambda r, p: False, console=LoggingConsole(log), resolve_exe=lambda: None,
    )
    assert [entry for entry in log if entry[0].startswith("console.")] == []


def test_the_resolver_output_is_used_verbatim_as_argv0(tmp_path):
    weird = tmp_path / "Program Files (x86)" / "Obsidian Beta" / "Obsidian.exe"
    weird.parent.mkdir(parents=True)
    weird.write_bytes(b"")
    log = []

    lifecycle.ensure_endpoints(
        [_instance(constants.ROLE_B, "Solo Vault", constants.REAL_CONTROL_PORT_B)],
        probe=lambda r, p: False, console=LoggingConsole(log), resolve_exe=lambda: str(weird),
    )

    spawns = [entry for entry in log if entry[0] == "console.run_command"]
    assert len(spawns) == 1
    argv = spawns[0][1]
    assert argv[0] == str(weird)
    # a path with spaces must arrive as one unsplit list element
    assert len(argv) == 2
    assert " " in argv[0]


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
