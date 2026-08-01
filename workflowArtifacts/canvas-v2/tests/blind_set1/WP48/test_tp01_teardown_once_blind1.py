"""WP48 · TP01 (blind 1) — teardown execution count across exit paths.

Angle: instead of parameterising, all exit paths are driven inside one test and
their execution counters compared against each other; adds SystemExit and a
body that fails *after* partial success.

DATA SAFETY: pure in-memory fakes only.
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


class CountingIO:
    def __init__(self) -> None:
        self.counts = {"restore": 0, "remove": 0, "terminate": 0}
        self.terminated: list[int] = []

    def restore_setting(self, record: object) -> None:
        self.counts["restore"] += 1

    def remove_scratch(self, path: object) -> None:
        self.counts["remove"] += 1

    def terminate_process(self, pid: int) -> None:
        self.counts["terminate"] += 1
        self.terminated.append(pid)


def _fresh():
    steps: list[str] = []
    io = CountingIO()
    runner = teardown.TeardownRunner(
        provisioned_settings=[
            {"role": constants.ROLE_A, "backup": constants.SETTINGS_BACKUP_REL},
            {"role": constants.ROLE_B, "backup": constants.SETTINGS_BACKUP_REL},
        ],
        scratch_artefacts=[
            f"{constants.SCRATCH_FOLDER}/{constants.SCRATCH_PREFIX}run-a{constants.SCRATCH_EXT}",
            f"{constants.SCRATCH_FOLDER}/{constants.SCRATCH_PREFIX}run-b{constants.SCRATCH_EXT}",
        ],
        processes=[
            teardown.ProcessRecord(pid=7001, role=constants.ROLE_A, rig_started=True),
            teardown.ProcessRecord(pid=7002, role=constants.ROLE_B, rig_started=True),
        ],
        io=io,
        recorder=steps.append,
    )
    return steps, io, runner


def _raiser(exc: BaseException):
    def _body():
        raise exc

    return _body


def test_every_exit_path_yields_exactly_one_execution() -> None:
    bodies = {
        "clean_return": lambda: {"cases": 6, "failed": 0},
        "assertion": _raiser(AssertionError("file bytes diverged")),
        "runtime_error": _raiser(RuntimeError("obsidian window vanished")),
        "interrupt": _raiser(KeyboardInterrupt()),
        "system_exit": _raiser(SystemExit(3)),
    }

    executions = {}
    step_logs = {}
    for name, body in bodies.items():
        steps, io, runner = _fresh()
        teardown.run_with_teardown(body, runner)
        executions[name] = runner.executions
        step_logs[name] = list(steps)
        assert io.counts["restore"] == 2, name
        assert io.counts["remove"] == 2, name
        assert io.counts["terminate"] == 2, name

    assert set(executions.values()) == {1}, executions
    assert all(len(log) == 3 for log in step_logs.values()), step_logs


def test_partial_success_then_crash_still_tears_down_once() -> None:
    steps, io, runner = _fresh()
    progress: list[str] = []

    def body():
        progress.append("scratch created")
        progress.append("edit applied")
        raise RuntimeError("endpoint b stopped answering")

    outcome = teardown.run_with_teardown(body, runner)

    assert progress == ["scratch created", "edit applied"]
    assert runner.executions == 1
    assert steps == list(teardown.TEARDOWN_STEP_ORDER)
    assert outcome.green is False


def test_nested_driver_invocations_do_not_stack_teardowns() -> None:
    steps, io, runner = _fresh()

    def inner():
        return "inner done"

    def outer():
        teardown.run_with_teardown(inner, runner)
        raise KeyboardInterrupt()

    teardown.run_with_teardown(outer, runner)

    assert runner.executions == 1
    assert steps == list(teardown.TEARDOWN_STEP_ORDER)
    assert io.terminated == [7001, 7002]
