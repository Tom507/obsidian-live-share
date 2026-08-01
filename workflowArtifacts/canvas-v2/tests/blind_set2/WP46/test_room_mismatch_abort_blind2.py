"""WP46 AC2 — room mismatch, blind set 2.

Angle: a mismatch that would be invisible to a human reader (unicode-normalised
lookalike, and a room id that differs only in a trailing newline), plus the
proof that a room match is what flips the same pair to ready.
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from _wp46_stub_b2 import (  # noqa: E402
    StubEndpoint,
    as_script,
    assert_only_probed,
    constants,
    make_info,
    readiness,
)

VAULT_A = "0f9d3c11-2b7e-4a05-9c31-6d8e2f4a1b00"
VAULT_B = "5a1e77c4-8f02-4d6b-b3aa-91c07e5d2f38"
CONFIGURED = {"a": VAULT_A, "b": VAULT_B}


def _pair(room_a: str, room_b: str):
    a = StubEndpoint(
        make_info(
            clientId="e2e-a",
            role="host",
            roomId=room_a,
            connected=True,
            vaultId=VAULT_A,
            vaultName="Wissen Örga",
            canvasSurface=True,
        )
    )
    b = StubEndpoint(
        make_info(
            clientId="e2e-b",
            role="guest",
            roomId=room_b,
            connected=True,
            vaultId=VAULT_B,
            vaultName="Wissen Örga – Kopie",
            canvasSurface=True,
        )
    )
    return a, b


def _check(a: StubEndpoint, b: StubEndpoint):
    return readiness.check_readiness(
        endpoints={"a": a.url, "b": b.url}, configured_vaults=CONFIGURED, timeout_s=2.0
    )


def test_a_lookalike_room_id_is_a_mismatch():
    a, b = _pair("raum-üben-42", "raum-ueben-42")
    with a, b:
        verdict = _check(a, b)
    assert verdict.ready is False
    assert verdict.reason == constants.ROOM_MISMATCH


def test_a_trailing_newline_is_a_mismatch():
    a, b = _pair("raum-üben-42", "raum-üben-42\n")
    with a, b:
        verdict = _check(a, b)
    assert verdict.reason == constants.ROOM_MISMATCH


def test_both_rooms_empty_is_not_silently_treated_as_a_match():
    a, b = _pair("", "")
    with a, b:
        verdict = _check(a, b)
    assert verdict.ready is False


def test_the_identical_pair_with_one_room_is_ready():
    a, b = _pair("raum-üben-42", "raum-üben-42")
    with a, b:
        verdict = _check(a, b)
        assert_only_probed(a, b)
    assert verdict.ready is True
    assert verdict.reason is None


if __name__ == "__main__":
    sys.exit(as_script(dict(globals())))
