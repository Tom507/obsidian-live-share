"""WP45 / AC3 / TP06 (visible) — a missing/relocated executable is a NAMED failure.

A blind `Popen("C:\\...\\Obsidian.exe")` on a machine where Obsidian moved raises
FileNotFoundError somewhere deep in the run. AC3 requires the path to be *resolved*:
when nothing resolves, the run stops under `LAUNCH_EXECUTABLE_MISSING`.

DATA SAFETY: no executable exists in this test by construction; nothing can start.
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


def _const(*names):
    """Read a pinned value from constants.py (WP43) — never redefine it here."""
    for name in names:
        if hasattr(constants, name):
            return getattr(constants, name)
    raise AssertionError(f"constants.py must pin one of {names} (T3_SharedContract)")


ROLES = getattr(constants, "ROLES", (constants.ROLE_A, constants.ROLE_B))


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


def test_resolver_that_finds_nothing_yields_named_failure_not_a_crash():
    """`resolve_executable` returns None instead of guessing."""
    assert lifecycle.resolve_executable(exists=lambda p: False) is None
    assert (
        lifecycle.resolve_executable("C:/nowhere/Obsidian.exe", exists=lambda p: False)
        is None
    )


def test_launch_with_unresolvable_executable_aborts_under_launch_executable_missing():
    instances = [
        _desc(constants.ROLE_A, "ObsidianOrga", constants.REAL_CONTROL_PORT_A),
        _desc(constants.ROLE_B, "ObsidianOrga - Kopie", constants.REAL_CONTROL_PORT_B),
    ]
    console = FakeConsole()

    record = lifecycle.ensure_endpoints(
        instances,
        probe=lambda role, port: False,
        console=console,
        resolve_exe=lambda: None,  # executable relocated / not installed
    )

    assert record["ok"] is False
    assert record["reason"] == constants.LAUNCH_EXECUTABLE_MISSING
    assert record["reason"] == "LAUNCH_EXECUTABLE_MISSING"

    # no blind spawn attempt, no partial launch
    assert console.calls == []
    for role in ROLES:
        assert record["roles"][role]["launched_by_rig"] is False
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
