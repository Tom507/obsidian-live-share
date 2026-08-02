"""WP45 / AC3 / TP08 (blind2) — encoding is applied literally, never "smartly".

Angle: a vault whose name already *looks* percent-encoded (`Orga%20Kopie`) must be encoded
again to `Orga%2520Kopie`, because the name is a literal string and the `%` is part of it.
An implementation that "detects" existing encoding to avoid double-encoding opens the wrong
vault — or none. Also pins argv arity and the exact URI scheme prefix.

DATA SAFETY: pure string construction.
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


class ArgvConsole:
    def __init__(self):
        self.argvs = []

    def run_command(self, argv, *, title=""):
        self.argvs.append(argv)
        return "cid"

    def run_python(self, script, *, args=None, title=""):
        self.argvs.append([str(script), *(args or [])])
        return "cid"

    def await_console(self, console_id, *, timeout=None):
        return {"exit_code": 0}


def test_an_already_encoded_looking_name_is_encoded_again():
    assert lifecycle.obsidian_uri("Orga%20Kopie") == "obsidian://open?vault=Orga%2520Kopie"


def test_a_literal_percent_is_encoded():
    assert lifecycle.obsidian_uri("100% Notes") == "obsidian://open?vault=100%25%20Notes"


def test_the_scheme_and_query_key_are_exact():
    uri = lifecycle.obsidian_uri("X")
    assert uri.startswith("obsidian://open?vault=")
    assert uri.count("?") == 1
    assert uri.count("vault=") == 1
    assert not uri.endswith("&")


def test_an_empty_vault_name_still_produces_a_well_formed_uri():
    assert lifecycle.obsidian_uri("") == "obsidian://open?vault="


def test_argv_arity_is_exactly_two_and_order_is_exe_then_uri(tmp_path):
    exe = tmp_path / "Obsidian.exe"
    exe.write_bytes(b"")
    argv = lifecycle.build_launch_argv(str(exe), "Orga%20Kopie")
    assert isinstance(argv, list)
    assert len(argv) == 2
    assert argv[0] == str(exe)
    assert argv[1].startswith("obsidian://")


def test_the_console_never_receives_a_shell_string(tmp_path):
    exe = tmp_path / "Obsidian.exe"
    exe.write_bytes(b"")
    console = ArgvConsole()
    lifecycle.ensure_endpoints(
        [SimpleNamespace(role=constants.ROLE_A, vault_path="h:/tmp/x",
                         vault_name="100% Notes",
                         control_port=constants.REAL_CONTROL_PORT_A,
                         port_provisioned_while_running=False)],
        probe=lambda r, p: False, console=console, resolve_exe=lambda: str(exe),
    )
    assert len(console.argvs) == 1
    argv = console.argvs[0]
    assert not isinstance(argv, str)
    assert isinstance(argv, list)
    assert argv[1] == "obsidian://open?vault=100%25%20Notes"


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
