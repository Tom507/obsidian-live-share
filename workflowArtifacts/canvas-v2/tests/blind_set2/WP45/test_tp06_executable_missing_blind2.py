"""WP45 / AC3 / TP06 (blind2) — degenerate resolver results are misses, not launches.

Angle: `None` is the obvious miss. The dangerous ones are the *falsy-looking* results a
sloppy resolver produces — `""`, whitespace, a directory instead of a file — because each of
them can still be handed to a spawn call and produce an obscure OS error instead of the
pinned `LAUNCH_EXECUTABLE_MISSING`.

DATA SAFETY: nothing launchable exists; the guard blocks the primitives regardless.
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


class InertConsole:
    def __init__(self):
        self.calls = []

    def run_command(self, argv, *, title=""):
        self.calls.append(list(argv))
        return "cid"

    def run_python(self, script, *, args=None, title=""):
        self.calls.append([str(script)])
        return "cid"

    def await_console(self, console_id, *, timeout=None):
        return {"exit_code": 0}


def _instance():
    return SimpleNamespace(
        role=constants.ROLE_A, vault_path="h:/tmp/wp45b2/Solo", vault_name="Solo Vault",
        control_port=constants.REAL_CONTROL_PORT_A, port_provisioned_while_running=False,
    )


@pytest.mark.parametrize("bad", [None, ""])
def test_degenerate_resolver_results_abort_under_the_pinned_reason(bad):
    console = InertConsole()
    record = lifecycle.ensure_endpoints(
        [_instance()], probe=lambda r, p: False, console=console, resolve_exe=lambda: bad
    )
    assert record["ok"] is False
    assert record["reason"] == constants.LAUNCH_EXECUTABLE_MISSING
    assert console.calls == [], f"the rig tried to spawn {bad!r}"


def test_the_reason_string_is_its_own_name():
    """The enum values are literal identifiers — a typo'd variant would be silent."""
    assert constants.LAUNCH_EXECUTABLE_MISSING == "LAUNCH_EXECUTABLE_MISSING"
    assert constants.LAUNCH_EXECUTABLE_MISSING.isupper()


def test_an_attaching_role_is_unaffected_by_a_missing_executable():
    """No launch is needed, so a missing executable must not fail the run."""
    console = InertConsole()
    record = lifecycle.ensure_endpoints(
        [_instance()], probe=lambda r, p: True, console=console, resolve_exe=lambda: None
    )
    assert record["ok"] is True
    assert record["reason"] is None
    assert record["roles"][constants.ROLE_A]["mode"] == "attach"
    assert console.calls == []


def test_resolution_of_a_directory_shaped_path_is_still_a_miss(tmp_path):
    a_dir = tmp_path / "Obsidian"
    a_dir.mkdir()
    # `exists` is an is-file predicate: a directory must not satisfy it
    assert lifecycle.resolve_executable(str(a_dir), exists=lambda p: Path(p).is_file()) != str(a_dir)


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
