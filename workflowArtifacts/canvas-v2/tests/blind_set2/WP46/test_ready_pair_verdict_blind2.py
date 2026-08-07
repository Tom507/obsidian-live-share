"""WP46 AC2 (positive leg) — blind set 2.

Angle: identities are opaque uuid-style ids with unicode vault names, the
endpoints map is built in reverse role order, and the verdict is validated as a
whole object (ready + reason + identity key set) in one comparison.
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from _wp46_stub_b2 import (  # noqa: E402
    StubEndpoint,
    assert_only_probed,
    make_info,
    readiness,
    as_script,
)

VAULT_A = "0f9d3c11-2b7e-4a05-9c31-6d8e2f4a1b00"
VAULT_B = "5a1e77c4-8f02-4d6b-b3aa-91c07e5d2f38"
ROOM = "raum-üben-42"
CONFIGURED = {"a": VAULT_A, "b": VAULT_B}


def _pair():
    a = StubEndpoint(
        make_info(
            clientId="e2e-a",
            role="host",
            roomId=ROOM,
            connected=True,
            vaultId=VAULT_A,
            vaultName="Wissen Örga",
            vaultPath=None,
            canvasSurface=True,
        )
    )
    b = StubEndpoint(
        make_info(
            clientId="e2e-b",
            role="guest",
            roomId=ROOM,
            connected=True,
            vaultId=VAULT_B,
            vaultName="Wissen Örga – Kopie",
            vaultPath="H:\\Developement\\_NeuralAngels\\ObsidianOrga - Kopie",
            canvasSurface=True,
        )
    )
    return a, b


def _check(a: StubEndpoint, b: StubEndpoint):
    return readiness.check_readiness(
        endpoints={"b": b.url, "a": a.url}, configured_vaults=CONFIGURED, timeout_s=2.0
    )


def test_the_pair_is_ready_with_no_named_refusal():
    a, b = _pair()
    with a, b:
        verdict = _check(a, b)
    assert (verdict.ready, verdict.reason, sorted(verdict.identities)) == (True, None, ["a", "b"])


def test_unicode_vault_names_are_carried_through_unchanged():
    a, b = _pair()
    with a, b:
        verdict = _check(a, b)
    assert verdict.identities["a"]["vaultName"] == "Wissen Örga"
    assert verdict.identities["b"]["vaultName"] == "Wissen Örga – Kopie"


def test_a_null_vault_path_is_acceptable_when_the_vault_id_is_positive():
    """`vaultPath` is `string | null` by contract — null is not a failure."""
    a, b = _pair()
    with a, b:
        verdict = _check(a, b)
    assert verdict.ready is True
    assert verdict.identities["a"]["vaultPath"] is None
    assert isinstance(verdict.identities["b"]["vaultPath"], str)


def test_the_green_path_sends_only_the_probe():
    a, b = _pair()
    with a, b:
        _check(a, b)
        assert_only_probed(a, b)


if __name__ == "__main__":
    sys.exit(as_script(dict(globals())))
