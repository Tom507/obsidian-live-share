"""WP46 / C46 AC2 — two endpoints reporting DIFFERENT rooms abort the run under
``ROOM_MISMATCH``, and no edit is issued.

Two correctly separated vaults that are not in the same room would produce a
silent non-convergence that looks exactly like a sync bug. Readiness names it
before the first edit.

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


def _rooms(room_a: str, room_b: str):
    a = FakeEndpoint(info=session_info(vault_id=VAULT_A, room_id=room_a, client_id="e2e-a"))
    b = FakeEndpoint(
        info=session_info(vault_id=VAULT_B, room_id=room_b, client_id="e2e-b", role="guest")
    )
    return a, b


def _check(a: FakeEndpoint, b: FakeEndpoint):
    return readiness.check_readiness(
        endpoints={"a": a.url, "b": b.url},
        configured_vaults={"a": VAULT_A, "b": VAULT_B},
        timeout_s=2.0,
    )


def test_different_rooms_abort_with_room_mismatch():
    a, b = _rooms("room-t3", "room-other")
    with a, b:
        verdict = _check(a, b)
    assert verdict.ready is False
    assert verdict.reason == constants.ROOM_MISMATCH


def test_an_empty_room_on_one_side_is_still_a_mismatch():
    a, b = _rooms("room-t3", "")
    with a, b:
        verdict = _check(a, b)
    assert verdict.ready is False
    assert verdict.reason != constants.IDENTITY_SAME_VAULT
    assert verdict.reason is not None


def test_room_comparison_is_exact_not_prefix_based():
    a, b = _rooms("room-t3", "room-t3-guest")
    with a, b:
        verdict = _check(a, b)
    assert verdict.ready is False
    assert verdict.reason == constants.ROOM_MISMATCH


def test_no_edit_is_issued_when_the_rooms_differ():
    a, b = _rooms("room-t3", "room-other")
    with a, b:
        _check(a, b)
        assert_no_edit_issued(a, b)


if __name__ == "__main__":
    sys.exit(run_as_script(dict(globals())))
