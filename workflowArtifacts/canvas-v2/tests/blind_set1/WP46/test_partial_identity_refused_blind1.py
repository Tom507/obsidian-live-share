"""WP46 AC3 — partially initialised instance, blind set 1.

Angle: the instance is not merely missing fields, it reports the §6.2 fields
with the wrong *kinds* of value (null vault id, boolean-as-string canvas
surface, empty build). Each of these is "the port answered" and none of them is
a positive identification.
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from _wp46_stub_b1 import (  # noqa: E402
    REFUSAL_REASONS,
    ControlStub,
    assert_untouched,
    info_payload,
    readiness,
    script_main,
)

VAULT_A = "H:\\Developement\\_NeuralAngels\\ObsidianOrga"
VAULT_B = "H:\\Developement\\_NeuralAngels\\ObsidianOrga - Kopie"
ROOM = "canvas-v2-t3"
CONFIGURED = {"a": VAULT_A, "b": VAULT_B}


def _verdict_with(bad_info: dict):
    a = ControlStub(bad_info)
    b = ControlStub(info_payload(VAULT_B, ROOM, clientId="e2e-b"))
    with a, b:
        verdict = readiness.check_readiness(
            endpoints={"a": a.url, "b": b.url}, configured_vaults=CONFIGURED, timeout_s=2.0
        )
        assert_untouched(a, b)
    return verdict


def test_a_null_vault_id_is_not_a_positive_identification():
    verdict = _verdict_with(info_payload(VAULT_A, ROOM, vaultId=None, vaultName=None))
    assert verdict.ready is False
    assert verdict.reason in REFUSAL_REASONS


def test_an_empty_plugin_build_does_not_pass_as_identified():
    verdict = _verdict_with(info_payload("", ROOM, pluginBuild="", canvasSurface=False))
    assert verdict.ready is False
    assert verdict.reason in REFUSAL_REASONS


def test_a_still_booting_instance_with_no_room_yet_is_not_ready():
    verdict = _verdict_with(info_payload("", "", connected=False, canvasSurface=False))
    assert verdict.ready is False
    assert verdict.reason in REFUSAL_REASONS


def test_the_pre_wp46_answer_shape_is_refused():
    """The four legacy fields alone — exactly what a production build answers."""
    verdict = _verdict_with(
        {"clientId": "e2e-a", "role": "host", "roomId": ROOM, "connected": True}
    )
    assert verdict.ready is False
    assert verdict.reason in REFUSAL_REASONS


if __name__ == "__main__":
    sys.exit(script_main(dict(globals())))
