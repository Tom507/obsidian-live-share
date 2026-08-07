"""WP46 AC2 — same-vault refusal, blind set 2.

Angle: the two endpoints are literally the same vault reached twice (identical
identity, identical build), which is what D14 makes possible — one Obsidian
process hosting two windows. Also asserts the refusal is not swallowed when the
pair is otherwise perfect.
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
ROOM = "raum-üben-42"
CONFIGURED = {"a": VAULT_A, "b": VAULT_B}


def _identical(vault: str):
    payload = make_info(
        clientId="e2e-same",
        role="host",
        roomId=ROOM,
        connected=True,
        vaultId=vault,
        vaultName="Wissen Örga",
        vaultPath="H:\\Developement\\_NeuralAngels\\ObsidianOrga",
        canvasSurface=True,
    )
    return StubEndpoint(dict(payload)), StubEndpoint(dict(payload))


def _check(a: StubEndpoint, b: StubEndpoint):
    return readiness.check_readiness(
        endpoints={"a": a.url, "b": b.url}, configured_vaults=CONFIGURED, timeout_s=2.0
    )


def test_the_same_window_reached_twice_is_refused():
    a, b = _identical(VAULT_A)
    with a, b:
        verdict = _check(a, b)
    assert verdict.ready is False
    assert verdict.reason == constants.IDENTITY_SAME_VAULT


def test_the_copy_vault_reached_twice_is_refused_the_same_way():
    a, b = _identical(VAULT_B)
    with a, b:
        verdict = _check(a, b)
    assert verdict.reason == constants.IDENTITY_SAME_VAULT


def test_a_correctly_split_pair_is_the_only_accepted_shape():
    a, _ = _identical(VAULT_A)
    b = StubEndpoint(
        make_info(
            clientId="e2e-b",
            role="guest",
            roomId=ROOM,
            connected=True,
            vaultId=VAULT_B,
            vaultName="Wissen Örga – Kopie",
            canvasSurface=True,
        )
    )
    with a, b:
        assert _check(a, b).ready is True


def test_the_collision_case_issues_no_edit():
    a, b = _identical(VAULT_A)
    with a, b:
        _check(a, b)
        assert_only_probed(a, b)


if __name__ == "__main__":
    sys.exit(as_script(dict(globals())))
