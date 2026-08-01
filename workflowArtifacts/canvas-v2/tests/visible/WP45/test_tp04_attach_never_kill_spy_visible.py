"""WP45 / AC2 / TP04 (visible) — ATTACH-NEVER-KILL, proven with a kill spy (D15).

Every OS-level termination primitive is replaced by a recorder. The rig is then driven
through EVERY code path it has (both-attach, both-launch, mixed, restart-required,
executable-missing) and the recorded set of terminations must be EMPTY on all of them.

This is the single most important test in WP45: the two vaults are the owner's live
working vaults, and a rig that closes one destroys unsaved user state.

DATA SAFETY: the spies make it structurally impossible for this test to end a process
even if the implementation tried — every primitive is intercepted before it can run.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

REPO_ROOT = Path(__file__).resolve().parents[5]
TOOLS_DIR = REPO_ROOT / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from obsidian_e2e import constants, lifecycle  # noqa: E402

KILL_TOKENS = (
    "taskkill",
    "stop-process",
    "pkill",
    "killall",
    "terminateprocess",
    "/f /pid",
    "kill ",
)


def _desc(role, vault_name, port, *, provisioned_while_running=False):
    return SimpleNamespace(
        role=role,
        vault_path=str(Path("h:/tmp/wp45-fixture") / vault_name),
        vault_name=vault_name,
        control_port=port,
        port_provisioned_while_running=provisioned_while_running,
    )


class KillSpy:
    """Records every attempt to start or end an OS process."""

    def __init__(self):
        self.terminations = []
        self.spawns = []

    def install(self, monkeypatch):
        def rec_term(name):
            def _f(*a, **kw):
                self.terminations.append((name, a, kw))
                return 0

            return _f

        def rec_spawn(name):
            def _f(*a, **kw):
                self.spawns.append((name, a, kw))
                return SimpleNamespace(pid=-1, returncode=0)

            return _f

        for mod, attr, rec in (
            (os, "kill", rec_term),
            (os, "system", rec_term),
            (os, "popen", rec_term),
            (subprocess, "Popen", rec_spawn),
            (subprocess, "run", rec_spawn),
            (subprocess, "call", rec_spawn),
            (subprocess, "check_call", rec_spawn),
            (subprocess, "check_output", rec_spawn),
        ):
            if hasattr(mod, attr):
                monkeypatch.setattr(mod, attr, rec(f"{mod.__name__}.{attr}"))
        if hasattr(os, "startfile"):
            monkeypatch.setattr(os, "startfile", rec_spawn("os.startfile"))
        # a module that imported the primitives by name is caught too
        for attr in ("Popen", "kill", "system", "startfile", "run"):
            if hasattr(lifecycle, attr):
                monkeypatch.setattr(lifecycle, attr, rec_term(f"lifecycle.{attr}"))


class FakeConsole:
    def __init__(self):
        self.calls = []
        self._n = 0

    def run_command(self, argv, *, title=""):
        assert isinstance(argv, list)
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


def _scenarios(exe_path):
    """(name, instances, probe, resolve_exe) for every path the lifecycle has."""
    both = lambda: [  # noqa: E731
        _desc(constants.ROLE_A, "ObsidianOrga", constants.REAL_CONTROL_PORT_A),
        _desc(constants.ROLE_B, "ObsidianOrga - Kopie", constants.REAL_CONTROL_PORT_B),
    ]
    open_windows = [
        _desc(constants.ROLE_A, "ObsidianOrga", constants.REAL_CONTROL_PORT_A,
              provisioned_while_running=True),
        _desc(constants.ROLE_B, "ObsidianOrga - Kopie", constants.REAL_CONTROL_PORT_B,
              provisioned_while_running=True),
    ]
    return [
        ("both-attach", both(), lambda r, p: True, lambda: str(exe_path)),
        ("both-launch", both(), lambda r, p: False, lambda: str(exe_path)),
        ("mixed", both(), lambda r, p: r == constants.ROLE_A, lambda: str(exe_path)),
        ("restart-required", open_windows, lambda r, p: False, lambda: str(exe_path)),
        ("exe-missing", both(), lambda r, p: False, lambda: None),
    ]


def test_no_code_path_ever_terminates_a_process_the_rig_did_not_start(monkeypatch, tmp_path):
    exe = tmp_path / "Obsidian.exe"
    exe.write_bytes(b"")

    spy = KillSpy()
    spy.install(monkeypatch)

    for name, instances, probe, resolve_exe in _scenarios(exe):
        console = FakeConsole()
        record = lifecycle.ensure_endpoints(
            instances, probe=probe, console=console, resolve_exe=resolve_exe
        )

        # 1. no OS termination primitive was reached at all
        assert spy.terminations == [], f"[{name}] rig issued terminations: {spy.terminations}"
        # 2. nothing was spawned outside the injected console seam
        assert spy.spawns == [], f"[{name}] rig spawned outside the console seam: {spy.spawns}"
        # 3. no console command is a disguised kill
        for kind, argv, _cid in console.calls:
            joined = " ".join(str(p) for p in argv).lower()
            for token in KILL_TOKENS:
                assert token not in joined, f"[{name}] kill-ish console call: {kind} {argv}"
        # 4. the run record itself declares that nothing was terminated
        assert record["terminated"] == [], f"[{name}] record shows terminations"

    assert spy.terminations == []
    assert spy.spawns == []


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
