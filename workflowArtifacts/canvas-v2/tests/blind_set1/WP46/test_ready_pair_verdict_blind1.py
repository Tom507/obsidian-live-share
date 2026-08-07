"""WP46 AC2 (positive leg) — blind set 1.

Angle: vault identities are the real absolute vault paths (one of them contains
spaces), the host role is role ``b`` rather than ``a``, and the verdict is read
back through the identities map rather than through the boolean alone.
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from _wp46_stub_b1 import (  # noqa: E402
    ControlStub,
    assert_untouched,
    info_payload,
    readiness,
    script_main,
)

VAULT_A = "H:\\Developement\\_NeuralAngels\\ObsidianOrga"
VAULT_B = "H:\\Developement\\_NeuralAngels\\ObsidianOrga - Kopie"
ROOM = "canvas-v2-t3"
CONFIGURED = {"a": VAULT_A, "b": VAULT_B}


def _pair():
    a = ControlStub(info_payload(VAULT_A, ROOM, clientId="e2e-a", role="guest"))
    b = ControlStub(info_payload(VAULT_B, ROOM, clientId="e2e-b", role="host"))
    return a, b


def test_a_healthy_pair_reports_ready():
    a, b = _pair()
    with a, b:
        verdict = readiness.check_readiness(
            endpoints={"a": a.url, "b": b.url}, configured_vaults=CONFIGURED, timeout_s=2.0
        )
    assert verdict.ready is True
    assert verdict.reason is None


def test_the_vault_with_spaces_survives_the_round_trip():
    a, b = _pair()
    with a, b:
        verdict = readiness.check_readiness(
            endpoints={"a": a.url, "b": b.url}, configured_vaults=CONFIGURED, timeout_s=2.0
        )
    assert verdict.identities["b"]["vaultId"] == VAULT_B
    assert " - Kopie" in verdict.identities["b"]["vaultId"]
    assert verdict.identities["b"]["vaultName"] == "ObsidianOrga - Kopie"


def test_the_two_identities_are_distinct_and_share_one_room():
    a, b = _pair()
    with a, b:
        verdict = readiness.check_readiness(
            endpoints={"a": a.url, "b": b.url}, configured_vaults=CONFIGURED, timeout_s=2.0
        )
    ids = {role: identity["vaultId"] for role, identity in verdict.identities.items()}
    assert len(set(ids.values())) == 2
    rooms = {identity["roomId"] for identity in verdict.identities.values()}
    assert rooms == {ROOM}


def test_only_session_info_reaches_either_instance():
    a, b = _pair()
    with a, b:
        readiness.check_readiness(
            endpoints={"a": a.url, "b": b.url}, configured_vaults=CONFIGURED, timeout_s=2.0
        )
        assert_untouched(a, b)
        assert "session.info" in a.log and "session.info" in b.log


if __name__ == "__main__":
    sys.exit(script_main(dict(globals())))
