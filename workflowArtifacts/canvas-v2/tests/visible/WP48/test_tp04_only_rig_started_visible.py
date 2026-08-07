"""WP48 · TP04 (visible) — teardown stops ONLY rig-started processes (D15).

Verifies AC1 (third step) under decision D15, "attach, never kill". The owner's
own Obsidian window is an attached process; teardown must issue ZERO terminate
calls against it.

DATA SAFETY: no real process is ever inspected or signalled — `terminate_process`
is a list append on a fake.
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

STEP_PROCESSES = "stop_rig_started_processes"


class ProcessSpy:
    def __init__(self) -> None:
        self.terminated: list[int] = []

    def restore_setting(self, record) -> None:  # noqa: D401 - not under test here
        pass

    def remove_scratch(self, path) -> None:
        pass

    def terminate_process(self, pid: int) -> None:
        self.terminated.append(pid)


def _runner(processes, steps, io):
    return teardown.TeardownRunner(
        provisioned_settings=[],
        scratch_artefacts=[],
        processes=list(processes),
        io=io,
        recorder=steps.append,
    )


def test_attached_process_receives_zero_terminate_calls() -> None:
    rig_started = teardown.ProcessRecord(pid=4242, role=constants.ROLE_A, rig_started=True)
    attached = teardown.ProcessRecord(pid=9999, role=constants.ROLE_B, rig_started=False)
    steps: list[str] = []
    io = ProcessSpy()

    teardown.run_with_teardown(lambda: None, _runner([rig_started, attached], steps, io))

    assert io.terminated == [4242]
    assert io.terminated.count(9999) == 0
    assert 9999 not in io.terminated
    assert STEP_PROCESSES in steps


def test_a_run_that_attached_to_both_windows_terminates_nothing() -> None:
    attached = [
        teardown.ProcessRecord(pid=1111, role=constants.ROLE_A, rig_started=False),
        teardown.ProcessRecord(pid=2222, role=constants.ROLE_B, rig_started=False),
    ]
    steps: list[str] = []
    io = ProcessSpy()

    outcome = teardown.run_with_teardown(lambda: None, _runner(attached, steps, io))

    assert io.terminated == []
    # "nothing to stop" is still a step that ran, not a skipped step
    assert steps == list(teardown.TEARDOWN_STEP_ORDER)
    assert outcome.teardown_result.ok is True


def test_d15_holds_on_the_failure_path_too() -> None:
    procs = [
        teardown.ProcessRecord(pid=4242, role=constants.ROLE_A, rig_started=True),
        teardown.ProcessRecord(pid=9999, role=constants.ROLE_B, rig_started=False),
    ]
    steps: list[str] = []
    io = ProcessSpy()

    def body():
        raise KeyboardInterrupt()

    outcome = teardown.run_with_teardown(body, _runner(procs, steps, io))

    assert io.terminated == [4242]
    assert outcome.green is False
