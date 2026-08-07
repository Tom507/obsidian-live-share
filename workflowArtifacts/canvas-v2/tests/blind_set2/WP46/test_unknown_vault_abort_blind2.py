"""WP46 AC3 — unknown vault, blind set 2.

Angle: the stranger is on role ``a``, the configured set is probed for
case-sensitivity, and the "swapped but still configured" pair is asserted NOT to
be an unknown-vault case — the two refusals must stay distinguishable.
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


def _info(vault: str, client: str, role: str) -> dict:
    return make_info(
        clientId=client,
        role=role,
        roomId=ROOM,
        connected=True,
        vaultId=vault,
        vaultName=vault[:8],
        canvasSurface=True,
    )


def _check(vault_a: str, vault_b: str):
    a = StubEndpoint(_info(vault_a, "e2e-a", "host"))
    b = StubEndpoint(_info(vault_b, "e2e-b", "guest"))
    with a, b:
        verdict = readiness.check_readiness(
            endpoints={"a": a.url, "b": b.url}, configured_vaults=CONFIGURED, timeout_s=2.0
        )
        assert_only_probed(a, b)
    return verdict


def test_a_stranger_on_role_a_is_refused():
    verdict = _check("ffffffff-0000-0000-0000-000000000000", VAULT_B)
    assert verdict.ready is False
    assert verdict.reason == constants.IDENTITY_UNKNOWN_VAULT


def test_vault_ids_are_compared_case_sensitively():
    verdict = _check(VAULT_A.upper(), VAULT_B)
    assert verdict.ready is False
    assert verdict.reason == constants.IDENTITY_UNKNOWN_VAULT


def test_a_truncated_vault_id_is_not_the_configured_vault():
    verdict = _check(VAULT_A[:-1], VAULT_B)
    assert verdict.ready is False
    assert verdict.reason == constants.IDENTITY_UNKNOWN_VAULT


def test_a_swapped_but_configured_pair_is_not_an_unknown_vault_case():
    """Both vaults are configured and distinct — whatever the verdict, the
    'nobody intended this vault' reason must not be the one reported."""
    verdict = _check(VAULT_B, VAULT_A)
    assert verdict.reason != constants.IDENTITY_UNKNOWN_VAULT


if __name__ == "__main__":
    sys.exit(as_script(dict(globals())))
