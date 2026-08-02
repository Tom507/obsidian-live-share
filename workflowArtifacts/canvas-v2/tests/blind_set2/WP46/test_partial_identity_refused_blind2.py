"""WP46 AC3 — partially initialised instance, blind set 2.

Angle: both endpoints are half-initialised in different ways at the same time,
and the refusal must still be a single named reason rather than an exception or
a bare False. Also pins that a *complete* identity is required from BOTH sides,
not just from one.
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from _wp46_stub_b2 import (  # noqa: E402
    REASONS,
    StubEndpoint,
    as_script,
    assert_only_probed,
    make_info,
    readiness,
)

VAULT_A = "0f9d3c11-2b7e-4a05-9c31-6d8e2f4a1b00"
VAULT_B = "5a1e77c4-8f02-4d6b-b3aa-91c07e5d2f38"
ROOM = "raum-üben-42"
CONFIGURED = {"a": VAULT_A, "b": VAULT_B}


def _check(info_a: dict, info_b: dict):
    a = StubEndpoint(info_a)
    b = StubEndpoint(info_b)
    with a, b:
        verdict = readiness.check_readiness(
            endpoints={"a": a.url, "b": b.url}, configured_vaults=CONFIGURED, timeout_s=2.0
        )
        assert_only_probed(a, b)
    return verdict


def _healthy_b() -> dict:
    return make_info(
        clientId="e2e-b",
        role="guest",
        roomId=ROOM,
        connected=True,
        vaultId=VAULT_B,
        vaultName="Wissen Örga – Kopie",
        canvasSurface=True,
    )


def test_default_neutral_identity_is_refused():
    """`make_info()` with no overrides is exactly a freshly booted, unidentified instance."""
    verdict = _check(make_info(), _healthy_b())
    assert verdict.ready is False
    assert verdict.reason in REASONS


def test_both_sides_half_initialised_still_yields_one_named_reason():
    verdict = _check(
        make_info(clientId="e2e-a", roomId=ROOM, connected=True),
        make_info(clientId="e2e-b", vaultId=VAULT_B, connected=False),
    )
    assert verdict.ready is False
    assert verdict.reason in REASONS
    assert isinstance(verdict.reason, str)


def test_an_identified_vault_without_a_room_yet_is_refused():
    verdict = _check(
        make_info(clientId="e2e-a", vaultId=VAULT_A, vaultName="Wissen Örga", roomId=""),
        _healthy_b(),
    )
    assert verdict.ready is False
    assert verdict.reason in REASONS


def test_whitespace_is_not_an_identity():
    verdict = _check(
        make_info(
            clientId="e2e-a",
            roomId=ROOM,
            connected=True,
            vaultId="   ",
            vaultName="   ",
            canvasSurface=True,
        ),
        _healthy_b(),
    )
    assert verdict.ready is False
    assert verdict.reason in REASONS


if __name__ == "__main__":
    sys.exit(as_script(dict(globals())))
