"""WP45 / D13 / TP11 (blind2) — the real rig cannot be talked into stamping the mock kind.

Angle: the visible test compares the two declared kinds. This one attacks from the other
side — it tries to obtain a mock-stamped record *from the real lifecycle* and asserts that
no input produces one, and that the real entrypoint's own text claims the gate while the
headless one disclaims it.

DATA SAFETY: fakes, imports and source reads only.
"""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

TOOLS_DIR = Path(__file__).resolve().parents[5] / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import launch_liveshare_e2e  # noqa: E402
import launch_obsidian_e2e  # noqa: E402
from obsidian_e2e import constants, lifecycle  # noqa: E402


def _const(*names):
    for name in names:
        if hasattr(constants, name):
            return getattr(constants, name)
    raise AssertionError(f"constants.py must pin one of {names} (T3_SharedContract)")


RIG_REAL = _const("RIG_KIND_REAL", "RIG_KIND_REAL_OBSIDIAN")
RIG_MOCK = _const("RIG_KIND_HEADLESS_MOCK", "RIG_KIND_MOCK", "RIG_KIND_HEADLESS")


class NullConsole:
    def run_command(self, argv, *, title=""):
        return "cid"

    def run_python(self, script, *, args=None, title=""):
        return "cid"

    def await_console(self, console_id, *, timeout=None):
        return {"exit_code": 0}


def _instance(**overrides):
    base = dict(
        role=constants.ROLE_A, vault_path="h:/tmp/wp45b2/X", vault_name="X",
        control_port=constants.REAL_CONTROL_PORT_A, port_provisioned_while_running=False,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


@pytest.mark.parametrize(
    "instances,probe,resolve",
    [
        ([_instance()], lambda r, p: True, lambda: None),
        ([_instance()], lambda r, p: False, lambda: None),
        ([_instance(port_provisioned_while_running=True)], lambda r, p: False, lambda: None),
        ([_instance(rig_kind="headless-mock")], lambda r, p: True, lambda: None),
    ],
)
def test_no_input_makes_the_real_lifecycle_stamp_the_mock_kind(instances, probe, resolve):
    record = lifecycle.ensure_endpoints(
        instances, probe=probe, console=NullConsole(), resolve_exe=resolve
    )
    assert record["rig_kind"] == RIG_REAL
    assert record["rig_kind"] != RIG_MOCK


def test_the_rig_kind_vocabulary_is_exactly_two_values():
    assert {RIG_REAL, RIG_MOCK} == {"real-obsidian", "headless-mock"}


def test_the_real_entrypoint_claims_the_gate_and_the_mock_one_disclaims_it():
    real_text = " ".join(
        str(getattr(launch_obsidian_e2e, attr, "")) for attr in ("__doc__", "REAL_BANNER")
    ).lower()
    mock_text = " ".join(
        str(getattr(launch_liveshare_e2e, attr, "")) for attr in ("__doc__", "HEADLESS_BANNER")
    ).lower()
    real_text = " ".join(real_text.split())
    mock_text = " ".join(mock_text.split())

    assert "real" in real_text and "obsidian" in real_text
    assert "cannot satisfy" not in real_text
    assert "cannot satisfy" in mock_text
    assert "mock" in mock_text


def test_the_mock_rig_does_not_import_the_real_lifecycle_module():
    """The two rigs stay separate entrypoints; the mock one is not quietly rewired."""
    src = (TOOLS_DIR / "launch_liveshare_e2e.py").read_text(encoding="utf-8")
    assert "lifecycle" not in src
    assert "ensure_endpoints" not in src


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
