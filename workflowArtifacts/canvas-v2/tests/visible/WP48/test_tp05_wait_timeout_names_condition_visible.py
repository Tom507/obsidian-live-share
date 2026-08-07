"""WP48 · TP05 (visible) — an expired wait reports WAIT_TIMEOUT *and names the
condition it was waiting for*.

Verifies AC2. A bare timeout with no condition name is explicitly a failure of
this test: the whole point of AC2 is that a hung run says what it was waiting
for.

DATA SAFETY: no real waiting, no real endpoint — the clock is injected, so the
test consumes no wall-clock time and touches no process.
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


class FakeClock:
    """Virtual monotonic clock — `sleep` advances time instead of blocking."""

    def __init__(self, start: float = 1000.0) -> None:
        self.t = start
        self.sleeps: list[float] = []

    def now(self) -> float:
        return self.t

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.t += seconds


def test_expired_wait_raises_wait_timeout_carrying_the_condition_name() -> None:
    clock = FakeClock()
    condition = "both_control_endpoints_gone"

    with pytest.raises(teardown.WaitTimeout) as excinfo:
        teardown.wait_for(
            condition,
            lambda: False,
            timeout_s=5.0,
            poll_s=0.25,
            clock=clock.now,
            sleep=clock.sleep,
        )

    exc = excinfo.value
    assert exc.reason == constants.WAIT_TIMEOUT
    assert exc.condition == condition
    payload = exc.to_dict()
    assert payload["reason"] == constants.WAIT_TIMEOUT
    assert payload["condition"] == condition
    # The name must survive serialisation into the run record, not only live on
    # the exception object.
    assert condition in json.dumps(payload)
    assert condition in str(exc)
    # the wait was bounded: virtual time advanced by roughly the budget, no more
    assert clock.t >= 1000.0 + 5.0
    assert clock.t <= 1000.0 + 5.0 + 0.25


def test_two_different_conditions_produce_two_different_payloads() -> None:
    payloads = []
    for condition in ("scratch_artefacts_removed", "provisioned_port_released"):
        clock = FakeClock()
        with pytest.raises(teardown.WaitTimeout) as excinfo:
            teardown.wait_for(
                condition,
                lambda: False,
                timeout_s=2.0,
                poll_s=0.5,
                clock=clock.now,
                sleep=clock.sleep,
            )
        payloads.append(excinfo.value.to_dict())

    assert payloads[0]["condition"] != payloads[1]["condition"]
    assert payloads[0]["condition"] == "scratch_artefacts_removed"
    assert payloads[1]["condition"] == "provisioned_port_released"
    assert {p["reason"] for p in payloads} == {constants.WAIT_TIMEOUT}


def test_a_condition_that_becomes_true_returns_without_raising() -> None:
    clock = FakeClock()
    calls = {"n": 0}

    def predicate() -> bool:
        calls["n"] += 1
        return calls["n"] >= 3

    elapsed = teardown.wait_for(
        "endpoint_answers",
        predicate,
        timeout_s=10.0,
        poll_s=0.5,
        clock=clock.now,
        sleep=clock.sleep,
    )

    assert calls["n"] == 3
    assert elapsed <= 10.0
    assert clock.t < 1000.0 + 10.0
