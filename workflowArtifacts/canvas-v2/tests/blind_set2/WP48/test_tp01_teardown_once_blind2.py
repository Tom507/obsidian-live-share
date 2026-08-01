"""WP48 · TP01 (blind 2) — "exactly once" holds even when work is empty or a
step raises.

Angle: the counter is read from the primitive call log rather than the step
recorder, so an implementation that records a step name once but executes the
underlying work twice is still caught. Edge case: nothing to tear down.

DATA SAFETY: no vault, no process, no disk.
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


class LoggingIO:
    def __init__(self, fail: dict[str, BaseException] | None = None) -> None:
        self.log: list[str] = []
        self._fail = fail or {}

    def restore_setting(self, record: object) -> None:
        self.log.append(f"restore:{record}")
        if "restore" in self._fail:
            raise self._fail["restore"]

    def remove_scratch(self, path: object) -> None:
        self.log.append(f"remove:{path}")
        if "remove" in self._fail:
            raise self._fail["remove"]

    def terminate_process(self, pid: int) -> None:
        self.log.append(f"terminate:{pid}")
        if "terminate" in self._fail:
            raise self._fail["terminate"]


def _runner(io, steps, *, settings=None, scratch=None, processes=None):
    return teardown.TeardownRunner(
        provisioned_settings=list(settings or []),
        scratch_artefacts=list(scratch or []),
        processes=list(processes or []),
        io=io,
        recorder=steps.append,
    )


def test_empty_run_state_still_executes_the_step_sequence_once() -> None:
    """Nothing acquired is not the same as nothing to do — the steps still run."""
    steps: list[str] = []
    io = LoggingIO()
    runner = _runner(io, steps)

    teardown.run_with_teardown(lambda: None, runner)

    assert runner.executions == 1
    assert steps == list(teardown.TEARDOWN_STEP_ORDER)
    assert io.log == []


def test_counter_stays_one_when_a_step_raises_on_the_interrupt_path() -> None:
    steps: list[str] = []
    io = LoggingIO(fail={"remove": OSError("scratch file is locked")})
    runner = _runner(
        io,
        steps,
        settings=[{"role": constants.ROLE_B}],
        scratch=[f"{constants.SCRATCH_FOLDER}/{constants.SCRATCH_PREFIX}z{constants.SCRATCH_EXT}"],
        processes=[teardown.ProcessRecord(pid=9100, role=constants.ROLE_B, rig_started=True)],
    )

    def body():
        raise KeyboardInterrupt()

    outcome = teardown.run_with_teardown(body, runner)

    assert runner.executions == 1
    assert io.log.count("terminate:9100") == 1
    assert len([entry for entry in io.log if entry.startswith("restore:")]) == 1
    assert outcome.green is False


def test_primitive_call_log_has_no_duplicates_across_four_exit_paths() -> None:
    bodies = [
        ("success", lambda: 0),
        ("assertion", _raise(AssertionError("x"))),
        ("exception", _raise(ValueError("y"))),
        ("interrupt", _raise(KeyboardInterrupt())),
    ]
    for name, body in bodies:
        steps: list[str] = []
        io = LoggingIO()
        runner = _runner(
            io,
            steps,
            settings=[{"role": constants.ROLE_A}],
            scratch=["one" + constants.SCRATCH_EXT],
            processes=[teardown.ProcessRecord(pid=555, role=constants.ROLE_A, rig_started=True)],
        )
        teardown.run_with_teardown(body, runner)
        assert len(io.log) == 3, f"{name}: {io.log}"
        assert len(set(io.log)) == 3, f"{name}: duplicate primitive call {io.log}"
        assert runner.executions == 1, name


def _raise(exc: BaseException):
    def _body():
        raise exc

    return _body
