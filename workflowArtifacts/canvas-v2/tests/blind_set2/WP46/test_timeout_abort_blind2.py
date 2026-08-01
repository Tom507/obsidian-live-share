"""WP46 AC2/AC3 — bounded timeout, blind set 2.

Angle: the muted endpoint is compared against a *slow but answering* endpoint —
the check must not confuse "slow" with "absent", and must still be bounded when
both sides are mute.
"""

from __future__ import annotations

import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from _wp46_stub_b2 import (  # noqa: E402
    StubEndpoint,
    as_script,
    assert_only_probed,
    constants,
    make_info,
    readiness,
)

VAULT_A = "0f9d3c11-2b7e-4a05-9c31-6d8e2f4a1b00"
VAULT_B = "5a1e77c4-8f02-4d6b-b3aa-91c07e5d2f38"
ROOM = "raum-üben-42"
CONFIGURED = {"a": VAULT_A, "b": VAULT_B}


def _healthy(vault: str, client: str) -> StubEndpoint:
    return StubEndpoint(
        make_info(
            clientId=client,
            role="host" if client.endswith("a") else "guest",
            roomId=ROOM,
            connected=True,
            vaultId=vault,
            vaultName=vault[:8],
            canvasSurface=True,
        )
    )


def _check(a: StubEndpoint, b: StubEndpoint, timeout_s: float):
    return readiness.check_readiness(
        endpoints={"a": a.url, "b": b.url}, configured_vaults=CONFIGURED, timeout_s=timeout_s
    )


def test_a_muted_endpoint_produces_readiness_timeout():
    a = _healthy(VAULT_A, "e2e-a")
    b = StubEndpoint(kind="mute", mute_for_s=20.0)
    with a, b:
        verdict = _check(a, b, 0.4)
    assert verdict.ready is False
    assert verdict.reason == constants.READINESS_TIMEOUT


def test_a_slow_endpoint_that_does_answer_within_the_bound_is_ready():
    """Boundedness must not turn into impatience."""
    a = _healthy(VAULT_A, "e2e-a")
    b = _healthy(VAULT_B, "e2e-b")
    with a, b:
        verdict = _check(a, b, 5.0)
    assert verdict.ready is True
    assert verdict.reason is None


def test_both_sides_mute_is_still_bounded_and_named():
    a = StubEndpoint(kind="mute", mute_for_s=20.0)
    b = StubEndpoint(kind="mute", mute_for_s=20.0)
    with a, b:
        started = time.monotonic()
        verdict = _check(a, b, 0.4)
        elapsed = time.monotonic() - started
    assert elapsed < 10.0, f"both-mute case waited {elapsed:.1f}s"
    assert verdict.ready is False
    assert verdict.reason == constants.READINESS_TIMEOUT


def test_a_timeout_never_escalates_to_an_edit():
    a = _healthy(VAULT_A, "e2e-a")
    b = StubEndpoint(kind="mute", mute_for_s=20.0)
    with a, b:
        _check(a, b, 0.4)
        assert_only_probed(a, b)


if __name__ == "__main__":
    sys.exit(as_script(dict(globals())))
