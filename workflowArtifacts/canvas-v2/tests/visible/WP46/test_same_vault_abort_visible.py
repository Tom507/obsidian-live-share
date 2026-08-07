"""WP46 / C46 AC2 — both endpoints reporting the SAME vault identity aborts the
run under ``IDENTITY_SAME_VAULT``, and no edit is issued.

This is the "structurally impossible to drive one vault twice" leg of the DoD:
one Obsidian process can host both vault windows (D14), so process-level
identity proves nothing — only the reported vault identity does.

Run:  .venv\\Scripts\\python.exe -m pytest <this file> -v
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from _wp46_endpoint_visible import (  # noqa: E402
    FakeEndpoint,
    assert_no_edit_issued,
    constants,
    readiness,
    run_as_script,
    session_info,
)

VAULT_A = "app-id-vault-a"
VAULT_B = "app-id-vault-b"
ROOM = "room-t3"


def _both_report(vault_id: str):
    a = FakeEndpoint(info=session_info(vault_id=vault_id, room_id=ROOM, client_id="e2e-a"))
    b = FakeEndpoint(
        info=session_info(vault_id=vault_id, room_id=ROOM, client_id="e2e-b", role="guest")
    )
    return a, b


def test_two_endpoints_on_the_same_vault_abort_with_identity_same_vault():
    a, b = _both_report(VAULT_A)
    with a, b:
        verdict = readiness.check_readiness(
            endpoints={"a": a.url, "b": b.url},
            configured_vaults={"a": VAULT_A, "b": VAULT_B},
            timeout_s=2.0,
        )
    assert verdict.ready is False
    assert verdict.reason == constants.IDENTITY_SAME_VAULT


def test_same_vault_is_refused_even_though_everything_else_is_healthy():
    """Both answer, both are configured vaults, the room matches — still refused."""
    a, b = _both_report(VAULT_B)
    with a, b:
        verdict = readiness.check_readiness(
            endpoints={"a": a.url, "b": b.url},
            configured_vaults={"a": VAULT_A, "b": VAULT_B},
            timeout_s=2.0,
        )
    assert verdict.ready is False
    assert verdict.reason == constants.IDENTITY_SAME_VAULT
    assert verdict.reason != constants.ROOM_MISMATCH


def test_distinct_client_ids_do_not_rescue_a_same_vault_pair():
    """Client id is a session identity, not a vault identity."""
    a, b = _both_report(VAULT_A)
    with a, b:
        verdict = readiness.check_readiness(
            endpoints={"a": a.url, "b": b.url},
            configured_vaults={"a": VAULT_A, "b": VAULT_B},
            timeout_s=2.0,
        )
        assert_no_edit_issued(a, b)
    assert verdict.ready is False
    assert verdict.reason == constants.IDENTITY_SAME_VAULT


def test_no_edit_is_issued_when_the_vaults_collide():
    a, b = _both_report(VAULT_A)
    with a, b:
        readiness.check_readiness(
            endpoints={"a": a.url, "b": b.url},
            configured_vaults={"a": VAULT_A, "b": VAULT_B},
            timeout_s=2.0,
        )
        assert_no_edit_issued(a, b)


if __name__ == "__main__":
    sys.exit(run_as_script(dict(globals())))
