"""WP45 / AC2 / TP04 (blind1) — kill spy across a RE-RUN on a dirty host.

Angle: the visible test sweeps the scenario matrix once. Here the same rig is re-run
back-to-back without teardown (the documented "retrying compounds state" hazard) and the
attach/launch mix flips between runs — the temptation to "clean up" the previous run's
window is exactly where a terminate creeps in. The recorded kill set must stay empty.

DATA SAFETY: every termination and spawn primitive is intercepted before it can run.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

TOOLS_DIR = Path(__file__).resolve().parents[5] / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from obsidian_e2e import constants, lifecycle  # noqa: E402

KILL_WORDS = ("taskkill", "stop-process", "pkill", "killall", "terminate", "wmic process")


def _inst(role, name, port, *, dirty=False):
    return SimpleNamespace(
        role=role, vault_path=f"h:/tmp/wp45b1/{name}", vault_name=name,
        control_port=port, port_provisioned_while_running=dirty,
    )


class ProcessSpy:
    def __init__(self):
        self.hits = []

    def install(self, monkeypatch):
        def rec(label):
            def _f(*a, **kw):
                self.hits.append((label, a, kw))
                return SimpleNamespace(pid=-1, returncode=0)

            return _f

        for mod, attr in (
            (os, "kill"), (os, "system"), (os, "popen"), (os, "startfile"),
            (os, "execv"), (os, "abort"),
            (subprocess, "Popen"), (subprocess, "run"), (subprocess, "call"),
            (subprocess, "check_call"), (subprocess, "check_output"),
        ):
            if hasattr(mod, attr):
                monkeypatch.setattr(mod, attr, rec(f"{mod.__name__}.{attr}"))


class RecordingConsole:
    def __init__(self):
        self.commands = []
        self._n = 0

    def run_command(self, argv, *, title=""):
        self._n += 1
        self.commands.append(list(argv))
        return f"c{self._n}"

    def run_python(self, script, *, args=None, title=""):
        self._n += 1
        self.commands.append([str(script), *(args or [])])
        return f"c{self._n}"

    def await_console(self, console_id, *, timeout=None):
        return {"exit_code": 0}


def test_two_consecutive_runs_without_teardown_never_terminate_anything(monkeypatch, tmp_path):
    exe = tmp_path / "Obsidian.exe"
    exe.write_bytes(b"")
    spy = ProcessSpy()
    spy.install(monkeypatch)

    # run 1: nothing is up -> both launch. run 2: both are now up -> both attach.
    states = [False, True]
    for round_index, answering in enumerate(states):
        console = RecordingConsole()
        record = lifecycle.ensure_endpoints(
            [_inst(constants.ROLE_A, "DirtyVault A", constants.REAL_CONTROL_PORT_A),
             _inst(constants.ROLE_B, "DirtyVault B", constants.REAL_CONTROL_PORT_B)],
            probe=lambda r, p, _a=answering: _a,
            console=console,
            resolve_exe=lambda: str(exe),
        )
        assert spy.hits == [], f"round {round_index}: OS process primitive reached {spy.hits}"
        assert record["terminated"] == []
        for argv in console.commands:
            blob = " ".join(str(part) for part in argv).lower()
            assert not any(word in blob for word in KILL_WORDS), f"kill-ish argv: {argv}"

    assert spy.hits == []


def test_the_dirty_restart_case_also_terminates_nothing(monkeypatch, tmp_path):
    exe = tmp_path / "Obsidian.exe"
    exe.write_bytes(b"")
    spy = ProcessSpy()
    spy.install(monkeypatch)
    console = RecordingConsole()

    record = lifecycle.ensure_endpoints(
        [_inst(constants.ROLE_A, "DirtyVault A", constants.REAL_CONTROL_PORT_A, dirty=True),
         _inst(constants.ROLE_B, "DirtyVault B", constants.REAL_CONTROL_PORT_B, dirty=True)],
        probe=lambda r, p: False,
        console=console,
        resolve_exe=lambda: str(exe),
    )

    assert record["ok"] is False
    assert spy.hits == []
    assert console.commands == []
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
