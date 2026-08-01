"""WP48 · TP07 (blind 2) — the run record of a lost-endpoint run can never be
serialised as a green gate result.

Angle: the verdict is read from the serialised run record (what WP50 would write
into the gate ledger) rather than from the live outcome object, and the exit
status is asserted as an explicit integer. Adds a teardown that itself fails on
top of the lost endpoint — the record must stay red for both reasons.

DATA SAFETY: injected probes and fakes only.
"""
from __future__ import annotations

import json
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


class IO:
    def __init__(self, fail_remove: bool = False) -> None:
        self.fail_remove = fail_remove
        self.terminated: list[int] = []
        self.steps_done: list[str] = []

    def restore_setting(self, record) -> None:
        self.steps_done.append("restore")

    def remove_scratch(self, path) -> None:
        self.steps_done.append("remove")
        if self.fail_remove:
            raise OSError("scratch canvas still open in the editor")

    def terminate_process(self, pid: int) -> None:
        self.steps_done.append("terminate")
        self.terminated.append(pid)


def _runner(io, steps):
    return teardown.TeardownRunner(
        provisioned_settings=[{"role": constants.ROLE_B}],
        scratch_artefacts=["late" + constants.SCRATCH_EXT],
        processes=[
            teardown.ProcessRecord(pid=1200, role=constants.ROLE_B, rig_started=True),
            teardown.ProcessRecord(pid=1201, role=constants.ROLE_A, rig_started=False),
        ],
        io=io,
        recorder=steps.append,
    )


def _lost_body():
    def body():
        teardown.check_endpoints_alive(
            lambda role: role != constants.ROLE_B, (constants.ROLE_A, constants.ROLE_B)
        )

    return body


def test_serialised_run_record_is_red_and_carries_the_named_reason() -> None:
    io = IO()
    steps: list[str] = []

    outcome = teardown.run_with_teardown(_lost_body(), _runner(io, steps))
    record = outcome.to_dict()

    assert record["green"] is False
    assert record["failure_reason"] == constants.ENDPOINT_LOST_MIDRUN
    assert isinstance(record["exit_status"], int)
    assert record["exit_status"] != 0
    assert record["teardown"]["steps_run"] == list(teardown.TEARDOWN_STEP_ORDER)
    assert constants.ENDPOINT_LOST_MIDRUN in json.dumps(record)


def test_lost_endpoint_plus_failing_teardown_stays_red_on_both_counts() -> None:
    io = IO(fail_remove=True)
    steps: list[str] = []

    outcome = teardown.run_with_teardown(_lost_body(), _runner(io, steps))

    assert outcome.failure_reason == constants.ENDPOINT_LOST_MIDRUN
    assert outcome.teardown_result.ok is False
    assert "remove_scratch_artefacts" in outcome.teardown_result.failures
    assert io.steps_done == ["restore", "remove", "terminate"]
    assert io.terminated == [1200]
    assert outcome.exit_status != 0
    assert outcome.green is False


def test_exit_status_of_a_clean_run_is_zero_so_non_zero_actually_discriminates() -> None:
    io = IO()
    steps: list[str] = []

    outcome = teardown.run_with_teardown(lambda: "ok", _runner(io, steps))

    assert outcome.exit_status == 0
    assert outcome.green is True
    assert outcome.failure_reason is None
    assert io.terminated == [1200]
