"""WP46 AC2 — room mismatch, blind set 1.

Angle: the rooms differ only in case and in trailing whitespace variants, which
are the mismatches most likely to be silently normalised away by an over-eager
implementation.
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
CONFIGURED = {"a": VAULT_A, "b": VAULT_B}


def _rooms(room_a: str, room_b: str):
    return (
        ControlStub(info_payload(VAULT_A, room_a, clientId="e2e-a")),
        ControlStub(info_payload(VAULT_B, room_b, clientId="e2e-b")),
    )


def _verdict(a: ControlStub, b: ControlStub):
    return readiness.check_readiness(
        endpoints={"a": a.url, "b": b.url}, configured_vaults=CONFIGURED, timeout_s=2.0
    )


def test_two_unrelated_rooms_are_refused():
    a, b = _rooms("canvas-v2-t3", "legacy-room")
    with a, b:
        verdict = _verdict(a, b)
    assert verdict.ready is False
    assert verdict.reason == constants.ROOM_MISMATCH


def test_a_case_difference_is_a_mismatch():
    a, b = _rooms("canvas-v2-t3", "Canvas-V2-T3")
    with a, b:
        verdict = _verdict(a, b)
    assert verdict.ready is False
    assert verdict.reason == constants.ROOM_MISMATCH


def test_a_trailing_space_is_a_mismatch():
    a, b = _rooms("canvas-v2-t3", "canvas-v2-t3 ")
    with a, b:
        verdict = _verdict(a, b)
    assert verdict.ready is False
    assert verdict.reason == constants.ROOM_MISMATCH


def test_a_room_mismatch_still_reports_both_identities_and_issues_no_edit():
    a, b = _rooms("canvas-v2-t3", "legacy-room")
    with a, b:
        verdict = _verdict(a, b)
        assert_untouched(a, b)
    assert set(verdict.identities) == {"a", "b"}


if __name__ == "__main__":
    sys.exit(script_main(dict(globals())))
