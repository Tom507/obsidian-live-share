"""WP48 · TP01 (visible) — teardown runs EXACTLY ONCE on every exit path.

Verifies AC1 (the "exactly once" half).

DATA SAFETY: no vault, no filesystem, no process. Every boundary is an injected
fake; `io.terminate_process` only appends to a list.
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


class RecordingIO:
    """Injected teardown IO — records primitive calls, touches nothing real."""

    def __init__(self) -> None:
        self.restored: list[object] = []
        self.removed: list[object] = []
        self.terminated: list[int] = []

    def restore_setting(self, record: object) -> None:
        self.restored.append(record)

    def remove_scratch(self, path: object) -> None:
        self.removed.append(path)

    def terminate_process(self, pid: int) -> None:
        self.terminated.append(pid)


def _make_runner(steps: list[str], io: RecordingIO) -> object:
    scratch = (
        f"{constants.SCRATCH_FOLDER}/"
        f"{constants.SCRATCH_PREFIX}20260801T101010Z-111-aaa{constants.SCRATCH_EXT}"
    )
    return teardown.TeardownRunner(
        provisioned_settings=[{"role": constants.ROLE_A, "backup": constants.SETTINGS_BACKUP_REL}],
        scratch_artefacts=[scratch],
        processes=[teardown.ProcessRecord(pid=4242, role=constants.ROLE_A, rig_started=True)],
        io=io,
        recorder=steps.append,
    )


def _boom(exc: BaseException):
    def _body():
        raise exc

    return _body


EXIT_PATHS = {
    "success": lambda: "gate green",
    "assertion_failure": _boom(AssertionError("converged doc but diverged file")),
    "raised_exception": _boom(RuntimeError("control endpoint returned 500")),
    "keyboard_interrupt": _boom(KeyboardInterrupt()),
}


@pytest.mark.parametrize("path_name", sorted(EXIT_PATHS))
def test_teardown_executes_exactly_once_on_each_exit_path(path_name: str) -> None:
    steps: list[str] = []
    io = RecordingIO()
    runner = _make_runner(steps, io)

    outcome = teardown.run_with_teardown(EXIT_PATHS[path_name], runner)

    # A counter, not a boolean: a second execution must break this.
    assert runner.executions == 1, f"{path_name}: teardown executed {runner.executions}x"
    assert len(steps) == len(teardown.TEARDOWN_STEP_ORDER)
    for step in teardown.TEARDOWN_STEP_ORDER:
        assert steps.count(step) == 1, f"{path_name}: step {step!r} ran {steps.count(step)}x"
    assert outcome.teardown_result.steps_run == list(teardown.TEARDOWN_STEP_ORDER)
    # Each primitive ran once, so no step was executed twice underneath the recorder.
    assert len(io.restored) == 1
    assert len(io.removed) == 1
    assert io.terminated == [4242]


def test_body_that_already_ran_teardown_does_not_cause_a_second_execution() -> None:
    """The driver must not double-teardown a body that tore itself down."""
    steps: list[str] = []
    io = RecordingIO()
    runner = _make_runner(steps, io)

    def body():
        runner.run()
        raise RuntimeError("crashed after its own teardown")

    outcome = teardown.run_with_teardown(body, runner)

    assert runner.executions == 1
    assert steps == list(teardown.TEARDOWN_STEP_ORDER)
    assert io.terminated == [4242]
    assert outcome.exit_status != 0


def test_explicit_repeated_run_calls_execute_the_steps_only_once() -> None:
    steps: list[str] = []
    io = RecordingIO()
    runner = _make_runner(steps, io)

    first = runner.run()
    second = runner.run()
    third = runner.run()

    assert runner.executions == 1
    assert steps == list(teardown.TEARDOWN_STEP_ORDER)
    assert second is first and third is first
    assert io.terminated == [4242]
