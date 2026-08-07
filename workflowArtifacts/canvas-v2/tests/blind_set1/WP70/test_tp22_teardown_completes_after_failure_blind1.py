# WP70 / AC4 — blind counterpart 1 for "teardown runs to completion even when a step in
# the middle fails".
#
# Different angle: the FIRST and LAST actions fail, and the action list is a single item,
# and the action list is empty. The boundaries are where a loop written with an early
# `return` or a `for … else` misbehaves, and an empty teardown must be `complete`, not
# "failed because there was nothing to do".
#
# DATA SAFETY: pure in-memory bookkeeping over injected callables.

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# --- repo bootstrap (T3_SharedContract §0.2) --------------------------------------
for _parent in Path(__file__).resolve().parents:
    if (_parent / "tools").is_dir() and (_parent / "plugin").is_dir():
        _TOOLS = _parent / "tools"
        break
else:  # pragma: no cover
    raise RuntimeError(f"obsidian-live-share repo root not found from {__file__}")
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, provisioning, relay  # noqa: E402


class Boom(RuntimeError):
    pass


def build(log: list, names, failing: dict) -> list:
    def make(name: str):
        def run():
            log.append(name)
            if name in failing:
                raise failing[name]
            return name

        return (name, run)

    return [make(name) for name in names]


THREE = ("release_relay", "restore_settings", "restore_community_plugins")


def test_a_failing_first_action_does_not_stop_the_rest() -> None:
    log: list = []
    report = provisioning.run_teardown(build(log, THREE, {THREE[0]: Boom("first")}))
    assert log == list(THREE)
    assert report.failed == (THREE[0],)
    assert report.succeeded == THREE[1:]


def test_a_failing_last_action_is_still_reported() -> None:
    log: list = []
    report = provisioning.run_teardown(build(log, THREE, {THREE[-1]: Boom("last")}))
    assert log == list(THREE)
    assert report.failed == (THREE[-1],)
    assert report.complete is True


def test_every_action_failing_is_still_a_complete_teardown() -> None:
    log: list = []
    report = provisioning.run_teardown(
        build(log, THREE, {name: Boom(name) for name in THREE})
    )
    assert log == list(THREE)
    assert report.failed == THREE
    assert report.succeeded == ()
    assert report.complete is True


def test_a_single_action_list_works() -> None:
    log: list = []
    report = provisioning.run_teardown(build(log, ("only",), {}))
    assert log == ["only"]
    assert report.attempted == ("only",)
    assert report.failed == ()


def test_an_empty_action_list_is_a_complete_teardown() -> None:
    report = provisioning.run_teardown([])
    assert report.attempted == ()
    assert report.succeeded == ()
    assert report.failed == ()
    assert report.complete is True


def test_a_named_rig_failure_is_reported_under_its_reason() -> None:
    log: list = []
    report = provisioning.run_teardown(
        build(log, THREE, {"release_relay": relay.RelayNotStopped("port still bound")})
    )
    assert report.reasons["release_relay"] == constants.RELAY_NOT_STOPPED
    assert report.reasons["release_relay"] in constants.FAILURE_REASONS
