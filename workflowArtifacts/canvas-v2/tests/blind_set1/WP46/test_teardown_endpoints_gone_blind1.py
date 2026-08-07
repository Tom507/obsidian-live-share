"""WP46 AC4 (teardown direction) — blind set 1.

Angle: the teardown check is exercised against ports that were bound and
released, and the inversion is asserted as a pair of opposite verdicts taken in
the *same* world state, one immediately after the other.
"""

from __future__ import annotations

import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from _wp46_stub_b1 import (  # noqa: E402
    ControlStub,
    constants,
    info_payload,
    readiness,
    script_main,
)

VAULT_A = "H:\\Developement\\_NeuralAngels\\ObsidianOrga"
VAULT_B = "H:\\Developement\\_NeuralAngels\\ObsidianOrga - Kopie"
ROOM = "canvas-v2-t3"
CONFIGURED = {"a": VAULT_A, "b": VAULT_B}


def _released_urls() -> dict[str, str]:
    a = ControlStub(info_payload(VAULT_A, ROOM)).open()
    b = ControlStub(info_payload(VAULT_B, ROOM)).open()
    urls = {"a": a.url, "b": b.url}
    a.shut()
    b.shut()
    return urls


def test_released_endpoints_satisfy_the_teardown_check():
    verdict = readiness.check_endpoints_gone(endpoints=_released_urls(), timeout_s=1.0)
    assert verdict.ready is True
    assert verdict.reason is None


def test_the_two_directions_disagree_on_the_same_world():
    urls = _released_urls()
    teardown = readiness.check_endpoints_gone(endpoints=urls, timeout_s=1.0)
    startup = readiness.check_readiness(
        endpoints=urls, configured_vaults=CONFIGURED, timeout_s=1.0
    )
    assert teardown.ready is not startup.ready
    assert teardown.ready is True
    assert startup.reason == constants.READINESS_TIMEOUT


def test_the_teardown_check_is_bounded_too():
    urls = _released_urls()
    t0 = time.monotonic()
    readiness.check_endpoints_gone(endpoints=urls, timeout_s=1.0)
    assert time.monotonic() - t0 < 8.0


def test_a_still_serving_pair_fails_the_teardown_check():
    a = ControlStub(info_payload(VAULT_A, ROOM))
    b = ControlStub(info_payload(VAULT_B, ROOM))
    with a, b:
        verdict = readiness.check_endpoints_gone(
            endpoints={"a": a.url, "b": b.url}, timeout_s=1.0
        )
    assert verdict.ready is False
    assert isinstance(verdict.reason, str) and verdict.reason


if __name__ == "__main__":
    sys.exit(script_main(dict(globals())))
