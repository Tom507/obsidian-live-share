"""WP46 / C46 AC4 (second half) — the same check is reused by teardown to
confirm the endpoints are GONE.

The inverted use is asserted explicitly: two endpoints refusing connections is a
FAILURE for readiness (``READINESS_TIMEOUT``) and a SUCCESS for teardown.

Run:  .venv\\Scripts\\python.exe -m pytest <this file> -v
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from _wp46_endpoint_visible import (  # noqa: E402
    FakeEndpoint,
    constants,
    readiness,
    run_as_script,
    session_info,
)

VAULT_A = "app-id-vault-a"
VAULT_B = "app-id-vault-b"
ROOM = "room-t3"


def _stopped_pair_urls() -> dict[str, str]:
    a = FakeEndpoint(info=session_info(vault_id=VAULT_A, room_id=ROOM))
    b = FakeEndpoint(info=session_info(vault_id=VAULT_B, room_id=ROOM, role="guest"))
    a.start()
    b.start()
    urls = {"a": a.url, "b": b.url}
    a.stop()
    b.stop()
    return urls


def test_both_endpoints_gone_is_a_teardown_success():
    urls = _stopped_pair_urls()
    verdict = readiness.check_endpoints_gone(endpoints=urls, timeout_s=1.0)
    assert verdict.ready is True, "both endpoints refusing IS the teardown success condition"
    assert verdict.reason is None
    assert verdict.identities == {}


def test_the_same_condition_is_a_readiness_failure():
    """Explicit inversion: identical world state, opposite verdicts."""
    urls = _stopped_pair_urls()
    gone = readiness.check_endpoints_gone(endpoints=urls, timeout_s=1.0)
    ready = readiness.check_readiness(
        endpoints=urls,
        configured_vaults={"a": VAULT_A, "b": VAULT_B},
        timeout_s=1.0,
    )
    assert gone.ready is True
    assert ready.ready is False
    assert ready.reason == constants.READINESS_TIMEOUT


def test_a_live_pair_is_not_gone():
    a = FakeEndpoint(info=session_info(vault_id=VAULT_A, room_id=ROOM))
    b = FakeEndpoint(info=session_info(vault_id=VAULT_B, room_id=ROOM, role="guest"))
    with a, b:
        verdict = readiness.check_endpoints_gone(
            endpoints={"a": a.url, "b": b.url}, timeout_s=1.0
        )
    assert verdict.ready is False


def test_the_teardown_check_is_itself_re_runnable():
    urls = _stopped_pair_urls()
    first = readiness.check_endpoints_gone(endpoints=urls, timeout_s=1.0)
    second = readiness.check_endpoints_gone(endpoints=urls, timeout_s=1.0)
    assert first.ready is True and second.ready is True
    assert first.reason == second.reason


if __name__ == "__main__":
    sys.exit(run_as_script(dict(globals())))
