"""WP45 / AC3 / TP07 (visible) — the executable is RESOLVED, not assumed.

The pinned path in `constants` is a *candidate*, not a fact: the resolver must consult an
existence check, and a relocated installation must win over the pinned default. This is the
half of AC3 that a hardcoded-path implementation passes by accident on the dev box only.

DATA SAFETY: the "executable" is an empty temp file and is never executed.
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
OBSIDIAN_EXE = _const("OBSIDIAN_EXE_PATH", "OBSIDIAN_EXE", "OBSIDIAN_EXECUTABLE")


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


def test_resolution_consults_an_existence_check_and_honours_the_pinned_candidate():
    seen = []

    def exists(path):
        seen.append(str(path))
        return str(path) == str(OBSIDIAN_EXE)

    resolved = lifecycle.resolve_executable(exists=exists)

    assert seen, "resolve_executable must actually probe the filesystem, not assume"
    assert str(OBSIDIAN_EXE) in seen
    assert resolved == str(OBSIDIAN_EXE)
    assert isinstance(resolved, str)


def test_a_relocated_installation_wins_over_the_pinned_default(tmp_path):
    relocated = tmp_path / "Portable" / "Obsidian" / "Obsidian.exe"
    relocated.parent.mkdir(parents=True)
    relocated.write_bytes(b"")

    resolved = lifecycle.resolve_executable(
        str(relocated), exists=lambda p: str(p) == str(relocated)
    )
    assert resolved == str(relocated)
    assert resolved != str(OBSIDIAN_EXE)


def test_the_resolved_path_is_what_argv0_carries(tmp_path):
    relocated = tmp_path / "Portable" / "Obsidian.exe"
    relocated.parent.mkdir(parents=True)
    relocated.write_bytes(b"")

    console = FakeConsole()
    record = lifecycle.ensure_endpoints(
        [_desc(constants.ROLE_A, "ObsidianOrga", constants.REAL_CONTROL_PORT_A),
         _desc(constants.ROLE_B, "ObsidianOrga - Kopie", constants.REAL_CONTROL_PORT_B)],
        probe=lambda role, port: False,
        console=console,
        resolve_exe=lambda: str(relocated),
    )

    assert record["ok"] is True
    spawns = [c for c in console.calls if c[0] in ("run_command", "run_python")]
    assert spawns, "a launch must have happened"
    for _kind, argv, _cid in spawns:
        assert argv[0] == str(relocated)
        assert argv[0] != str(OBSIDIAN_EXE)


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
