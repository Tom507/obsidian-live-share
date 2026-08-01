"""WP46 AC3 — unknown vault, blind set 1.

Angle: the stranger vault is a plausible near-miss of a configured one (parent
folder, trailing separator, short-path form). Each must still be refused: a
vault identity is matched, not guessed at.
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


def _verdict_for(stranger: str):
    a = ControlStub(info_payload(VAULT_A, ROOM, clientId="e2e-a"))
    b = ControlStub(info_payload(stranger, ROOM, clientId="e2e-b"))
    with a, b:
        verdict = readiness.check_readiness(
            endpoints={"a": a.url, "b": b.url}, configured_vaults=CONFIGURED, timeout_s=2.0
        )
        assert_untouched(a, b)
    return verdict


def test_the_parent_folder_is_not_a_configured_vault():
    verdict = _verdict_for("H:\\Developement\\_NeuralAngels")
    assert verdict.ready is False
    assert verdict.reason == constants.IDENTITY_UNKNOWN_VAULT


def test_a_trailing_separator_form_is_not_a_configured_vault():
    verdict = _verdict_for(VAULT_B + "\\")
    assert verdict.ready is False
    assert verdict.reason == constants.IDENTITY_UNKNOWN_VAULT


def test_a_nested_subfolder_is_not_a_configured_vault():
    verdict = _verdict_for(VAULT_A + "\\Archive")
    assert verdict.ready is False
    assert verdict.reason == constants.IDENTITY_UNKNOWN_VAULT


def test_an_unrelated_third_vault_is_refused_and_no_edit_is_issued():
    verdict = _verdict_for("C:\\Users\\tschm\\Documents\\PrivateVault")
    assert verdict.ready is False
    assert verdict.reason == constants.IDENTITY_UNKNOWN_VAULT


if __name__ == "__main__":
    sys.exit(script_main(dict(globals())))
