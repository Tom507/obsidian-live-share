"""WP48 · TP05 (blind 2) — condition naming under near-miss timing.

Angle: table-driven over several conditions and budgets, including a predicate
that flips true exactly at the deadline (must NOT time out) and one that flips
one poll too late (must time out and name its condition). Guards against a
timeout payload that reuses a single module-global condition string.

DATA SAFETY: injected clock only.
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


class StepClock:
    def __init__(self) -> None:
        self.t = 500.0

    def now(self) -> float:
        return self.t

    def sleep(self, seconds: float) -> None:
        self.t += seconds


CONDITIONS = [
    ("settings_restored_byte_exact", 4.0, 1.0),
    ("scratch_removed", 1.0, 0.25),
    ("rig_process_exited", 12.0, 3.0),
]


@pytest.mark.parametrize("condition,budget,poll", CONDITIONS)
def test_each_condition_names_itself_in_its_own_timeout(condition, budget, poll) -> None:
    clock = StepClock()

    with pytest.raises(teardown.WaitTimeout) as excinfo:
        teardown.wait_for(
            condition,
            lambda: False,
            timeout_s=budget,
            poll_s=poll,
            clock=clock.now,
            sleep=clock.sleep,
        )

    payload = excinfo.value.to_dict()
    assert payload["condition"] == condition
    assert payload["reason"] == constants.WAIT_TIMEOUT
    assert payload["timeout_s"] == budget
    other_names = [c for c, _, _ in CONDITIONS if c != condition]
    for other in other_names:
        assert other not in str(payload)


def test_predicate_true_just_inside_the_budget_does_not_time_out() -> None:
    clock = StepClock()
    probes = {"n": 0}

    def predicate() -> bool:
        probes["n"] += 1
        return clock.t >= 500.0 + 1.5

    elapsed = teardown.wait_for(
        "endpoint_a_gone",
        predicate,
        timeout_s=2.0,
        poll_s=0.5,
        clock=clock.now,
        sleep=clock.sleep,
    )

    assert elapsed <= 2.0
    assert probes["n"] >= 2


def test_predicate_true_one_poll_too_late_times_out_with_its_name() -> None:
    clock = StepClock()

    def predicate() -> bool:
        return clock.t >= 500.0 + 9.0

    with pytest.raises(teardown.WaitTimeout) as excinfo:
        teardown.wait_for(
            "endpoint_b_gone",
            predicate,
            timeout_s=2.0,
            poll_s=0.5,
            clock=clock.now,
            sleep=clock.sleep,
        )

    assert excinfo.value.condition == "endpoint_b_gone"
    assert excinfo.value.reason == constants.WAIT_TIMEOUT
    assert clock.t <= 500.0 + 2.0 + 0.5
