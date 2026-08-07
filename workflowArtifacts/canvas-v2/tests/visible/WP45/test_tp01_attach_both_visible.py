"""WP45 / AC1 / TP01 (visible) — both control endpoints answer -> both roles ATTACH.

DATA SAFETY: no real process is started, probed or terminated. The control probe and
the visible-console seam are both injected fakes; nothing touches a real vault.
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


def _desc(role, vault_name, port, *, provisioned_while_running=False):
    return SimpleNamespace(
        role=role,
        vault_path=str(Path("h:/tmp/wp45-fixture") / vault_name),
        vault_name=vault_name,
        control_port=port,
        port_provisioned_while_running=provisioned_while_running,
    )


class FakeConsole:
    """visible-console stand-in. Records calls, starts nothing."""

    def __init__(self):
        self.calls = []
        self._n = 0

    def run_command(self, argv, *, title=""):
        assert isinstance(argv, list), f"argv must be a list, got {type(argv).__name__}"
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


def test_both_endpoints_answer_records_attach_for_every_role():
    instances = [
        _desc(constants.ROLE_A, "ObsidianOrga", constants.REAL_CONTROL_PORT_A),
        _desc(constants.ROLE_B, "ObsidianOrga - Kopie", constants.REAL_CONTROL_PORT_B),
    ]
    console = FakeConsole()
    probed = []

    def probe(role, port):
        probed.append((role, port))
        return True  # both endpoints answer

    record = lifecycle.ensure_endpoints(
        instances,
        probe=probe,
        console=console,
        resolve_exe=lambda: (_ for _ in ()).throw(
            AssertionError("resolve_exe must not be consulted when both roles attach")
        ),
    )

    # --- the run record is the oracle, not the side effect -------------------
    assert record["ok"] is True
    assert record["reason"] is None
    assert set(record["roles"]) == set(ROLES)
    for role in ROLES:
        entry = record["roles"][role]
        assert entry["role"] == role
        assert entry["mode"] == "attach", f"role {role} must be recorded as attach"
        assert entry["launched_by_rig"] is False
        assert entry["console_id"] is None

    # both endpoints were actually probed, on the real-rig ports
    assert probed == [
        (constants.ROLE_A, constants.REAL_CONTROL_PORT_A),
        (constants.ROLE_B, constants.REAL_CONTROL_PORT_B),
    ]

    # --- attaching starts nothing and terminates nothing (D15) --------------
    assert console.calls == []
    assert record["terminated"] == []


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
