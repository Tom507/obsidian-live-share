"""WP45 / AC2 / TP04 (blind2) — a tempting PID on the descriptor must stay unused.

Angle: the visible test sweeps code paths. This one hands the rig everything it would need
to kill a foreign window — a `pid` and an `hwnd` on the descriptor, and a `terminate` method
on the console — and proves none of it is touched. Offering the capability and observing
that it is refused is a stronger oracle than observing that it was absent.

DATA SAFETY: the pid is fake (-1) and every real primitive is intercepted.
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

FOREIGN_PID = 424242


class TemptingConsole:
    """Exposes kill-shaped affordances that the rig must never call."""

    def __init__(self):
        self.forbidden_calls = []
        self.spawns = []
        self._n = 0

    def run_command(self, argv, *, title=""):
        self._n += 1
        self.spawns.append(list(argv))
        return f"cid-{self._n}"

    def run_python(self, script, *, args=None, title=""):
        self._n += 1
        self.spawns.append([str(script), *(args or [])])
        return f"cid-{self._n}"

    def await_console(self, console_id, *, timeout=None):
        return {"exit_code": 0}

    # --- affordances the rig must refuse ---------------------------------
    def terminate(self, *a, **kw):
        self.forbidden_calls.append(("terminate", a))

    def kill(self, *a, **kw):
        self.forbidden_calls.append(("kill", a))

    def stop_console(self, *a, **kw):
        self.forbidden_calls.append(("stop_console", a))

    def close_window(self, *a, **kw):
        self.forbidden_calls.append(("close_window", a))


def _tempting_instances(dirty):
    return [
        SimpleNamespace(role=constants.ROLE_A, vault_path="h:/tmp/wp45b2/Eins",
                        vault_name="Eins", control_port=constants.REAL_CONTROL_PORT_A,
                        port_provisioned_while_running=dirty,
                        pid=FOREIGN_PID, hwnd=999999, owned_by_rig=False),
        SimpleNamespace(role=constants.ROLE_B, vault_path="h:/tmp/wp45b2/Zwei",
                        vault_name="Zwei", control_port=constants.REAL_CONTROL_PORT_B,
                        port_provisioned_while_running=dirty,
                        pid=FOREIGN_PID + 1, hwnd=999998, owned_by_rig=False),
    ]


class OsSpy:
    def __init__(self):
        self.hits = []

    def install(self, monkeypatch):
        def rec(label):
            def _f(*a, **kw):
                self.hits.append((label, a))
                return SimpleNamespace(pid=-1, returncode=0)

            return _f

        for mod, attr in (
            (os, "kill"), (os, "system"), (os, "popen"), (os, "startfile"),
            (subprocess, "Popen"), (subprocess, "run"), (subprocess, "call"),
            (subprocess, "check_call"), (subprocess, "check_output"),
        ):
            if hasattr(mod, attr):
                monkeypatch.setattr(mod, attr, rec(f"{mod.__name__}.{attr}"))


@pytest.mark.parametrize("dirty,answering", [(False, True), (False, False), (True, False)])
def test_the_foreign_pid_is_never_used_and_no_affordance_is_called(
    dirty, answering, monkeypatch, tmp_path
):
    exe = tmp_path / "Obsidian.exe"
    exe.write_bytes(b"")
    spy = OsSpy()
    spy.install(monkeypatch)
    console = TemptingConsole()

    record = lifecycle.ensure_endpoints(
        _tempting_instances(dirty),
        probe=lambda r, p: answering,
        console=console,
        resolve_exe=lambda: str(exe),
    )

    assert console.forbidden_calls == [], f"rig used a kill affordance: {console.forbidden_calls}"
    assert spy.hits == [], f"rig reached an OS primitive: {spy.hits}"
    assert record["terminated"] == []
    assert isinstance(record["terminated"], list)

    # the foreign pid must not appear anywhere in what the rig produced
    blob = repr(record) + repr(console.spawns)
    assert str(FOREIGN_PID) not in blob
    assert str(FOREIGN_PID + 1) not in blob


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
