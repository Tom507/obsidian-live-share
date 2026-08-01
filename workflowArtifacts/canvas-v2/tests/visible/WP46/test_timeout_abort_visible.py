"""WP46 / C46 AC2+AC3 — an endpoint that does not answer within the bounded
timeout aborts the run under ``READINESS_TIMEOUT``, and no edit is issued.

The stub accepts the connection and then never answers, so this is a genuine
bounded-wait probe rather than a connection refusal.

Run:  .venv\\Scripts\\python.exe -m pytest <this file> -v
"""

from __future__ import annotations

import pathlib
import sys
import time

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
TIMEOUT_S = 0.3
# The stub holds the request far longer than the bound; an unbounded check would
# take ~30 s, a bounded one returns in well under this ceiling.
BOUND_CEILING_S = 10.0


def test_silent_endpoint_aborts_with_readiness_timeout():
    a = FakeEndpoint(info=session_info(vault_id=VAULT_A, room_id=ROOM))
    b = FakeEndpoint(mode="hang")
    with a, b:
        verdict = readiness.check_readiness(
            endpoints={"a": a.url, "b": b.url},
            configured_vaults={"a": VAULT_A, "b": VAULT_B},
            timeout_s=TIMEOUT_S,
        )
    assert verdict.ready is False
    assert verdict.reason == constants.READINESS_TIMEOUT


def test_the_wait_is_actually_bounded():
    a = FakeEndpoint(info=session_info(vault_id=VAULT_A, room_id=ROOM))
    b = FakeEndpoint(mode="hang")
    with a, b:
        started = time.monotonic()
        verdict = readiness.check_readiness(
            endpoints={"a": a.url, "b": b.url},
            configured_vaults={"a": VAULT_A, "b": VAULT_B},
            timeout_s=TIMEOUT_S,
        )
        elapsed = time.monotonic() - started
    assert verdict.ready is False
    assert elapsed < BOUND_CEILING_S, f"readiness waited {elapsed:.1f}s on a silent endpoint"


def test_no_edit_is_issued_when_readiness_times_out():
    a = FakeEndpoint(info=session_info(vault_id=VAULT_A, room_id=ROOM))
    b = FakeEndpoint(mode="hang")
    with a, b:
        readiness.check_readiness(
            endpoints={"a": a.url, "b": b.url},
            configured_vaults={"a": VAULT_A, "b": VAULT_B},
            timeout_s=TIMEOUT_S,
        )
        assert_no_edit_issued(a, b)


def test_both_endpoints_silent_is_still_a_named_timeout():
    a = FakeEndpoint(mode="hang")
    b = FakeEndpoint(mode="hang")
    with a, b:
        verdict = readiness.check_readiness(
            endpoints={"a": a.url, "b": b.url},
            configured_vaults={"a": VAULT_A, "b": VAULT_B},
            timeout_s=TIMEOUT_S,
        )
        assert_no_edit_issued(a, b)
    assert verdict.ready is False
    assert verdict.reason == constants.READINESS_TIMEOUT
    assert verdict.identities == {} or set(verdict.identities) == set()


if __name__ == "__main__":
    sys.exit(run_as_script(dict(globals())))
