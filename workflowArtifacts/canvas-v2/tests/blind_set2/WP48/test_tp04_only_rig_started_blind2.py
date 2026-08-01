"""WP48 · TP04 (blind 2) — D15 as a whole-teardown invariant.

Angle: instead of reading a terminate list, the fake raises on the first
forbidden call, so an attached process being stopped is an immediate, loud
failure rather than an assertion at the end. Also covers the empty ledger and
a ledger of attached-only processes across every exit path.

DATA SAFETY: fakes only.
"""
from __future__ import annotations

import sys
from pathlib import Path


def _tools_dir() -> Path:
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "tools").is_dir() and (parent / "plugin").is_dir():
            return parent / "tools"
    raise RuntimeError(f"obsidian-live-share repo root not found above {here}")


sys.path.insert(0, str(_tools_dir()))

import pytest  # noqa: E402
from obsidian_e2e import constants, teardown  # noqa: E402


class ForbiddenTerminate(Exception):
    """Raised by the fake when D15 is violated."""


class GuardedIO:
    def __init__(self, allowed: set[int]) -> None:
        self.allowed = allowed
        self.terminated: list[int] = []
        self.violations: list[int] = []

    def restore_setting(self, record) -> None:
        pass

    def remove_scratch(self, path) -> None:
        pass

    def terminate_process(self, pid: int) -> None:
        if pid not in self.allowed:
            self.violations.append(pid)
            raise ForbiddenTerminate(f"D15 violated: pid {pid} was not started by the rig")
        self.terminated.append(pid)


def _drive(processes, allowed, body=lambda: None):
    io = GuardedIO(allowed)
    steps: list[str] = []
    runner = teardown.TeardownRunner(
        provisioned_settings=[{"role": constants.ROLE_A}],
        scratch_artefacts=["s" + constants.SCRATCH_EXT],
        processes=list(processes),
        io=io,
        recorder=steps.append,
    )
    return io, steps, teardown.run_with_teardown(body, runner)


def _raise(exc):
    def _body():
        raise exc

    return _body


@pytest.mark.parametrize(
    "body",
    [
        lambda: None,
        _raise(AssertionError("diverged")),
        _raise(RuntimeError("lost")),
        _raise(KeyboardInterrupt()),
    ],
    ids=["success", "assertion", "exception", "interrupt"],
)
def test_attached_only_ledger_never_triggers_a_terminate(body) -> None:
    ledger = [
        teardown.ProcessRecord(pid=8801, role=constants.ROLE_A, rig_started=False),
        teardown.ProcessRecord(pid=8802, role=constants.ROLE_B, rig_started=False),
    ]
    io, steps, outcome = _drive(ledger, allowed=set(), body=body)

    assert io.violations == []
    assert io.terminated == []
    assert steps == list(teardown.TEARDOWN_STEP_ORDER)
    assert outcome.teardown_result.ok is True


def test_mixed_ledger_terminates_only_the_two_rig_started_pids() -> None:
    ledger = [
        teardown.ProcessRecord(pid=9001, role=constants.ROLE_A, rig_started=True),
        teardown.ProcessRecord(pid=9002, role=constants.ROLE_B, rig_started=False),
        teardown.ProcessRecord(pid=9003, role=constants.ROLE_B, rig_started=True),
    ]
    io, _, outcome = _drive(ledger, allowed={9001, 9003})

    assert io.violations == []
    assert io.terminated == [9001, 9003]
    assert outcome.teardown_result.ok is True


def test_empty_ledger_runs_the_step_and_terminates_nothing() -> None:
    io, steps, outcome = _drive([], allowed=set())

    assert io.terminated == []
    assert steps[-1] == "stop_rig_started_processes"
    assert outcome.green is True
