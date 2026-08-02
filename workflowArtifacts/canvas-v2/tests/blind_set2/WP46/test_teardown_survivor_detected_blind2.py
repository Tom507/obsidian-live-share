"""WP46 AC4 — half-finished teardown, blind set 2.

Angle: both endpoints survive (nothing was torn down at all), and a survivor
that answers with a broken body still counts as present — "gone" means the port
does not answer, not that the answer was unusable.
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from _wp46_stub_b2 import (  # noqa: E402
    StubEndpoint,
    as_script,
    assert_only_probed,
    make_info,
    readiness,
)

VAULT_A = "0f9d3c11-2b7e-4a05-9c31-6d8e2f4a1b00"
VAULT_B = "5a1e77c4-8f02-4d6b-b3aa-91c07e5d2f38"
ROOM = "raum-üben-42"


def _healthy(vault: str, client: str) -> StubEndpoint:
    return StubEndpoint(
        make_info(
            clientId=client,
            role="host",
            roomId=ROOM,
            connected=True,
            vaultId=vault,
            vaultName=vault[:8],
            canvasSurface=True,
        )
    )


def test_nothing_torn_down_is_not_a_clean_teardown():
    a = _healthy(VAULT_A, "e2e-a")
    b = _healthy(VAULT_B, "e2e-b")
    with a, b:
        verdict = readiness.check_endpoints_gone(
            endpoints={"a": a.url, "b": b.url}, timeout_s=1.0
        )
        assert_only_probed(a, b)
    assert verdict.ready is False
    assert isinstance(verdict.reason, str) and verdict.reason
    assert set(verdict.identities) == {"a", "b"}


def test_a_survivor_with_a_broken_body_still_counts_as_present():
    a = StubEndpoint(kind="verbatim", http_status=200, payload=b"garbage")
    b = _healthy(VAULT_B, "e2e-b")
    b.up()
    b.down()
    with a:
        verdict = readiness.check_endpoints_gone(
            endpoints={"a": a.url, "b": b.url}, timeout_s=1.0
        )
    assert verdict.ready is False, "a port that answers at all has not gone away"


def test_teardown_succeeds_only_after_both_are_down():
    a = _healthy(VAULT_A, "e2e-a").up()
    b = _healthy(VAULT_B, "e2e-b").up()
    urls = {"a": a.url, "b": b.url}
    try:
        assert readiness.check_endpoints_gone(endpoints=urls, timeout_s=1.0).ready is False
        a.down()
        assert readiness.check_endpoints_gone(endpoints=urls, timeout_s=1.0).ready is False
    finally:
        b.down()
    assert readiness.check_endpoints_gone(endpoints=urls, timeout_s=1.0).ready is True


def test_the_survivor_check_sends_no_state_changing_command():
    a = _healthy(VAULT_A, "e2e-a")
    b = _healthy(VAULT_B, "e2e-b")
    with a, b:
        readiness.check_endpoints_gone(endpoints={"a": a.url, "b": b.url}, timeout_s=1.0)
        assert_only_probed(a, b)


if __name__ == "__main__":
    sys.exit(as_script(dict(globals())))
