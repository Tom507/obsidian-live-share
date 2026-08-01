"""WP48 · TP02 (blind 1) — step order is invariant to how much work each step has.

Angle: the run state differs per exit path (empty / one artefact / many), and a
step raises in the middle. The recorded order must not move.

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

ORDER = (
    "restore_provisioned_settings",
    "remove_scratch_artefacts",
    "stop_rig_started_processes",
)


class TraceIO:
    def __init__(self, fail_step: str | None = None) -> None:
        self.trace: list[str] = []
        self.fail_step = fail_step

    def restore_setting(self, record: object) -> None:
        self.trace.append("restore")
        if self.fail_step == "restore":
            raise OSError("backup unreadable")

    def remove_scratch(self, path: object) -> None:
        self.trace.append("remove")
        if self.fail_step == "remove":
            raise OSError("scratch busy")

    def terminate_process(self, pid: int) -> None:
        self.trace.append("terminate")
        if self.fail_step == "terminate":
            raise OSError("no such process")


def _runner(steps, io, *, n_settings, n_scratch, n_procs):
    return teardown.TeardownRunner(
        provisioned_settings=[{"i": i} for i in range(n_settings)],
        scratch_artefacts=[
            f"{constants.SCRATCH_FOLDER}/{constants.SCRATCH_PREFIX}{i}{constants.SCRATCH_EXT}"
            for i in range(n_scratch)
        ],
        processes=[
            teardown.ProcessRecord(pid=8000 + i, role=constants.ROLE_A, rig_started=True)
            for i in range(n_procs)
        ],
        io=io,
        recorder=steps.append,
    )


def _raise(exc: BaseException):
    def _body():
        raise exc

    return _body


def test_order_is_stable_across_differently_loaded_run_states() -> None:
    cases = [
        ("empty_success", lambda: None, 0, 0, 0),
        ("one_each_assertion", _raise(AssertionError("a")), 1, 1, 1),
        ("many_exception", _raise(RuntimeError("b")), 3, 4, 2),
        ("many_interrupt", _raise(KeyboardInterrupt()), 2, 2, 3),
    ]
    seen = []
    for name, body, ns, nc, np_ in cases:
        steps: list[str] = []
        io = TraceIO()
        runner = _runner(steps, io, n_settings=ns, n_scratch=nc, n_procs=np_)
        teardown.run_with_teardown(body, runner)
        assert steps == list(ORDER), f"{name}: {steps}"
        # Primitive calls are grouped by step, in step order.
        assert io.trace == ["restore"] * ns + ["remove"] * nc + ["terminate"] * np_, name
        seen.append(tuple(steps))
    assert len(set(seen)) == 1


def test_middle_step_failure_does_not_reorder_the_sequence() -> None:
    steps: list[str] = []
    io = TraceIO(fail_step="remove")
    runner = _runner(steps, io, n_settings=1, n_scratch=1, n_procs=1)

    result = teardown.run_with_teardown(_raise(RuntimeError("boom")), runner).teardown_result

    assert steps == list(ORDER)
    assert result.steps_run == list(ORDER)
    assert io.trace == ["restore", "remove", "terminate"]


def test_first_step_failure_does_not_reorder_the_sequence() -> None:
    steps: list[str] = []
    io = TraceIO(fail_step="restore")
    runner = _runner(steps, io, n_settings=1, n_scratch=2, n_procs=1)

    teardown.run_with_teardown(lambda: None, runner)

    assert steps == list(ORDER)
    assert io.trace[0] == "restore"
    assert io.trace[-1] == "terminate"
