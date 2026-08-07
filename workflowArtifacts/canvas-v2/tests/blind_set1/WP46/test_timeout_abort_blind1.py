"""WP46 AC2/AC3 — bounded timeout, blind set 1.

Angle: it is role ``a`` (the host role, index 0) that goes silent, the bound is
tighter, and the discrimination is made against a control run where the same
stub answers — the only difference between the two runs is the silence.
"""

from __future__ import annotations

import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from _wp46_stub_b1 import (  # noqa: E402
    ControlStub,
    assert_untouched,
    constants,
    info_payload,
    readiness,
    script_main,
)

VAULT_A = "H:\\Developement\\_NeuralAngels\\ObsidianOrga"
VAULT_B = "H:\\Developement\\_NeuralAngels\\ObsidianOrga - Kopie"
ROOM = "canvas-v2-t3"
CONFIGURED = {"a": VAULT_A, "b": VAULT_B}
TIMEOUT_S = 0.2


def _check(a: ControlStub, b: ControlStub):
    return readiness.check_readiness(
        endpoints={"a": a.url, "b": b.url}, configured_vaults=CONFIGURED, timeout_s=TIMEOUT_S
    )


def test_a_silent_host_role_names_readiness_timeout():
    a = ControlStub(behaviour="silent")
    b = ControlStub(info_payload(VAULT_B, ROOM, clientId="e2e-b"))
    with a, b:
        verdict = _check(a, b)
    assert verdict.ready is False
    assert verdict.reason == constants.READINESS_TIMEOUT


def test_silence_is_the_only_difference_from_a_green_run():
    answering = ControlStub(info_payload(VAULT_A, ROOM, clientId="e2e-a"))
    partner = ControlStub(info_payload(VAULT_B, ROOM, clientId="e2e-b"))
    with answering, partner:
        assert _check(answering, partner).ready is True

    silent = ControlStub(behaviour="silent")
    partner2 = ControlStub(info_payload(VAULT_B, ROOM, clientId="e2e-b"))
    with silent, partner2:
        verdict = _check(silent, partner2)
    assert verdict.ready is False
    assert verdict.reason == constants.READINESS_TIMEOUT


def test_the_check_returns_long_before_the_stub_would_answer():
    a = ControlStub(behaviour="silent", silence_s=30.0)
    b = ControlStub(info_payload(VAULT_B, ROOM))
    with a, b:
        t0 = time.monotonic()
        _check(a, b)
        elapsed = time.monotonic() - t0
    assert elapsed < 8.0, f"unbounded wait: {elapsed:.1f}s"


def test_a_timed_out_run_leaves_the_answering_instance_untouched():
    a = ControlStub(behaviour="silent")
    b = ControlStub(info_payload(VAULT_B, ROOM))
    with a, b:
        _check(a, b)
        assert_untouched(a, b)


if __name__ == "__main__":
    sys.exit(script_main(dict(globals())))
