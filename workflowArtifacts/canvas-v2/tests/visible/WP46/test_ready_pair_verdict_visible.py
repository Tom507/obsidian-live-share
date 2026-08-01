"""WP46 / C46 AC2 (positive leg) — a healthy pair is READY and the verdict
carries both identities.

Two endpoints answer within the bound, report DIFFERENT vaults and the SAME
room -> ready, no reason, both identities present. The probe sends nothing but
``session.info``.

Run:  .venv\\Scripts\\python.exe -m pytest <this file> -v
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from _wp46_endpoint_visible import (  # noqa: E402
    FakeEndpoint,
    assert_no_edit_issued,
    readiness,
    run_as_script,
    session_info,
)

VAULT_A = "app-id-vault-a"
VAULT_B = "app-id-vault-b"
ROOM = "room-t3"


def _pair():
    a = FakeEndpoint(
        info=session_info(
            vault_id=VAULT_A,
            room_id=ROOM,
            client_id="e2e-a",
            role="host",
            vault_name="ObsidianOrga",
            vault_path="H:\\Developement\\_NeuralAngels\\ObsidianOrga",
        )
    )
    b = FakeEndpoint(
        info=session_info(
            vault_id=VAULT_B,
            room_id=ROOM,
            client_id="e2e-b",
            role="guest",
            vault_name="ObsidianOrga - Kopie",
            vault_path="H:\\Developement\\_NeuralAngels\\ObsidianOrga - Kopie",
        )
    )
    return a, b


def test_healthy_pair_is_ready_with_no_reason():
    a, b = _pair()
    with a, b:
        verdict = readiness.check_readiness(
            endpoints={"a": a.url, "b": b.url},
            configured_vaults={"a": VAULT_A, "b": VAULT_B},
            timeout_s=2.0,
        )
    assert verdict.ready is True
    assert verdict.reason is None


def test_verdict_carries_both_identities_verbatim():
    a, b = _pair()
    with a, b:
        verdict = readiness.check_readiness(
            endpoints={"a": a.url, "b": b.url},
            configured_vaults={"a": VAULT_A, "b": VAULT_B},
            timeout_s=2.0,
        )
    assert set(verdict.identities) == {"a", "b"}
    assert verdict.identities["a"]["vaultId"] == VAULT_A
    assert verdict.identities["b"]["vaultId"] == VAULT_B
    assert verdict.identities["a"]["vaultId"] != verdict.identities["b"]["vaultId"]
    assert verdict.identities["a"]["roomId"] == verdict.identities["b"]["roomId"] == ROOM


def test_verdict_keeps_the_added_identity_fields():
    a, b = _pair()
    with a, b:
        verdict = readiness.check_readiness(
            endpoints={"a": a.url, "b": b.url},
            configured_vaults={"a": VAULT_A, "b": VAULT_B},
            timeout_s=2.0,
        )
    for role in ("a", "b"):
        identity = verdict.identities[role]
        for field in ("vaultId", "vaultName", "vaultPath", "pluginBuild", "canvasSurface"):
            assert field in identity, f"{role} identity lost {field}"
        assert identity["canvasSurface"] is True
        assert isinstance(identity["pluginBuild"], str) and identity["pluginBuild"]


def test_readiness_issues_no_edit_on_the_happy_path_either():
    a, b = _pair()
    with a, b:
        readiness.check_readiness(
            endpoints={"a": a.url, "b": b.url},
            configured_vaults={"a": VAULT_A, "b": VAULT_B},
            timeout_s=2.0,
        )
        assert_no_edit_issued(a, b)
        assert a.commands and b.commands, "both endpoints must actually be probed"


if __name__ == "__main__":
    sys.exit(run_as_script(dict(globals())))
