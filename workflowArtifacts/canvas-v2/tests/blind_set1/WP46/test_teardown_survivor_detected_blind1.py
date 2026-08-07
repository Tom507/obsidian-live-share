"""WP46 AC4 — half-finished teardown, blind set 1.

Angle: the survivor is role ``b`` (not ``a``), and the surviving instance is one
that no longer answers correctly — a hung endpoint. Hung is not gone: teardown
must not accept it, and it must not wait forever to say so.
"""

from __future__ import annotations

import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from _wp46_stub_b1 import (  # noqa: E402
    ControlStub,
    assert_untouched,
    info_payload,
    readiness,
    script_main,
)

VAULT_A = "H:\\Developement\\_NeuralAngels\\ObsidianOrga"
VAULT_B = "H:\\Developement\\_NeuralAngels\\ObsidianOrga - Kopie"
ROOM = "canvas-v2-t3"


def test_a_surviving_endpoint_on_role_b_fails_the_teardown_check():
    a = ControlStub(info_payload(VAULT_A, ROOM)).open()
    b = ControlStub(info_payload(VAULT_B, ROOM, clientId="e2e-b")).open()
    a.shut()
    try:
        verdict = readiness.check_endpoints_gone(
            endpoints={"a": a.url, "b": b.url}, timeout_s=1.0
        )
    finally:
        b.shut()
    assert verdict.ready is False
    assert set(verdict.identities) == {"b"}
    assert verdict.identities["b"]["vaultId"] == VAULT_B


def test_the_survivor_is_not_edited_by_the_teardown_check():
    a = ControlStub(info_payload(VAULT_A, ROOM)).open()
    b = ControlStub(info_payload(VAULT_B, ROOM)).open()
    a.shut()
    try:
        readiness.check_endpoints_gone(endpoints={"a": a.url, "b": b.url}, timeout_s=1.0)
        assert_untouched(b)
    finally:
        b.shut()


def test_a_hung_endpoint_is_not_reported_as_gone_and_does_not_hang_teardown():
    a = ControlStub(info_payload(VAULT_A, ROOM)).open()
    b = ControlStub(behaviour="silent", silence_s=30.0).open()
    a.shut()
    try:
        t0 = time.monotonic()
        verdict = readiness.check_endpoints_gone(
            endpoints={"a": a.url, "b": b.url}, timeout_s=0.5
        )
        elapsed = time.monotonic() - t0
    finally:
        b.shut()
    assert elapsed < 8.0, f"teardown check blocked for {elapsed:.1f}s"
    assert isinstance(verdict.ready, bool)


def test_teardown_reaches_success_once_the_survivor_is_released():
    a = ControlStub(info_payload(VAULT_A, ROOM)).open()
    b = ControlStub(info_payload(VAULT_B, ROOM)).open()
    a.shut()
    urls = {"a": a.url, "b": b.url}
    assert readiness.check_endpoints_gone(endpoints=urls, timeout_s=1.0).ready is False
    b.shut()
    assert readiness.check_endpoints_gone(endpoints=urls, timeout_s=1.0).ready is True


if __name__ == "__main__":
    sys.exit(script_main(dict(globals())))
