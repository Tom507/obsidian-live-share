"""WP45 / AC4 / TP10 (visible) — run_* then await_console, and an ABSOLUTE entrypoint.

Two halves of AC4:
  1. every rig-started process goes `run_command`/`run_python` -> `await_console` on the
     same console id — a spawn that is never awaited is a detached background process
     wearing a visible-console costume;
  2. the rig entrypoint is referenced by absolute path (`run_python` resolves a relative
     path against the wrapper's cwd, not the script's — the documented Windows trap).

DATA SAFETY: the console is a fake recorder; nothing is executed.
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

import launch_obsidian_e2e  # noqa: E402
from obsidian_e2e import constants, lifecycle  # noqa: E402


def _desc(role, vault_name, port):
    return SimpleNamespace(
        role=role,
        vault_path=str(Path("h:/tmp/wp45-fixture") / vault_name),
        vault_name=vault_name,
        control_port=port,
        port_provisioned_while_running=False,
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


def test_every_spawn_is_immediately_awaited_on_its_own_console_id(tmp_path):
    exe = tmp_path / "Obsidian.exe"
    exe.write_bytes(b"")
    console = FakeConsole()

    lifecycle.ensure_endpoints(
        [_desc(constants.ROLE_A, "ObsidianOrga", constants.REAL_CONTROL_PORT_A),
         _desc(constants.ROLE_B, "ObsidianOrga - Kopie", constants.REAL_CONTROL_PORT_B)],
        probe=lambda role, port: False,
        console=console,
        resolve_exe=lambda: str(exe),
    )

    kinds = [c[0] for c in console.calls]
    assert kinds == ["run_command", "await_console", "run_command", "await_console"], kinds

    # the await names the console id the spawn returned
    for i in range(0, len(console.calls), 2):
        spawn_cid = console.calls[i][2]
        awaited_cid = console.calls[i + 1][1][0]
        assert awaited_cid == spawn_cid


def test_the_rig_entrypoint_is_referenced_by_absolute_path():
    entry = Path(str(launch_obsidian_e2e.ENTRYPOINT_PATH))
    assert entry.is_absolute(), f"entrypoint must be absolute: {entry}"
    assert entry.name == "launch_obsidian_e2e.py"
    assert entry == (TOOLS_DIR / "launch_obsidian_e2e.py").resolve()


def test_the_run_record_carries_the_absolute_entrypoint(tmp_path):
    exe = tmp_path / "Obsidian.exe"
    exe.write_bytes(b"")
    console = FakeConsole()

    record = lifecycle.ensure_endpoints(
        [_desc(constants.ROLE_A, "ObsidianOrga", constants.REAL_CONTROL_PORT_A)],
        probe=lambda role, port: True,
        console=console,
        resolve_exe=lambda: str(exe),
    )

    entry = Path(record["entrypoint"])
    assert entry.is_absolute()
    assert entry.name == "launch_obsidian_e2e.py"


def test_no_console_call_ever_receives_a_relative_script_path(tmp_path):
    exe = tmp_path / "Obsidian.exe"
    exe.write_bytes(b"")
    console = FakeConsole()

    lifecycle.ensure_endpoints(
        [_desc(constants.ROLE_B, "ObsidianOrga - Kopie", constants.REAL_CONTROL_PORT_B)],
        probe=lambda role, port: False,
        console=console,
        resolve_exe=lambda: str(exe),
    )

    for kind, argv, _cid in console.calls:
        if kind in ("run_command", "run_python"):
            assert Path(argv[0]).is_absolute(), f"{kind} got a relative target: {argv[0]}"


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
