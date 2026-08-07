"""WP46 / C46 AC4 — a teardown that leaves one endpoint alive is NOT a clean
teardown, and the surviving instance is named.

A half-torn-down run is exactly the state that lets the next run attach to a
stale instance and drive the wrong vault, so "one of two gone" must never round
up to success.

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


def _survivor_a():
    a = FakeEndpoint(info=session_info(vault_id=VAULT_A, room_id=ROOM))
    b = FakeEndpoint(info=session_info(vault_id=VAULT_B, room_id=ROOM, role="guest"))
    a.start()
    b.start()
    b.stop()
    return a, {"a": a.url, "b": b.url}


def test_one_surviving_endpoint_fails_the_teardown_check():
    a, urls = _survivor_a()
    try:
        verdict = readiness.check_endpoints_gone(endpoints=urls, timeout_s=1.0)
    finally:
        a.stop()
    assert verdict.ready is False, "one live endpoint must not round up to 'gone'"
    assert isinstance(verdict.reason, str) and verdict.reason, "the refusal must be named"


def test_the_surviving_instance_is_identified():
    a, urls = _survivor_a()
    try:
        verdict = readiness.check_endpoints_gone(endpoints=urls, timeout_s=1.0)
    finally:
        a.stop()
    assert set(verdict.identities) == {"a"}
    assert verdict.identities["a"]["vaultId"] == VAULT_A


def test_the_teardown_check_issues_no_edit_to_the_survivor():
    a, urls = _survivor_a()
    try:
        readiness.check_endpoints_gone(endpoints=urls, timeout_s=1.0)
        assert_no_edit_issued(a)
    finally:
        a.stop()


def test_teardown_converges_once_the_survivor_is_stopped():
    a, urls = _survivor_a()
    assert readiness.check_endpoints_gone(endpoints=urls, timeout_s=1.0).ready is False
    a.stop()
    assert readiness.check_endpoints_gone(endpoints=urls, timeout_s=1.0).ready is True


if __name__ == "__main__":
    sys.exit(run_as_script(dict(globals())))
