"""WP46 AC3 — HTTP 200 with an unusable body, blind set 2.

Angle: bodies that carry a *plausible* identity in the wrong place — the
identity at the envelope level instead of inside ``result``, an HTML login page
served with 200, and a JSON null result. None of them is a positive
identification.
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from _wp46_stub_b2 import (  # noqa: E402
    REASONS,
    StubEndpoint,
    as_script,
    assert_only_probed,
    make_info,
    readiness,
)

VAULT_A = "0f9d3c11-2b7e-4a05-9c31-6d8e2f4a1b00"
VAULT_B = "5a1e77c4-8f02-4d6b-b3aa-91c07e5d2f38"
ROOM = "raum-üben-42"
CONFIGURED = {"a": VAULT_A, "b": VAULT_B}


def _verdict(payload: bytes, http_status: int = 200):
    a = StubEndpoint(
        make_info(
            clientId="e2e-a",
            role="host",
            roomId=ROOM,
            connected=True,
            vaultId=VAULT_A,
            vaultName="Wissen Örga",
            canvasSurface=True,
        )
    )
    b = StubEndpoint(kind="verbatim", http_status=http_status, payload=payload)
    with a, b:
        out = readiness.check_readiness(
            endpoints={"a": a.url, "b": b.url}, configured_vaults=CONFIGURED, timeout_s=2.0
        )
        assert_only_probed(a, b)
    return out


def test_an_identity_at_the_envelope_level_is_not_accepted():
    body = ('{"ok": true, "vaultId": "%s", "roomId": "%s"}' % (VAULT_B, ROOM)).encode()
    verdict = _verdict(body)
    assert verdict.ready is False
    assert verdict.reason in REASONS


def test_a_null_result_is_not_accepted():
    verdict = _verdict(b'{"ok": true, "result": null}')
    assert verdict.ready is False
    assert verdict.reason in REASONS


def test_an_html_page_served_with_200_is_not_accepted():
    verdict = _verdict(b"<!doctype html><html><body>Sign in</body></html>")
    assert verdict.ready is False
    assert verdict.reason in REASONS


def test_a_500_carrying_a_perfect_identity_is_not_accepted():
    body = (
        '{"ok": true, "result": {"vaultId": "%s", "roomId": "%s", "vaultName": "x",'
        ' "vaultPath": null, "pluginBuild": "1.0+e2e", "canvasSurface": true,'
        ' "clientId": "e2e-b", "role": "guest", "connected": true}}' % (VAULT_B, ROOM)
    ).encode()
    verdict = _verdict(body, http_status=500)
    assert verdict.ready is False
    assert verdict.reason in REASONS


def test_binary_noise_is_not_accepted():
    verdict = _verdict(b"\x00\x01\x02\xff\xfe")
    assert verdict.ready is False
    assert verdict.reason in REASONS


if __name__ == "__main__":
    sys.exit(as_script(dict(globals())))
