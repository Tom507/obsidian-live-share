"""WP45 / D13 / TP11 (visible) — the mock rig can never be mistaken for the real one.

This is the reason PHASE T3 exists. WP7 was returned BLOCKED because a green run of the
headless mock rig proves nothing about the Teil-14 gate. After WP45 the two rigs are two
entrypoints with two rig-kind values, the headless one says so in its own banner and
`--help`, and its mock alias seam is still there (D13 keeps it, it is not ripped out).

DATA SAFETY: imports and source reads only; neither entrypoint's `main()` is run.
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

import launch_liveshare_e2e  # noqa: E402
import launch_obsidian_e2e  # noqa: E402
from obsidian_e2e import constants, lifecycle  # noqa: E402


def _const(*names):
    """Read a pinned value from constants.py (WP43) — never redefine it here."""
    for name in names:
        if hasattr(constants, name):
            return getattr(constants, name)
    raise AssertionError(f"constants.py must pin one of {names} (T3_SharedContract)")


ROLES = getattr(constants, "ROLES", (constants.ROLE_A, constants.ROLE_B))
RIG_KIND_REAL = _const("RIG_KIND_REAL", "RIG_KIND_REAL_OBSIDIAN")
RIG_KIND_HEADLESS_MOCK = _const("RIG_KIND_HEADLESS_MOCK", "RIG_KIND_MOCK", "RIG_KIND_HEADLESS")


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

    def run_command(self, argv, *, title=""):
        self.calls.append(("run_command", list(argv), "c1"))
        return "c1"

    def run_python(self, script, *, args=None, title=""):
        self.calls.append(("run_python", [str(script)], "c1"))
        return "c1"

    def await_console(self, console_id, *, timeout=None):
        return {"console_id": console_id, "exit_code": 0}


def test_the_two_rig_kinds_are_distinct_pinned_values():
    assert RIG_KIND_REAL == "real-obsidian"
    assert RIG_KIND_HEADLESS_MOCK == "headless-mock"
    assert RIG_KIND_REAL != RIG_KIND_HEADLESS_MOCK


def test_each_entrypoint_declares_its_own_rig_kind():
    assert launch_obsidian_e2e.RIG_KIND == RIG_KIND_REAL
    assert launch_liveshare_e2e.RIG_KIND == RIG_KIND_HEADLESS_MOCK
    assert lifecycle.RIG_KIND == RIG_KIND_REAL


def test_a_real_run_record_is_stamped_real_obsidian():
    console = FakeConsole()
    record = lifecycle.ensure_endpoints(
        [_desc(constants.ROLE_A, "ObsidianOrga", constants.REAL_CONTROL_PORT_A)],
        probe=lambda role, port: True,
        console=console,
        resolve_exe=lambda: None,
    )
    assert record["rig_kind"] == RIG_KIND_REAL
    assert record["rig_kind"] != RIG_KIND_HEADLESS_MOCK


def test_the_headless_entrypoint_self_identifies_as_the_mock_rig():
    banner = launch_liveshare_e2e.HEADLESS_BANNER
    assert isinstance(banner, str) and banner.strip()
    low = banner.lower()
    assert "headless" in low and "mock" in low
    assert "cannot satisfy" in low
    assert "gate" in low or "teil-14" in low or "teil 14" in low


def test_the_headless_help_text_carries_the_same_warning(monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["launch_liveshare_e2e.py", "--help"])
    try:
        launch_liveshare_e2e.main()
    except SystemExit:
        pass
    # argparse reflows the description, so compare on collapsed whitespace
    out = " ".join(capsys.readouterr().out.lower().split())
    assert "headless" in out and "mock" in out
    assert "cannot satisfy" in out


def test_the_headless_mock_alias_seam_is_preserved_not_ripped_out():
    src = (TOOLS_DIR / "launch_liveshare_e2e.py").read_text(encoding="utf-8")
    assert "--alias:obsidian=" in src, "the mock alias (line ~101) must survive D13"
    assert "OBSIDIAN_MOCK" in src
    assert "__mocks__" in src and "obsidian.ts" in src
    assert launch_liveshare_e2e.OBSIDIAN_MOCK.name == "obsidian.ts"


def test_the_real_rig_does_not_import_the_headless_mock_path():
    src = (TOOLS_DIR / "launch_obsidian_e2e.py").read_text(encoding="utf-8")
    assert "__mocks__" not in src
    assert "alias:obsidian" not in src


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
