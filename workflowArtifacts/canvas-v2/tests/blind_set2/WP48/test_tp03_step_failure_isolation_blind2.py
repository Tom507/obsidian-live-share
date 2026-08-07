"""WP48 · TP03 (blind 2) — a teardown failure on the interrupt path must not be
lost behind the interrupt.

Angle: the body already failed, so the run is doomed anyway; the risk is that a
teardown failure gets merged into the body's error and disappears. Both must be
retrievable, and a BaseException raised by a step (not just Exception) must be
caught too.

DATA SAFETY: in-memory fakes only.
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

STEPS = (
    "restore_provisioned_settings",
    "remove_scratch_artefacts",
    "stop_rig_started_processes",
)


class ScriptedIO:
    def __init__(self, raise_on_restore=None, raise_on_terminate=None) -> None:
        self._restore_exc = raise_on_restore
        self._terminate_exc = raise_on_terminate
        self.reached: list[str] = []

    def restore_setting(self, record) -> None:
        self.reached.append("restore")
        if self._restore_exc is not None:
            raise self._restore_exc

    def remove_scratch(self, path) -> None:
        self.reached.append("remove")

    def terminate_process(self, pid) -> None:
        self.reached.append("terminate")
        if self._terminate_exc is not None:
            raise self._terminate_exc


def _runner(steps, io):
    return teardown.TeardownRunner(
        provisioned_settings=[{"role": constants.ROLE_B}],
        scratch_artefacts=[f"{constants.SCRATCH_FOLDER}/x{constants.SCRATCH_EXT}"],
        processes=[teardown.ProcessRecord(pid=4040, role=constants.ROLE_B, rig_started=True)],
        io=io,
        recorder=steps.append,
    )


def test_body_error_and_teardown_error_are_both_retrievable() -> None:
    body_error = RuntimeError("assertion oracle exploded")
    step_error = OSError("could not put the settings file back")
    steps: list[str] = []
    io = ScriptedIO(raise_on_restore=step_error)

    def body():
        raise body_error

    outcome = teardown.run_with_teardown(body, _runner(steps, io))

    assert outcome.error is body_error
    assert outcome.teardown_result.failures[STEPS[0]] is step_error
    assert io.reached == ["restore", "remove", "terminate"]
    assert outcome.green is False


def test_step_raising_a_base_exception_is_still_contained() -> None:
    steps: list[str] = []
    io = ScriptedIO(raise_on_terminate=KeyboardInterrupt())

    outcome = teardown.run_with_teardown(lambda: None, _runner(steps, io))

    assert steps == list(STEPS)
    assert STEPS[2] in outcome.teardown_result.failures
    assert isinstance(outcome.teardown_result.failures[STEPS[2]], KeyboardInterrupt)
    assert outcome.green is False


def test_clean_teardown_on_a_successful_run_is_ok_and_green() -> None:
    steps: list[str] = []
    io = ScriptedIO()

    outcome = teardown.run_with_teardown(lambda: "matrix green", _runner(steps, io))

    assert steps == list(STEPS)
    assert outcome.teardown_result.ok is True
    assert outcome.teardown_result.failures == {}
    assert outcome.exit_status == 0
    assert outcome.green is True
