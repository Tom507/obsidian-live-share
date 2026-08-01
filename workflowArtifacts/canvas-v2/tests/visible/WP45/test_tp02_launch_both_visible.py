"""WP45 / AC1 / TP02 (visible) — no endpoint answers -> both roles LAUNCH.

DATA SAFETY: the executable is a temp-file stand-in and the visible-console seam is a
fake recorder. No Obsidian process is started and no vault is touched.
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
        assert isinstance(argv, list), f"argv must be a list, got {type(argv).__name__}"
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


def test_no_endpoint_answers_records_launch_for_every_role(tmp_path):
    exe = tmp_path / "Obsidian.exe"
    exe.write_bytes(b"")  # stand-in, never executed

    instances = [
        _desc(constants.ROLE_A, "ObsidianOrga", constants.REAL_CONTROL_PORT_A),
        _desc(constants.ROLE_B, "ObsidianOrga - Kopie", constants.REAL_CONTROL_PORT_B),
    ]
    console = FakeConsole()

    record = lifecycle.ensure_endpoints(
        instances,
        probe=lambda role, port: False,  # nothing is listening
        console=console,
        resolve_exe=lambda: str(exe),
    )

    assert record["ok"] is True
    assert record["reason"] is None
    for role in ROLES:
        entry = record["roles"][role]
        assert entry["mode"] == "launch", f"role {role} must be recorded as launch"
        assert entry["launched_by_rig"] is True
        assert entry["console_id"] is not None

    # exactly one spawn per role, each through the visible-console seam
    spawns = [c for c in console.calls if c[0] in ("run_command", "run_python")]
    assert len(spawns) == 2
    waits = [c for c in console.calls if c[0] == "await_console"]
    assert len(waits) == 2

    # each spawn carries that role's vault, as a list argv, exe first
    launched_uris = [argv[-1] for _kind, argv, _cid in spawns]
    assert launched_uris == [
        "obsidian://open?vault=ObsidianOrga",
        "obsidian://open?vault=ObsidianOrga%20-%20Kopie",
    ]
    for _kind, argv, _cid in spawns:
        assert isinstance(argv, list)
        assert argv[0] == str(exe)

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
