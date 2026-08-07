"""WP45 / AC1 / TP01 (blind2) — the attach record must be a serialisable, secret-free record.

Angle: AC1 says the attach/launch decision is *recorded in the run record*. A record that
cannot be written out is not a record. It must round-trip through JSON, and it must carry
no plugin secret (S4: `data.json` holds `serverPassword`/`token`/`jwt`).

DATA SAFETY: fakes only.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

TOOLS_DIR = Path(__file__).resolve().parents[5] / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from obsidian_e2e import constants, lifecycle  # noqa: E402

ROLES = getattr(constants, "ROLES", (constants.ROLE_A, constants.ROLE_B))
SECRET_KEYS = ("serverpassword", "password", "token", "jwt", "secret", "passphrase")


class InertConsole:
    def __init__(self):
        self.used = False

    def run_command(self, argv, *, title=""):
        self.used = True
        return "cid"

    def run_python(self, script, *, args=None, title=""):
        self.used = True
        return "cid"

    def await_console(self, console_id, *, timeout=None):
        return {"exit_code": 0}


def _record():
    instances = [
        SimpleNamespace(role=constants.ROLE_A, vault_path="h:/tmp/wp45b2/Alpha",
                        vault_name="Alpha", control_port=constants.REAL_CONTROL_PORT_A,
                        port_provisioned_while_running=False,
                        serverPassword="NEVER-COPY-ME"),
        SimpleNamespace(role=constants.ROLE_B, vault_path="h:/tmp/wp45b2/Beta Kopie",
                        vault_name="Beta Kopie", control_port=constants.REAL_CONTROL_PORT_B,
                        port_provisioned_while_running=False,
                        serverPassword="NEVER-COPY-ME"),
    ]
    return lifecycle.ensure_endpoints(
        instances, probe=lambda r, p: True, console=InertConsole(), resolve_exe=lambda: None
    )


def test_the_run_record_round_trips_through_json():
    record = _record()
    restored = json.loads(json.dumps(record))
    assert restored == record
    assert restored["roles"][constants.ROLE_A]["mode"] == "attach"


def test_the_record_carries_no_secret_material():
    blob = json.dumps(_record()).lower()
    for key in SECRET_KEYS:
        assert key not in blob, f"run record leaks {key!r} (T3_SharedContract S4)"
    assert "never-copy-me" not in blob


def test_the_record_declares_the_decision_for_every_configured_role():
    record = _record()
    assert set(record["roles"]) == set(ROLES)
    for role in ROLES:
        entry = record["roles"][role]
        assert entry["mode"] in ("attach", "launch")
        assert entry["mode"] == "attach"
        assert isinstance(entry["launched_by_rig"], bool)


def test_attaching_does_not_engage_the_console_at_all():
    console = InertConsole()
    lifecycle.ensure_endpoints(
        [SimpleNamespace(role=constants.ROLE_A, vault_path="h:/tmp/x", vault_name="Alpha",
                         control_port=constants.REAL_CONTROL_PORT_A,
                         port_provisioned_while_running=False)],
        probe=lambda r, p: True, console=console, resolve_exe=lambda: None,
    )
    assert console.used is False


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
