"""WP46 / C46 AC3 — an HTTP 200 with a body readiness cannot understand must
never read as ready.

HTTP status is a transport signal, not an identity. A proxy page, a truncated
body or a protocol-level ``ok: false`` all arrive as "the port answered" — the
exact weak signal WP46 exists to replace.

Run:  .venv\\Scripts\\python.exe -m pytest <this file> -v
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from _wp46_endpoint_visible import (  # noqa: E402
    NAMED_REASONS,
    FakeEndpoint,
    assert_no_edit_issued,
    readiness,
    run_as_script,
    session_info,
)

VAULT_A = "app-id-vault-a"
VAULT_B = "app-id-vault-b"
ROOM = "room-t3"


def _check_against(b: FakeEndpoint):
    a = FakeEndpoint(info=session_info(vault_id=VAULT_A, room_id=ROOM))
    with a, b:
        verdict = readiness.check_readiness(
            endpoints={"a": a.url, "b": b.url},
            configured_vaults={"a": VAULT_A, "b": VAULT_B},
            timeout_s=2.0,
        )
        assert_no_edit_issued(a, b)
    return verdict


def test_http_200_with_a_non_json_body_is_not_ready():
    verdict = _check_against(
        FakeEndpoint(mode="raw", status=200, raw_body=b"<html>not the plugin</html>")
    )
    assert verdict.ready is False
    assert verdict.reason in NAMED_REASONS


def test_http_200_with_an_envelope_but_no_result_is_not_ready():
    verdict = _check_against(FakeEndpoint(mode="raw", status=200, raw_body=b'{"ok": true}'))
    assert verdict.ready is False
    assert verdict.reason in NAMED_REASONS


def test_http_200_with_a_truncated_json_body_is_not_ready():
    verdict = _check_against(
        FakeEndpoint(mode="raw", status=200, raw_body=b'{"ok": true, "result": {"vaultId"')
    )
    assert verdict.ready is False
    assert verdict.reason in NAMED_REASONS


def test_a_protocol_level_refusal_is_not_ready():
    verdict = _check_against(FakeEndpoint(mode="error"))
    assert verdict.ready is False
    assert verdict.reason in NAMED_REASONS


def test_a_result_that_is_not_an_object_is_not_ready():
    verdict = _check_against(
        FakeEndpoint(mode="raw", status=200, raw_body=b'{"ok": true, "result": "ready"}')
    )
    assert verdict.ready is False
    assert verdict.reason in NAMED_REASONS


if __name__ == "__main__":
    sys.exit(run_as_script(dict(globals())))
