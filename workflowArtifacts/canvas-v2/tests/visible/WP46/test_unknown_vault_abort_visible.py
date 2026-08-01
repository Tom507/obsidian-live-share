"""WP46 / C46 AC3 — an endpoint reporting a vault that is not one of the two
configured vaults aborts under ``IDENTITY_UNKNOWN_VAULT``.

This is the "never drive a vault nobody intended" leg of the DoD: the answering
instance is healthy and well formed, it is simply the wrong vault.

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
VAULT_STRANGER = "app-id-vault-personal-notes"
ROOM = "room-t3"


def _check(a: FakeEndpoint, b: FakeEndpoint):
    return readiness.check_readiness(
        endpoints={"a": a.url, "b": b.url},
        configured_vaults={"a": VAULT_A, "b": VAULT_B},
        timeout_s=2.0,
    )


def test_a_third_vault_aborts_with_identity_unknown_vault():
    a = FakeEndpoint(info=session_info(vault_id=VAULT_A, room_id=ROOM))
    b = FakeEndpoint(
        info=session_info(
            vault_id=VAULT_STRANGER,
            vault_name="PersonalNotes",
            room_id=ROOM,
            role="guest",
        )
    )
    with a, b:
        verdict = _check(a, b)
    assert verdict.ready is False
    assert verdict.reason == constants.IDENTITY_UNKNOWN_VAULT


def test_an_unknown_vault_outranks_the_distinctness_check():
    """Two unknown vaults are distinct — but still nobody's intended vaults."""
    a = FakeEndpoint(info=session_info(vault_id="app-id-stranger-1", room_id=ROOM))
    b = FakeEndpoint(info=session_info(vault_id="app-id-stranger-2", room_id=ROOM, role="guest"))
    with a, b:
        verdict = _check(a, b)
    assert verdict.ready is False
    assert verdict.reason == constants.IDENTITY_UNKNOWN_VAULT


def test_vault_identity_is_matched_exactly_not_by_name_similarity():
    a = FakeEndpoint(info=session_info(vault_id=VAULT_A, room_id=ROOM))
    b = FakeEndpoint(
        info=session_info(
            vault_id=VAULT_B + "-backup",
            vault_name="ObsidianOrga - Kopie",
            room_id=ROOM,
            role="guest",
        )
    )
    with a, b:
        verdict = _check(a, b)
    assert verdict.ready is False
    assert verdict.reason == constants.IDENTITY_UNKNOWN_VAULT


def test_no_edit_is_issued_towards_an_unintended_vault():
    a = FakeEndpoint(info=session_info(vault_id=VAULT_A, room_id=ROOM))
    b = FakeEndpoint(info=session_info(vault_id=VAULT_STRANGER, room_id=ROOM, role="guest"))
    with a, b:
        _check(a, b)
        assert_no_edit_issued(a, b)


if __name__ == "__main__":
    sys.exit(run_as_script(dict(globals())))
