"""WP48 · TP03 (blind 1) — two steps raising at once; both must surface and the
third must still run.

Angle: multi-failure, and a per-artefact failure inside a step (one of three
scratch artefacts fails) must not abort the rest of that same step.

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


class SelectiveIO:
    """Fails on specific targets, succeeds on the others."""

    def __init__(self, bad_settings=(), bad_scratch=(), bad_pids=()) -> None:
        self.bad_settings = set(bad_settings)
        self.bad_scratch = set(bad_scratch)
        self.bad_pids = set(bad_pids)
        self.ok_settings: list[str] = []
        self.ok_scratch: list[str] = []
        self.ok_pids: list[int] = []

    def restore_setting(self, record) -> None:
        role = record["role"]
        if role in self.bad_settings:
            raise OSError(f"restore failed for role {role}")
        self.ok_settings.append(role)

    def remove_scratch(self, path) -> None:
        if path in self.bad_scratch:
            raise OSError("locked")
        self.ok_scratch.append(path)

    def terminate_process(self, pid) -> None:
        if pid in self.bad_pids:
            raise OSError("gone")
        self.ok_pids.append(pid)


def _runner(steps, io):
    return teardown.TeardownRunner(
        provisioned_settings=[{"role": constants.ROLE_A}, {"role": constants.ROLE_B}],
        scratch_artefacts=["one.canvas", "two.canvas", "three.canvas"],
        processes=[
            teardown.ProcessRecord(pid=101, role=constants.ROLE_A, rig_started=True),
            teardown.ProcessRecord(pid=102, role=constants.ROLE_B, rig_started=True),
        ],
        io=io,
        recorder=steps.append,
    )


def test_two_failing_steps_both_surface_and_the_third_still_runs() -> None:
    steps: list[str] = []
    io = SelectiveIO(bad_settings={constants.ROLE_A}, bad_scratch={"one.canvas"})

    outcome = teardown.run_with_teardown(lambda: None, _runner(steps, io))
    result = outcome.teardown_result

    assert steps == list(STEPS)
    assert result.ok is False
    assert set(result.failures) == {STEPS[0], STEPS[1]}
    assert io.ok_pids == [101, 102]
    assert outcome.green is False


def test_one_bad_artefact_does_not_abort_the_rest_of_its_own_step() -> None:
    steps: list[str] = []
    io = SelectiveIO(bad_scratch={"two.canvas"})

    outcome = teardown.run_with_teardown(lambda: None, _runner(steps, io))

    assert io.ok_scratch == ["one.canvas", "three.canvas"]
    assert io.ok_settings == [constants.ROLE_A, constants.ROLE_B]
    assert io.ok_pids == [101, 102]
    assert STEPS[1] in outcome.teardown_result.failures


def test_all_three_steps_failing_still_yields_a_full_ordered_step_record() -> None:
    steps: list[str] = []
    io = SelectiveIO(
        bad_settings={constants.ROLE_A, constants.ROLE_B},
        bad_scratch={"one.canvas", "two.canvas", "three.canvas"},
        bad_pids={101, 102},
    )

    outcome = teardown.run_with_teardown(lambda: None, _runner(steps, io))

    assert steps == list(STEPS)
    assert set(outcome.teardown_result.failures) == set(STEPS)
    assert outcome.teardown_result.ok is False
    assert outcome.exit_status != 0
