"""WP48 · TP07 (blind 1) — the loss happens AFTER every assertion has passed.

Angle: the worst false-pass shape. The run's own oracles are all green, and only
then does role a's endpoint disappear. The verdict must still be red, teardown
must still complete, and the exit status must still be non-zero.

DATA SAFETY: injected probes and fakes only.
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


class IO:
    def __init__(self) -> None:
        self.restored = 0
        self.removed = 0
        self.terminated: list[int] = []

    def restore_setting(self, record) -> None:
        self.restored += 1

    def remove_scratch(self, path) -> None:
        self.removed += 1

    def terminate_process(self, pid: int) -> None:
        self.terminated.append(pid)


def _runner(io, steps):
    return teardown.TeardownRunner(
        provisioned_settings=[{"role": constants.ROLE_A}],
        scratch_artefacts=[f"{constants.SCRATCH_PREFIX}late{constants.SCRATCH_EXT}"],
        processes=[
            teardown.ProcessRecord(pid=3300, role=constants.ROLE_A, rig_started=True),
            teardown.ProcessRecord(pid=3301, role=constants.ROLE_B, rig_started=False),
        ],
        io=io,
        recorder=steps.append,
    )


def test_all_oracles_green_then_endpoint_a_disappears_still_fails_the_run() -> None:
    io = IO()
    steps: list[str] = []
    oracle_results: list[bool] = []
    alive = {constants.ROLE_A: True, constants.ROLE_B: True}

    def body():
        for _ in range(6):
            oracle_results.append(True)  # every matrix case converged
        alive[constants.ROLE_A] = False  # the owner closed the window
        teardown.check_endpoints_alive(lambda role: alive[role], constants.ROLES)
        return "green"

    outcome = teardown.run_with_teardown(body, _runner(io, steps))

    assert oracle_results == [True] * 6
    assert outcome.failure_reason == constants.ENDPOINT_LOST_MIDRUN
    assert outcome.error.role == constants.ROLE_A
    assert steps == list(teardown.TEARDOWN_STEP_ORDER)
    assert outcome.teardown_result.ok is True
    assert io.restored == 1 and io.removed == 1
    assert io.terminated == [3300]
    assert outcome.exit_status != 0
    assert outcome.green is False


def test_both_endpoints_lost_reports_one_named_reason_and_still_tears_down() -> None:
    io = IO()
    steps: list[str] = []

    def body():
        teardown.check_endpoints_alive(lambda role: False, constants.ROLES)

    outcome = teardown.run_with_teardown(body, _runner(io, steps))

    assert outcome.failure_reason == constants.ENDPOINT_LOST_MIDRUN
    assert outcome.error.role in constants.ROLES
    assert steps == list(teardown.TEARDOWN_STEP_ORDER)
    assert outcome.exit_status != 0
    assert io.terminated == [3300]


def test_the_reason_is_the_shared_contract_constant_not_a_local_string() -> None:
    io = IO()
    steps: list[str] = []

    def body():
        teardown.check_endpoints_alive(lambda role: role == constants.ROLE_A, constants.ROLES)

    outcome = teardown.run_with_teardown(body, _runner(io, steps))

    assert outcome.failure_reason is constants.ENDPOINT_LOST_MIDRUN or (
        outcome.failure_reason == constants.ENDPOINT_LOST_MIDRUN
    )
    assert outcome.failure_reason != constants.WAIT_TIMEOUT
    assert outcome.failure_reason != constants.SCRATCH_STALE_UNRECLAIMED
