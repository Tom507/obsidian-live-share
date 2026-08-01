"""WP46 / C46 AC4 (first half) — the same check is re-runnable mid-run.

Calling it twice against a healthy pair is safe, re-probes rather than caching,
returns the same verdict, and still issues no edit.

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
    a = FakeEndpoint(info=session_info(vault_id=VAULT_A, room_id=ROOM, client_id="e2e-a"))
    b = FakeEndpoint(
        info=session_info(vault_id=VAULT_B, room_id=ROOM, client_id="e2e-b", role="guest")
    )
    return a, b


def _check(a: FakeEndpoint, b: FakeEndpoint):
    return readiness.check_readiness(
        endpoints={"a": a.url, "b": b.url},
        configured_vaults={"a": VAULT_A, "b": VAULT_B},
        timeout_s=2.0,
    )


def test_a_second_call_on_a_healthy_pair_returns_the_same_verdict():
    a, b = _pair()
    with a, b:
        first = _check(a, b)
        second = _check(a, b)
    assert first.ready is True and second.ready is True
    assert first.reason == second.reason
    assert first.identities == second.identities


def test_the_second_call_really_re_probes_rather_than_caching():
    a, b = _pair()
    with a, b:
        _check(a, b)
        after_first = len(a.commands)
        _check(a, b)
        after_second = len(a.commands)
    assert after_first >= 1
    assert after_second > after_first, "a mid-run re-check must ask the endpoints again"


def test_repeated_checks_still_issue_no_edit():
    a, b = _pair()
    with a, b:
        for _ in range(3):
            _check(a, b)
        assert_no_edit_issued(a, b)


def test_a_pair_that_degrades_mid_run_is_caught_by_the_same_check():
    """The point of re-runnability: the verdict follows reality, not the first call."""
    a, b = _pair()
    with a:
        b.start()
        try:
            assert _check(a, b).ready is True
        finally:
            b.stop()
        after = _check(a, b)
    assert after.ready is False
    assert after.reason is not None


if __name__ == "__main__":
    sys.exit(run_as_script(dict(globals())))
