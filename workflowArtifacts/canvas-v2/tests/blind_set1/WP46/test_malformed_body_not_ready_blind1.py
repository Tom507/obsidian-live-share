"""WP46 AC3 — HTTP 200 with an unusable body, blind set 1.

Angle: bodies that are *almost* right — a JSON array, a nested envelope, an
empty body with a 200, and a body whose result is the string "ok". A status
code is not an identity.
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


def _verdict_for(blob: bytes, code: int = 200):
    a = ControlStub(behaviour="bytes", code=code, blob=blob)
    b = ControlStub(info_payload(VAULT_B, ROOM, clientId="e2e-b"))
    with a, b:
        verdict = readiness.check_readiness(
            endpoints={"a": a.url, "b": b.url}, configured_vaults=CONFIGURED, timeout_s=2.0
        )
        assert_untouched(a, b)
    return verdict


def test_a_json_array_body_is_not_ready():
    verdict = _verdict_for(b'[{"vaultId": "H:\\\\Developement"}]')
    assert verdict.ready is False
    assert verdict.reason in REFUSAL_REASONS


def test_an_empty_200_body_is_not_ready():
    verdict = _verdict_for(b"")
    assert verdict.ready is False
    assert verdict.reason in REFUSAL_REASONS


def test_a_double_wrapped_envelope_is_not_ready():
    verdict = _verdict_for(b'{"ok": true, "result": {"ok": true, "result": {}}}')
    assert verdict.ready is False
    assert verdict.reason in REFUSAL_REASONS


def test_a_200_carrying_a_plain_string_result_is_not_ready():
    verdict = _verdict_for(b'{"ok": true, "result": "ok"}')
    assert verdict.ready is False
    assert verdict.reason in REFUSAL_REASONS


def test_a_204_style_empty_answer_is_not_ready():
    verdict = _verdict_for(b"", code=204)
    assert verdict.ready is False
    assert verdict.reason in REFUSAL_REASONS


if __name__ == "__main__":
    sys.exit(script_main(dict(globals())))
