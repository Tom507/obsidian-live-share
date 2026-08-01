"""WP48 · TP05 (blind 1) — the awaited condition name must survive into the run
record, not just the exception message.

Angle: the timeout is raised inside the run body and observed through the run
outcome, so an implementation that names the condition only in a log string is
caught. Different condition names and a zero-poll edge case.

DATA SAFETY: injected clock, no endpoint, no process.
"""
from __future__ import annotations

import json
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


class VirtualClock:
    def __init__(self) -> None:
        self.t = 0.0

    def now(self) -> float:
        return self.t

    def sleep(self, seconds: float) -> None:
        self.t += seconds


class NoopIO:
    def restore_setting(self, record) -> None:
        pass

    def remove_scratch(self, path) -> None:
        pass

    def terminate_process(self, pid) -> None:
        pass


def test_wait_timeout_inside_a_run_is_reported_with_its_condition() -> None:
    clock = VirtualClock()
    steps: list[str] = []
    runner = teardown.TeardownRunner(
        provisioned_settings=[],
        scratch_artefacts=[],
        processes=[],
        io=NoopIO(),
        recorder=steps.append,
    )

    def body():
        teardown.wait_for(
            "vault_b_reports_its_identity",
            lambda: False,
            timeout_s=3.0,
            poll_s=1.0,
            clock=clock.now,
            sleep=clock.sleep,
        )

    outcome = teardown.run_with_teardown(body, runner)

    assert outcome.failure_reason == constants.WAIT_TIMEOUT
    assert isinstance(outcome.error, teardown.WaitTimeout)
    assert outcome.error.condition == "vault_b_reports_its_identity"
    assert "vault_b_reports_its_identity" in json.dumps(outcome.error.to_dict())
    assert outcome.exit_status != 0
    assert outcome.green is False
    assert steps == list(teardown.TEARDOWN_STEP_ORDER)


def test_condition_name_is_mandatory_on_the_exception_type_itself() -> None:
    exc = teardown.WaitTimeout(condition="scratch_folder_gone", timeout_s=1.5)

    assert exc.reason == constants.WAIT_TIMEOUT
    assert exc.condition == "scratch_folder_gone"
    assert exc.to_dict()["condition"] == "scratch_folder_gone"
    assert "scratch_folder_gone" in str(exc)


def test_empty_condition_name_is_rejected_at_construction() -> None:
    with pytest.raises(ValueError):
        teardown.WaitTimeout(condition="", timeout_s=1.0)

    clock = VirtualClock()
    with pytest.raises(ValueError):
        teardown.wait_for(
            "",
            lambda: True,
            timeout_s=1.0,
            clock=clock.now,
            sleep=clock.sleep,
        )


def test_predicate_true_on_the_first_probe_never_sleeps() -> None:
    clock = VirtualClock()

    elapsed = teardown.wait_for(
        "port_released",
        lambda: True,
        timeout_s=30.0,
        poll_s=2.0,
        clock=clock.now,
        sleep=clock.sleep,
    )

    assert clock.t == 0.0
    assert elapsed == 0.0
