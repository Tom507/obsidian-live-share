"""WP46 AC2 — same-vault refusal, blind set 1.

Angle: the collision is on vault B (the copy) rather than vault A, the two
endpoints differ in every other reported field, and the refusal is asserted to
be the same whichever way round the endpoints map is built.
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from _wp46_stub_b1 import (  # noqa: E402
    ControlStub,
    assert_untouched,
    constants,
    info_payload,
    readiness,
    script_main,
)

VAULT_A = "H:\\Developement\\_NeuralAngels\\ObsidianOrga"
VAULT_B = "H:\\Developement\\_NeuralAngels\\ObsidianOrga - Kopie"
ROOM = "canvas-v2-t3"
CONFIGURED = {"a": VAULT_A, "b": VAULT_B}


def _colliding_pair():
    a = ControlStub(
        info_payload(VAULT_B, ROOM, clientId="e2e-a", role="host", pluginBuild="1.4.2+e2e")
    )
    b = ControlStub(
        info_payload(VAULT_B, ROOM, clientId="e2e-b", role="guest", pluginBuild="1.4.3+e2e")
    )
    return a, b


def test_one_vault_answering_twice_is_refused():
    a, b = _colliding_pair()
    with a, b:
        verdict = readiness.check_readiness(
            endpoints={"a": a.url, "b": b.url}, configured_vaults=CONFIGURED, timeout_s=2.0
        )
    assert verdict.ready is False
    assert verdict.reason == constants.IDENTITY_SAME_VAULT


def test_the_refusal_does_not_depend_on_which_role_is_listed_first():
    a, b = _colliding_pair()
    with a, b:
        forward = readiness.check_readiness(
            endpoints={"a": a.url, "b": b.url}, configured_vaults=CONFIGURED, timeout_s=2.0
        )
        reverse = readiness.check_readiness(
            endpoints={"b": b.url, "a": a.url}, configured_vaults=CONFIGURED, timeout_s=2.0
        )
    assert forward.reason == reverse.reason == constants.IDENTITY_SAME_VAULT


def test_differing_builds_and_client_ids_do_not_make_two_vaults():
    a, b = _colliding_pair()
    with a, b:
        verdict = readiness.check_readiness(
            endpoints={"a": a.url, "b": b.url}, configured_vaults=CONFIGURED, timeout_s=2.0
        )
    assert verdict.ready is False
    assert verdict.reason != constants.IDENTITY_UNKNOWN_VAULT


def test_a_colliding_pair_receives_no_write_command():
    a, b = _colliding_pair()
    with a, b:
        readiness.check_readiness(
            endpoints={"a": a.url, "b": b.url}, configured_vaults=CONFIGURED, timeout_s=2.0
        )
        assert_untouched(a, b)


if __name__ == "__main__":
    sys.exit(script_main(dict(globals())))
