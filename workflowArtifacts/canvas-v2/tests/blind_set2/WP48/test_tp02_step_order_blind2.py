"""WP48 · TP02 (blind 2) — the ordering contract read off a single interleaved
call log.

Angle: one shared log receives BOTH the step markers and the primitive calls, so
the assertion is on the interleaving (settings fully restored before the first
scratch removal, all scratch gone before the first terminate) rather than on two
separate lists. Catches a "parallel" or reordered implementation.

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

STEP_RESTORE = "restore_provisioned_settings"
STEP_SCRATCH = "remove_scratch_artefacts"
STEP_PROCESSES = "stop_rig_started_processes"


class SharedLogIO:
    def __init__(self, log: list[str]) -> None:
        self.log = log

    def restore_setting(self, record: object) -> None:
        self.log.append(f"io:restore:{record['role']}")

    def remove_scratch(self, path: object) -> None:
        self.log.append(f"io:remove:{path}")

    def terminate_process(self, pid: int) -> None:
        self.log.append(f"io:terminate:{pid}")


def _drive(body):
    log: list[str] = []
    io = SharedLogIO(log)
    runner = teardown.TeardownRunner(
        provisioned_settings=[{"role": constants.ROLE_A}, {"role": constants.ROLE_B}],
        scratch_artefacts=["scratch-a" + constants.SCRATCH_EXT, "scratch-b" + constants.SCRATCH_EXT],
        processes=[
            teardown.ProcessRecord(pid=6001, role=constants.ROLE_A, rig_started=True),
            teardown.ProcessRecord(pid=6002, role=constants.ROLE_B, rig_started=True),
        ],
        io=io,
        recorder=lambda step: log.append(f"step:{step}"),
    )
    outcome = teardown.run_with_teardown(body, runner)
    return log, outcome


def _raise(exc: BaseException):
    def _body():
        raise exc

    return _body


def test_step_names_are_exactly_the_three_ac1_steps_in_order() -> None:
    assert list(teardown.TEARDOWN_STEP_ORDER) == [STEP_RESTORE, STEP_SCRATCH, STEP_PROCESSES]


def test_interleaving_shows_full_step_completion_before_the_next_step_starts() -> None:
    for name, body in (
        ("success", lambda: 1),
        ("assertion", _raise(AssertionError("q"))),
        ("exception", _raise(OSError("r"))),
        ("interrupt", _raise(KeyboardInterrupt())),
    ):
        log, _ = _drive(body)
        assert log == [
            f"step:{STEP_RESTORE}",
            f"io:restore:{constants.ROLE_A}",
            f"io:restore:{constants.ROLE_B}",
            f"step:{STEP_SCRATCH}",
            f"io:remove:scratch-a{constants.SCRATCH_EXT}",
            f"io:remove:scratch-b{constants.SCRATCH_EXT}",
            f"step:{STEP_PROCESSES}",
            "io:terminate:6001",
            "io:terminate:6002",
        ], name


def test_no_terminate_happens_before_the_last_scratch_removal() -> None:
    log, _ = _drive(_raise(KeyboardInterrupt()))
    last_remove = max(i for i, e in enumerate(log) if e.startswith("io:remove:"))
    first_terminate = min(i for i, e in enumerate(log) if e.startswith("io:terminate:"))
    first_restore = min(i for i, e in enumerate(log) if e.startswith("io:restore:"))
    last_restore = max(i for i, e in enumerate(log) if e.startswith("io:restore:"))
    first_remove = min(i for i, e in enumerate(log) if e.startswith("io:remove:"))

    assert first_restore < last_restore < first_remove < last_remove < first_terminate
