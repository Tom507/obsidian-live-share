"""WP48 · TP07 (visible) — THE FALSE-PASS GUARD FOR PHASE T3.

Verifies AC3 in one scenario: an endpoint that stops answering mid-run must
(1) fail the run under ENDPOINT_LOST_MIDRUN, (2) still complete teardown, and
(3) produce a NON-ZERO exit status. All three are asserted together, because a
partially executed run reported as green is exactly the defect the Teil-14 gate
exists to prevent.

DATA SAFETY: the endpoint is an injected probe function; no socket is opened, no
vault touched, no process signalled.
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


class TeardownSpy:
    def __init__(self) -> None:
        self.restored: list[object] = []
        self.removed: list[object] = []
        self.terminated: list[int] = []

    def restore_setting(self, record) -> None:
        self.restored.append(record)

    def remove_scratch(self, path) -> None:
        self.removed.append(path)

    def terminate_process(self, pid: int) -> None:
        self.terminated.append(pid)


class FlakyEndpoints:
    """Role b answers twice, then stops answering — the crash mid-run."""

    def __init__(self) -> None:
        self.probes: list[str] = []
        self.b_answers = 2

    def __call__(self, role: str) -> bool:
        self.probes.append(role)
        if role == constants.ROLE_B:
            if self.b_answers <= 0:
                return False
            self.b_answers -= 1
        return True


def test_endpoint_lost_midrun_fails_the_run_tears_down_and_exits_non_zero() -> None:
    steps: list[str] = []
    io = TeardownSpy()
    endpoints = FlakyEndpoints()
    completed_work: list[str] = []

    runner = teardown.TeardownRunner(
        provisioned_settings=[
            {"role": constants.ROLE_A, "backup": constants.SETTINGS_BACKUP_REL},
            {"role": constants.ROLE_B, "backup": constants.SETTINGS_BACKUP_REL},
        ],
        scratch_artefacts=[
            f"{constants.SCRATCH_FOLDER}/{constants.SCRATCH_PREFIX}mid{constants.SCRATCH_EXT}"
        ],
        processes=[
            teardown.ProcessRecord(pid=4242, role=constants.ROLE_A, rig_started=True),
            teardown.ProcessRecord(pid=9999, role=constants.ROLE_B, rig_started=False),
        ],
        io=io,
        recorder=steps.append,
    )

    def body():
        # Two matrix cases pass before the window disappears. This is what makes
        # the run "partially executed" rather than simply failed.
        for case in ("initial-sync", "multi-edge-move"):
            teardown.check_endpoints_alive(endpoints, constants.ROLES)
            completed_work.append(case)
        teardown.check_endpoints_alive(endpoints, constants.ROLES)
        completed_work.append("bidirectional-drag")

    outcome = teardown.run_with_teardown(body, runner)

    # the run really was partial
    assert completed_work == ["initial-sync", "multi-edge-move"]

    # (1) named reason
    assert outcome.failure_reason == constants.ENDPOINT_LOST_MIDRUN
    assert isinstance(outcome.error, teardown.EndpointLostMidrun)
    assert outcome.error.role == constants.ROLE_B
    assert outcome.error.reason == constants.ENDPOINT_LOST_MIDRUN
    assert outcome.error.to_dict()["reason"] == constants.ENDPOINT_LOST_MIDRUN

    # (2) teardown still completed, fully and in order
    assert steps == list(teardown.TEARDOWN_STEP_ORDER)
    assert outcome.teardown_result.steps_run == list(teardown.TEARDOWN_STEP_ORDER)
    assert outcome.teardown_result.ok is True
    assert len(io.restored) == 2
    assert len(io.removed) == 1
    # D15 still holds while failing: the owner's attached window is untouched
    assert io.terminated == [4242]

    # (3) non-zero exit status, explicitly
    assert outcome.exit_status != 0
    assert isinstance(outcome.exit_status, int)
    assert outcome.green is False


def test_check_endpoints_alive_raises_on_the_first_silent_role() -> None:
    def probe(role: str) -> bool:
        return role != constants.ROLE_A

    try:
        teardown.check_endpoints_alive(probe, constants.ROLES)
    except teardown.EndpointLostMidrun as exc:
        assert exc.role == constants.ROLE_A
        assert exc.reason == constants.ENDPOINT_LOST_MIDRUN
    else:
        raise AssertionError("a silent endpoint did not raise EndpointLostMidrun")


def test_a_fully_answering_pair_is_not_a_failure() -> None:
    outcome = teardown.run_with_teardown(
        lambda: teardown.check_endpoints_alive(lambda role: True, constants.ROLES),
        teardown.TeardownRunner(
            provisioned_settings=[],
            scratch_artefacts=[],
            processes=[],
            io=TeardownSpy(),
            recorder=lambda step: None,
        ),
    )

    assert outcome.failure_reason is None
    assert outcome.exit_status == 0
    assert outcome.green is True
