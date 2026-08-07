"""WP48 · TP06 (visible) — no wait helper in the module can be constructed or
called without a bounded timeout.

Verifies AC2 ("no wait can block a run indefinitely") structurally: the module
is introspected, so a NEW unbounded wait helper added later fails this test too.

DATA SAFETY: introspection plus an injected clock; nothing is executed against a
real endpoint, file or process.
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

TIMEOUT_PARAM_NAMES = {"timeout_s", "timeout", "timeout_ms", "budget_s"}


class Clock:
    """Virtual clock with a hard call budget.

    The budget matters: an implementation that accepts an unbounded timeout would
    otherwise hang the whole suite instead of failing. Here it fails loudly.
    """

    def __init__(self, max_calls: int = 5_000) -> None:
        self.t = 0.0
        self.calls = 0
        self.max_calls = max_calls

    def now(self) -> float:
        self.calls += 1
        if self.calls > self.max_calls:
            raise AssertionError("wait helper never terminated — the timeout was not enforced")
        return self.t

    def sleep(self, seconds: float) -> None:
        self.t += seconds


def _wait_callables():
    """Every public callable in the module whose name marks it as a wait."""
    found = []
    for name, obj in vars(teardown).items():
        if name.startswith("_"):
            continue
        if not (callable(obj) or inspect.isclass(obj)):
            continue
        if getattr(obj, "__module__", None) != teardown.__name__:
            continue
        lowered = name.lower()
        if "wait" in lowered or "poll" in lowered or "await" in lowered:
            target = obj.__init__ if inspect.isclass(obj) else obj
            found.append((name, target))
    return found


def test_the_module_actually_exposes_a_wait_helper() -> None:
    names = [name for name, _ in _wait_callables()]
    assert "wait_for" in names, names


def test_every_wait_helper_takes_a_bounded_timeout_parameter() -> None:
    for name, target in _wait_callables():
        if name == "WaitTimeout":
            continue
        params = inspect.signature(target).parameters
        timeout_params = [p for p in params.values() if p.name in TIMEOUT_PARAM_NAMES]
        assert timeout_params, f"{name} has no timeout parameter: {list(params)}"
        for param in timeout_params:
            if param.default is inspect.Parameter.empty:
                continue  # required — the strongest form
            default = param.default
            assert isinstance(default, (int, float)), f"{name}.{param.name}={default!r}"
            assert not isinstance(default, bool), f"{name}.{param.name}={default!r}"
            assert default > 0, f"{name}.{param.name}={default!r}"
            assert math.isfinite(default), f"{name}.{param.name}={default!r}"


@pytest.mark.parametrize("bad_timeout", [None, 0, -1, -0.5, float("inf"), float("nan")])
def test_wait_for_rejects_an_unbounded_timeout(bad_timeout) -> None:
    clock = Clock()
    with pytest.raises(ValueError):
        teardown.wait_for(
            "endpoints_gone",
            lambda: False,
            timeout_s=bad_timeout,
            clock=clock.now,
            sleep=clock.sleep,
        )


def test_wait_for_requires_the_timeout_to_be_passed_explicitly() -> None:
    params = inspect.signature(teardown.wait_for).parameters
    assert "timeout_s" in params
    assert params["timeout_s"].kind is inspect.Parameter.KEYWORD_ONLY
    assert params["timeout_s"].default is inspect.Parameter.empty


def test_a_never_satisfied_predicate_terminates_instead_of_blocking() -> None:
    clock = Clock()
    with pytest.raises(teardown.WaitTimeout) as excinfo:
        teardown.wait_for(
            "never_true",
            lambda: False,
            timeout_s=7.0,
            poll_s=1.0,
            clock=clock.now,
            sleep=clock.sleep,
        )
    assert excinfo.value.reason == constants.WAIT_TIMEOUT
    assert clock.t <= 7.0 + 1.0
