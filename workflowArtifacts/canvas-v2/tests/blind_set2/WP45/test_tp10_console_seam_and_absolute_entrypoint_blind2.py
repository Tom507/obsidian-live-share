"""WP45 / AC4 / TP10 (blind2) — the entrypoint path survives a foreign working directory.

Angle: `run_python` resolves a relative script path against the *wrapper's* cwd, not the
script's. So the absoluteness of the entrypoint must hold when the process cwd is somewhere
else entirely. The test changes cwd and re-checks; it also pins that the console is engaged
with keyword arguments rather than a positional soup.

DATA SAFETY: only the cwd changes, and it is restored by the fixture; nothing is launched.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

TOOLS_DIR = Path(__file__).resolve().parents[5] / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import launch_obsidian_e2e  # noqa: E402
from obsidian_e2e import constants, lifecycle  # noqa: E402


class KwargConsole:
    def __init__(self):
        self.calls = []

    def run_command(self, argv, *, title=""):
        self.calls.append(("run_command", argv, title))
        return "cid-1"

    def run_python(self, script, *, args=None, title=""):
        self.calls.append(("run_python", [str(script), *(args or [])], title))
        return "cid-1"

    def await_console(self, console_id, *, timeout=None):
        self.calls.append(("await_console", [console_id], ""))
        return {"exit_code": 0}


def _instance():
    return SimpleNamespace(
        role=constants.ROLE_B, vault_path="h:/tmp/wp45b2/Kopie", vault_name="Kopie Vault",
        control_port=constants.REAL_CONTROL_PORT_B, port_provisioned_while_running=False,
    )


def test_the_entrypoint_stays_absolute_from_a_foreign_cwd(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    entry = Path(str(launch_obsidian_e2e.ENTRYPOINT_PATH))
    assert entry.is_absolute()
    assert entry.is_file()
    assert Path(os.getcwd()) != entry.parent


def test_the_run_record_entrypoint_stays_absolute_from_a_foreign_cwd(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    record = lifecycle.ensure_endpoints(
        [_instance()], probe=lambda r, p: True, console=KwargConsole(), resolve_exe=lambda: None
    )
    entry = Path(record["entrypoint"])
    assert entry.is_absolute()
    assert entry.is_file()


def test_the_console_is_engaged_with_a_titled_call(tmp_path):
    exe = tmp_path / "Obsidian.exe"
    exe.write_bytes(b"")
    console = KwargConsole()

    lifecycle.ensure_endpoints(
        [_instance()], probe=lambda r, p: False, console=console, resolve_exe=lambda: str(exe)
    )

    spawns = [c for c in console.calls if c[0] in ("run_command", "run_python")]
    assert len(spawns) == 1
    _kind, _argv, title = spawns[0]
    assert isinstance(title, str) and title.strip(), "every console must carry a title"


def test_a_launch_is_always_followed_by_an_await(tmp_path):
    exe = tmp_path / "Obsidian.exe"
    exe.write_bytes(b"")
    console = KwargConsole()

    lifecycle.ensure_endpoints(
        [_instance()], probe=lambda r, p: False, console=console, resolve_exe=lambda: str(exe)
    )

    kinds = [c[0] for c in console.calls]
    assert kinds[-1] == "await_console"
    assert kinds.count("await_console") == len(
        [k for k in kinds if k in ("run_command", "run_python")]
    )


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
