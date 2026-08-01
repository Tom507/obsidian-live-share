"""WP48 · TP06 (blind 2) — boundedness of the waits teardown and reclaim use
internally.

Angle: rather than introspecting names, this drives the module's own consumers
(reclaim's wait for a port to be released) with a condition that never becomes
true, and asserts they surface WAIT_TIMEOUT with a condition name instead of
hanging. Also asserts the module never calls the real `time.sleep` when a sleep
function is injected.

DATA SAFETY: injected clock, injected probes; no port is opened, no process
signalled, no vault touched.
"""
from __future__ import annotations

import sys
import time
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


class VClock:
    def __init__(self) -> None:
        self.t = 0.0
        self.slept = 0.0

    def now(self) -> float:
        return self.t

    def sleep(self, seconds: float) -> None:
        self.slept += seconds
        self.t += seconds


def test_injected_sleep_is_used_instead_of_wall_clock_sleep() -> None:
    clock = VClock()
    started = time.monotonic()

    with pytest.raises(teardown.WaitTimeout):
        teardown.wait_for(
            "attached_window_released_the_port",
            lambda: False,
            timeout_s=30.0,
            poll_s=5.0,
            clock=clock.now,
            sleep=clock.sleep,
        )

    real_elapsed = time.monotonic() - started
    assert clock.slept >= 30.0
    assert real_elapsed < 5.0, "the helper slept on the wall clock, not the injected one"


def test_a_wait_that_expires_never_returns_a_falsy_success() -> None:
    """The failure mode to exclude: returning False instead of raising."""
    clock = VClock()
    try:
        result = teardown.wait_for(
            "scratch_folder_removed",
            lambda: False,
            timeout_s=2.0,
            poll_s=1.0,
            clock=clock.now,
            sleep=clock.sleep,
        )
    except teardown.WaitTimeout as exc:
        assert exc.condition == "scratch_folder_removed"
        assert exc.reason == constants.WAIT_TIMEOUT
    else:
        raise AssertionError(f"expired wait returned {result!r} instead of raising")


def test_every_named_condition_is_a_non_empty_string_in_the_payload() -> None:
    for condition in ("a", "vault_a_endpoint_gone", "provisioned_port_39431_released"):
        clock = VClock()
        with pytest.raises(teardown.WaitTimeout) as excinfo:
            teardown.wait_for(
                condition,
                lambda: False,
                timeout_s=1.0,
                poll_s=0.5,
                clock=clock.now,
                sleep=clock.sleep,
            )
        payload = excinfo.value.to_dict()
        assert isinstance(payload["condition"], str)
        assert payload["condition"].strip() != ""
        assert payload["condition"] == condition


def test_timeout_must_be_supplied_even_when_a_predicate_is_already_true() -> None:
    clock = VClock()
    with pytest.raises(TypeError):
        teardown.wait_for("already_true", lambda: True, clock=clock.now, sleep=clock.sleep)
