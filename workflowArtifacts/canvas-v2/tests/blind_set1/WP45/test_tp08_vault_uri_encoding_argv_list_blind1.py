"""WP45 / AC3 / TP08 (blind1) — encoding beyond the space: reserved URI characters.

Angle: the visible test uses `ObsidianOrga - Kopie` (spaces only). A vault name may also
contain `&`, `#`, `?`, `/`, `+` and non-ASCII — every one of which either truncates or
re-routes the URI if it is not percent-encoded. `+` must survive as `%2B`, not be treated
as a space.

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

CASES = [
    ("Notes & Ideen", "obsidian://open?vault=Notes%20%26%20Ideen"),
    ("Vault#1", "obsidian://open?vault=Vault%231"),
    ("was?wo", "obsidian://open?vault=was%3Fwo"),
    ("a/b", "obsidian://open?vault=a%2Fb"),
    ("C++Notes", "obsidian://open?vault=C%2B%2BNotes"),
    ("Grüße", "obsidian://open?vault=Gr%C3%BC%C3%9Fe"),
    ("plain-name_1.0~x", "obsidian://open?vault=plain-name_1.0~x"),
]


class RecordingConsole:
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


@pytest.mark.parametrize("vault_name,expected", CASES)
def test_reserved_characters_are_percent_encoded(vault_name, expected):
    assert lifecycle.obsidian_uri(vault_name) == expected


def test_unreserved_characters_are_left_untouched():
    """RFC 3986 unreserved set stays literal — over-encoding is also wrong."""
    uri = lifecycle.obsidian_uri("plain-name_1.0~x")
    assert "%" not in uri.split("vault=", 1)[1]


def test_plus_is_never_used_as_a_space_substitute():
    assert lifecycle.obsidian_uri("a b") == "obsidian://open?vault=a%20b"
    assert "+" not in lifecycle.obsidian_uri("a b")


def test_argv_stays_a_two_element_list_whatever_the_name(tmp_path):
    exe = tmp_path / "Obsidian.exe"
    exe.write_bytes(b"")
    for vault_name, expected in CASES:
        argv = lifecycle.build_launch_argv(str(exe), vault_name)
        assert isinstance(argv, list) and len(argv) == 2
        assert argv == [str(exe), expected]


def test_the_console_receives_the_list_unflattened(tmp_path):
    exe = tmp_path / "Obsidian.exe"
    exe.write_bytes(b"")
    console = RecordingConsole()
    lifecycle.ensure_endpoints(
        [SimpleNamespace(role=constants.ROLE_A, vault_path="h:/tmp/x",
                         vault_name="Notes & Ideen",
                         control_port=constants.REAL_CONTROL_PORT_A,
                         port_provisioned_while_running=False)],
        probe=lambda r, p: False, console=console, resolve_exe=lambda: str(exe),
    )
    assert len(console.argvs) == 1
    argv = console.argvs[0]
    assert isinstance(argv, list)
    assert argv[1] == "obsidian://open?vault=Notes%20%26%20Ideen"


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
