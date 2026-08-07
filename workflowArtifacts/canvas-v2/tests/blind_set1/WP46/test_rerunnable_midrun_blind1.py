"""WP46 AC4 (re-runnability) — blind set 1.

Angle: five consecutive checks instead of two, interleaved with a state change
on the endpoint side, proving the verdict tracks the world rather than the first
observation — and that a recovered pair is accepted again.
"""

from __future__ import annotations

import pathlib
import sys

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


def _pair():
    return (
        ControlStub(info_payload(VAULT_A, ROOM, clientId="e2e-a")),
        ControlStub(info_payload(VAULT_B, ROOM, clientId="e2e-b")),
    )


def _check(a: ControlStub, b: ControlStub, timeout_s: float = 2.0):
    return readiness.check_readiness(
        endpoints={"a": a.url, "b": b.url}, configured_vaults=CONFIGURED, timeout_s=timeout_s
    )


def test_five_consecutive_checks_all_agree():
    a, b = _pair()
    with a, b:
        verdicts = [_check(a, b) for _ in range(5)]
    assert all(v.ready is True for v in verdicts)
    assert {v.reason for v in verdicts} == {None}
    assert all(v.identities == verdicts[0].identities for v in verdicts)


def test_a_mid_run_room_change_flips_the_verdict():
    a, b = _pair()
    with a, b:
        assert _check(a, b).ready is True
        b.info = info_payload(VAULT_B, "someone-elses-room", clientId="e2e-b")
        after = _check(a, b)
    assert after.ready is False
    assert after.reason == constants.ROOM_MISMATCH


def test_a_recovered_pair_is_accepted_again():
    a, b = _pair()
    with a, b:
        original = dict(b.info)
        b.info = info_payload(VAULT_A, ROOM, clientId="e2e-b")
        assert _check(a, b).ready is False
        b.info = original
        assert _check(a, b).ready is True


def test_repeated_checks_never_escalate_beyond_session_info():
    a, b = _pair()
    with a, b:
        for _ in range(5):
            _check(a, b)
        assert_untouched(a, b)
        assert len(a.log) >= 5


if __name__ == "__main__":
    sys.exit(script_main(dict(globals())))
