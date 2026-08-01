"""WP45 / AC3 / TP08 (visible) — vault name URL-encoded, argv is a LIST.

`ObsidianOrga - Kopie` contains spaces. Two failure modes are being excluded here:
  1. an unencoded (or `+`-encoded) vault name in the `obsidian://open` URI, and
  2. a joined command *string*, which is exactly what the documented `run_command`
     nested-quote trap shreds on Windows (T3_SharedContract section 9).

DATA SAFETY: pure string/argv construction; no process is created.
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

VAULT_WITH_SPACES = "ObsidianOrga - Kopie"
EXPECTED_URI = "obsidian://open?vault=ObsidianOrga%20-%20Kopie"


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
        self.calls.append(("run_command", argv, cid))
        return cid

    def run_python(self, script, *, args=None, title=""):
        self._n += 1
        cid = f"console-{self._n}"
        self.calls.append(("run_python", [str(script), *(args or [])], cid))
        return cid

    def await_console(self, console_id, *, timeout=None):
        self.calls.append(("await_console", [console_id], console_id))
        return {"console_id": console_id, "exit_code": 0}


def test_vault_name_with_spaces_is_percent_encoded_exactly():
    uri = lifecycle.obsidian_uri(VAULT_WITH_SPACES)
    assert uri == EXPECTED_URI
    assert "%20" in uri
    assert " " not in uri
    assert "+" not in uri, "spaces must be %20, not the form-encoding '+'"


def test_a_name_without_specials_is_left_alone():
    assert lifecycle.obsidian_uri("ObsidianOrga") == "obsidian://open?vault=ObsidianOrga"


def test_build_launch_argv_is_a_list_of_strings_never_a_joined_string(tmp_path):
    exe = str(tmp_path / "Obsidian.exe")
    argv = lifecycle.build_launch_argv(exe, VAULT_WITH_SPACES)

    assert isinstance(argv, list), f"argv must be a list, got {type(argv).__name__}"
    assert not isinstance(argv, str)
    assert all(isinstance(part, str) for part in argv)
    assert argv[0] == exe
    assert EXPECTED_URI in argv
    # no element is a pre-joined / pre-quoted command line
    for part in argv:
        assert '"' not in part, f"argv element must not be pre-quoted: {part!r}"
    assert not any(part.startswith("cmd") for part in argv)


def test_the_argv_reaching_the_console_seam_is_the_same_list(tmp_path):
    exe = tmp_path / "Obsidian.exe"
    exe.write_bytes(b"")
    console = FakeConsole()

    lifecycle.ensure_endpoints(
        [_desc(constants.ROLE_B, VAULT_WITH_SPACES, constants.REAL_CONTROL_PORT_B)],
        probe=lambda role, port: False,
        console=console,
        resolve_exe=lambda: str(exe),
    )

    spawns = [c for c in console.calls if c[0] in ("run_command", "run_python")]
    assert len(spawns) == 1
    argv = spawns[0][1]
    assert isinstance(argv, list)
    assert argv == [str(exe), EXPECTED_URI]


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
