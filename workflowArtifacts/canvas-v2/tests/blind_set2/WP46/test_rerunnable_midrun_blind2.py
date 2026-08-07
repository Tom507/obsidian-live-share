"""WP46 AC4 (re-runnability) — blind set 2.

Angle: the check is re-run around a simulated mid-run failure and recovery in
the *vault identity* rather than the room, and the probe count is asserted to
grow strictly monotonically — a cached verdict would not.
"""

from __future__ import annotations

import pathlib
import sys

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


def _info(vault: str, client: str, role: str) -> dict:
    return make_info(
        clientId=client,
        role=role,
        roomId=ROOM,
        connected=True,
        vaultId=vault,
        vaultName=vault[:8],
        canvasSurface=True,
    )


def _pair():
    return (
        StubEndpoint(_info(VAULT_A, "e2e-a", "host")),
        StubEndpoint(_info(VAULT_B, "e2e-b", "guest")),
    )


def _check(a: StubEndpoint, b: StubEndpoint):
    return readiness.check_readiness(
        endpoints={"a": a.url, "b": b.url}, configured_vaults=CONFIGURED, timeout_s=2.0
    )


def test_probe_count_grows_with_every_re_run():
    a, b = _pair()
    with a, b:
        counts = []
        for _ in range(4):
            _check(a, b)
            counts.append(len(b.notes))
    assert counts == sorted(counts)
    assert counts[-1] > counts[0], "a re-check must re-probe"


def test_a_vault_identity_that_changes_mid_run_is_caught():
    a, b = _pair()
    with a, b:
        assert _check(a, b).ready is True
        b.info = _info(VAULT_A, "e2e-b", "guest")  # b now claims A's vault
        second = _check(a, b)
    assert second.ready is False
    assert second.reason == constants.IDENTITY_SAME_VAULT


def test_the_verdict_recovers_when_the_instance_does():
    a, b = _pair()
    with a, b:
        good = dict(b.info)
        b.info = _info("cccccccc-0000-0000-0000-000000000000", "e2e-b", "guest")
        assert _check(a, b).reason == constants.IDENTITY_UNKNOWN_VAULT
        b.info = good
        recovered = _check(a, b)
    assert recovered.ready is True
    assert recovered.reason is None


def test_no_re_run_ever_sends_more_than_the_probe():
    a, b = _pair()
    with a, b:
        for _ in range(4):
            _check(a, b)
        assert_only_probed(a, b)


if __name__ == "__main__":
    sys.exit(as_script(dict(globals())))
