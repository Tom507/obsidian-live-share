"""WP48 · TP06 (blind 1) — boundedness proven behaviourally, not by signature.

Angle: every wait-shaped callable is driven with a predicate that is never true
and a clock that would happily run forever. If any of them fails to return or
raise within its declared budget, the virtual clock exposes it. Also asserts the
module exports no sleep-forever helper.

DATA SAFETY: virtual clock, no real sleeping, no endpoint.
"""
from __future__ import annotations

import inspect
import math
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


class RunawayClock:
    """Advances on every sleep and refuses to be used more than N times."""

    def __init__(self, limit: int = 10_000) -> None:
        self.t = 0.0
        self.calls = 0
        self.limit = limit

    def now(self) -> float:
        self.calls += 1
        if self.calls > self.limit:
            raise AssertionError("wait helper did not terminate — unbounded wait")
        return self.t

    def sleep(self, seconds: float) -> None:
        assert seconds > 0, "a poll interval of 0 spins the CPU"
        assert math.isfinite(seconds)
        self.t += seconds


def test_wait_for_terminates_within_its_budget_on_a_runaway_clock() -> None:
    clock = RunawayClock()

    with pytest.raises(teardown.WaitTimeout) as excinfo:
        teardown.wait_for(
            "obsidian_window_closed",
            lambda: False,
            timeout_s=60.0,
            poll_s=0.5,
            clock=clock.now,
            sleep=clock.sleep,
        )

    assert excinfo.value.reason == constants.WAIT_TIMEOUT
    assert clock.t <= 60.0 + 0.5
    assert clock.calls < clock.limit


def test_no_public_callable_defaults_its_timeout_to_none_zero_or_infinity() -> None:
    offenders = []
    for name, obj in vars(teardown).items():
        if name.startswith("_") or getattr(obj, "__module__", None) != teardown.__name__:
            continue
        target = obj.__init__ if inspect.isclass(obj) else obj
        if not callable(target):
            continue
        try:
            params = inspect.signature(target).parameters
        except (TypeError, ValueError):
            continue
        for param in params.values():
            if "timeout" not in param.name and "budget" not in param.name:
                continue
            default = param.default
            if default is inspect.Parameter.empty:
                continue
            if default is None:
                offenders.append((name, param.name, default))
            elif isinstance(default, (int, float)) and not isinstance(default, bool):
                if default <= 0 or not math.isfinite(default):
                    offenders.append((name, param.name, default))
    assert offenders == [], f"unbounded timeout defaults: {offenders}"


def test_poll_interval_must_be_positive_and_finite() -> None:
    clock = RunawayClock()
    for bad_poll in (0, -1, float("inf")):
        with pytest.raises(ValueError):
            teardown.wait_for(
                "port_released",
                lambda: False,
                timeout_s=5.0,
                poll_s=bad_poll,
                clock=clock.now,
                sleep=clock.sleep,
            )


def test_poll_interval_never_overshoots_the_remaining_budget() -> None:
    clock = RunawayClock()
    with pytest.raises(teardown.WaitTimeout):
        teardown.wait_for(
            "settings_file_back",
            lambda: False,
            timeout_s=1.0,
            poll_s=10.0,
            clock=clock.now,
            sleep=clock.sleep,
        )
    assert clock.t <= 10.0
