"""WP46 / C46 AC3 — readiness is a POSITIVE assertion: a partially initialised
instance that answers but cannot say which vault it serves is NOT ready.

"It answered" is exactly the weak signal WP46 replaces. A pre-WP46 build answers
``session.info`` perfectly well with the four legacy fields and no identity at
all — that must refuse, under a named reason, with no edit issued.

Run:  .venv\\Scripts\\python.exe -m pytest <this file> -v
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from _wp46_endpoint_visible import (  # noqa: E402
    NAMED_REASONS,
    FakeEndpoint,
    assert_no_edit_issued,
    readiness,
    run_as_script,
    session_info,
)

VAULT_A = "app-id-vault-a"
VAULT_B = "app-id-vault-b"
ROOM = "room-t3"

# Exactly what a pre-WP46 build answers: the four legacy fields, nothing else.
LEGACY_ONLY = {"clientId": "e2e-b", "role": "guest", "roomId": ROOM, "connected": True}


def _check(a: FakeEndpoint, b: FakeEndpoint):
    return readiness.check_readiness(
        endpoints={"a": a.url, "b": b.url},
        configured_vaults={"a": VAULT_A, "b": VAULT_B},
        timeout_s=2.0,
    )


def test_an_endpoint_without_identity_fields_is_not_ready():
    a = FakeEndpoint(info=session_info(vault_id=VAULT_A, room_id=ROOM))
    b = FakeEndpoint(info=dict(LEGACY_ONLY))
    with a, b:
        verdict = _check(a, b)
    assert verdict.ready is False, "an answer without identity must not read as ready"
    assert verdict.reason in NAMED_REASONS, f"unnamed refusal: {verdict.reason!r}"


def test_an_empty_vault_identity_is_not_ready():
    a = FakeEndpoint(info=session_info(vault_id=VAULT_A, room_id=ROOM))
    b = FakeEndpoint(info=session_info(vault_id="", vault_name="", room_id=ROOM, role="guest"))
    with a, b:
        verdict = _check(a, b)
    assert verdict.ready is False
    assert verdict.reason in NAMED_REASONS


def test_a_half_initialised_instance_with_no_canvas_surface_is_not_ready():
    a = FakeEndpoint(info=session_info(vault_id=VAULT_A, room_id=ROOM))
    b = FakeEndpoint(
        info=session_info(
            vault_id="",
            room_id="",
            role="guest",
            connected=False,
            canvas_surface=False,
            plugin_build="",
        )
    )
    with a, b:
        verdict = _check(a, b)
    assert verdict.ready is False
    assert verdict.reason in NAMED_REASONS


def test_a_partially_initialised_instance_receives_no_edit():
    a = FakeEndpoint(info=session_info(vault_id=VAULT_A, room_id=ROOM))
    b = FakeEndpoint(info=dict(LEGACY_ONLY))
    with a, b:
        _check(a, b)
        assert_no_edit_issued(a, b)


if __name__ == "__main__":
    sys.exit(run_as_script(dict(globals())))
