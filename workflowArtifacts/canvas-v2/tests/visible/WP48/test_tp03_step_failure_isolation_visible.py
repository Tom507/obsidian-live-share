"""WP48 · TP03 (visible) — a teardown step that raises must not stop the
remaining steps, and must still surface.

Verifies AC1. A swallowed teardown error is the exact shape of the false-pass
this phase exists to prevent: the vault would be left dirty and the run green.

DATA SAFETY: in-memory fakes only; no vault, no process.
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

from obsidian_e2e import constants, teardown  # noqa: E402

STEP_RESTORE = "restore_provisioned_settings"
STEP_SCRATCH = "remove_scratch_artefacts"
STEP_PROCESSES = "stop_rig_started_processes"


class FailingIO:
    def __init__(self, fail: dict[str, BaseException]) -> None:
        self.fail = fail
        self.done: list[str] = []

    def restore_setting(self, record: object) -> None:
        if "restore" in self.fail:
            raise self.fail["restore"]
        self.done.append("restore")

    def remove_scratch(self, path: object) -> None:
        if "remove" in self.fail:
            raise self.fail["remove"]
        self.done.append("remove")

    def terminate_process(self, pid: int) -> None:
        if "terminate" in self.fail:
            raise self.fail["terminate"]
        self.done.append(f"terminate:{pid}")


def _runner(steps, io):
    return teardown.TeardownRunner(
        provisioned_settings=[{"role": constants.ROLE_A}],
        scratch_artefacts=["s" + constants.SCRATCH_EXT],
        processes=[teardown.ProcessRecord(pid=2020, role=constants.ROLE_A, rig_started=True)],
        io=io,
        recorder=steps.append,
    )


def test_first_step_failure_does_not_prevent_the_remaining_two() -> None:
    boom = OSError("saved original is unreadable")
    steps: list[str] = []
    io = FailingIO({"restore": boom})

    outcome = teardown.run_with_teardown(lambda: "run passed", _runner(steps, io))
    result = outcome.teardown_result

    # every step still attempted, in order
    assert steps == [STEP_RESTORE, STEP_SCRATCH, STEP_PROCESSES]
    assert result.steps_run == [STEP_RESTORE, STEP_SCRATCH, STEP_PROCESSES]
    # the later steps really did their work
    assert io.done == ["remove", "terminate:2020"]
    # and the failure surfaced rather than being swallowed
    assert result.ok is False
    assert STEP_RESTORE in result.failures
    assert result.failures[STEP_RESTORE] is boom
    assert outcome.exit_status != 0
    assert outcome.green is False


def test_a_failing_teardown_step_makes_an_otherwise_successful_run_non_green() -> None:
    steps: list[str] = []
    io = FailingIO({"terminate": OSError("process handle already closed")})

    outcome = teardown.run_with_teardown(lambda: "all matrix cases passed", _runner(steps, io))

    assert steps == [STEP_RESTORE, STEP_SCRATCH, STEP_PROCESSES]
    assert outcome.teardown_result.ok is False
    assert STEP_PROCESSES in outcome.teardown_result.failures
    assert outcome.green is False
    assert outcome.exit_status != 0


def test_failure_is_reported_in_the_serialised_teardown_record() -> None:
    steps: list[str] = []
    io = FailingIO({"remove": PermissionError("scratch canvas is open")})

    outcome = teardown.run_with_teardown(lambda: None, _runner(steps, io))
    record = outcome.teardown_result.to_dict()

    assert record["steps_run"] == [STEP_RESTORE, STEP_SCRATCH, STEP_PROCESSES]
    assert record["ok"] is False
    assert STEP_SCRATCH in record["failures"]
