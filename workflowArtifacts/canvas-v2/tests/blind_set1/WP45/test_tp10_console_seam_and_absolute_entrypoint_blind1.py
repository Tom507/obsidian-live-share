"""WP45 / AC4 / TP10 (blind1) — no orphan console, and the entrypoint is script-shaped.

Angle: the visible test checks the run_*/await_console pairing positionally. Here the
console hands out shuffled, non-sequential ids, so the pairing must be proven by identity
rather than by order — and the entrypoint is checked for being a real, absolutely-addressed
script (has a `__main__` guard, no `..` in its path).

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

import launch_obsidian_e2e  # noqa: E402
from obsidian_e2e import constants, lifecycle  # noqa: E402


def _inst(role, name, port):
    return SimpleNamespace(
        role=role, vault_path=f"h:/tmp/wp45b1/{name}", vault_name=name,
        control_port=port, port_provisioned_while_running=False,
    )


class ShuffledConsole:
    """Hands out unpredictable console ids so ordering cannot be assumed."""

    IDS = ["zz-9", "aa-1", "mm-5", "bb-2"]

    def __init__(self):
        self.issued = []
        self.awaited = []
        self._i = 0

    def _next(self):
        cid = self.IDS[self._i % len(self.IDS)]
        self._i += 1
        self.issued.append(cid)
        return cid

    def run_command(self, argv, *, title=""):
        assert isinstance(argv, list)
        return self._next()

    def run_python(self, script, *, args=None, title=""):
        return self._next()

    def await_console(self, console_id, *, timeout=None):
        self.awaited.append(console_id)
        return {"exit_code": 0}


def test_no_console_is_left_unawaited(tmp_path):
    exe = tmp_path / "Obsidian.exe"
    exe.write_bytes(b"")
    console = ShuffledConsole()

    record = lifecycle.ensure_endpoints(
        [_inst(constants.ROLE_A, "EinsVault", constants.REAL_CONTROL_PORT_A),
         _inst(constants.ROLE_B, "Zwei Vault", constants.REAL_CONTROL_PORT_B)],
        probe=lambda r, p: False, console=console, resolve_exe=lambda: str(exe),
    )

    assert console.issued, "a launch must have happened"
    assert sorted(console.awaited) == sorted(console.issued), (
        "every started console must be awaited — an unawaited one is a detached process"
    )
    # the id recorded per role is one the console actually issued
    for role in (constants.ROLE_A, constants.ROLE_B):
        assert record["roles"][role]["console_id"] in console.issued


def test_the_entrypoint_is_an_absolute_normalised_script_path():
    entry = Path(str(launch_obsidian_e2e.ENTRYPOINT_PATH))
    assert entry.is_absolute()
    assert ".." not in entry.parts
    assert entry.suffix == ".py"
    assert entry.parent.name == "tools"


def test_the_entrypoint_is_runnable_as_a_script_not_only_importable():
    src = Path(str(launch_obsidian_e2e.ENTRYPOINT_PATH)).read_text(encoding="utf-8")
    assert '__name__ == "__main__"' in src or "__name__ == '__main__'" in src
    assert "def main(" in src


def test_the_record_entrypoint_matches_the_module_entrypoint(tmp_path):
    exe = tmp_path / "Obsidian.exe"
    exe.write_bytes(b"")
    record = lifecycle.ensure_endpoints(
        [_inst(constants.ROLE_A, "EinsVault", constants.REAL_CONTROL_PORT_A)],
        probe=lambda r, p: True, console=ShuffledConsole(), resolve_exe=lambda: str(exe),
    )
    assert Path(record["entrypoint"]) == Path(str(launch_obsidian_e2e.ENTRYPOINT_PATH))


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
