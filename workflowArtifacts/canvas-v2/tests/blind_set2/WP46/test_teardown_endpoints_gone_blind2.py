"""WP46 AC4 (teardown direction) — blind set 2.

Angle: the "gone" state is produced two different ways — a released port and a
port that was never served at all — and both must read as a teardown success,
while the readiness direction refuses both.
"""

from __future__ import annotations

import pathlib
import socket
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from _wp46_stub_b2 import (  # noqa: E402
    StubEndpoint,
    as_script,
    constants,
    make_info,
    readiness,
)

VAULT_A = "0f9d3c11-2b7e-4a05-9c31-6d8e2f4a1b00"
VAULT_B = "5a1e77c4-8f02-4d6b-b3aa-91c07e5d2f38"
ROOM = "raum-üben-42"
CONFIGURED = {"a": VAULT_A, "b": VAULT_B}


def _never_served_url() -> str:
    """Bind an ephemeral port, read it back, release it — nothing ever listens."""
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    assert port not in (constants.REAL_CONTROL_PORT_A, constants.REAL_CONTROL_PORT_B)
    return f"http://127.0.0.1:{port}"


def _released_url() -> str:
    stub = StubEndpoint(make_info(vaultId=VAULT_A, roomId=ROOM)).up()
    url = stub.url
    stub.down()
    return url


def test_released_endpoints_read_as_gone():
    urls = {"a": _released_url(), "b": _released_url()}
    verdict = readiness.check_endpoints_gone(endpoints=urls, timeout_s=1.0)
    assert verdict.ready is True
    assert verdict.reason is None


def test_ports_that_never_served_read_as_gone():
    urls = {"a": _never_served_url(), "b": _never_served_url()}
    verdict = readiness.check_endpoints_gone(endpoints=urls, timeout_s=1.0)
    assert verdict.ready is True


def test_the_readiness_direction_refuses_the_same_state():
    urls = {"a": _released_url(), "b": _never_served_url()}
    assert readiness.check_endpoints_gone(endpoints=urls, timeout_s=1.0).ready is True
    startup = readiness.check_readiness(
        endpoints=urls, configured_vaults=CONFIGURED, timeout_s=1.0
    )
    assert startup.ready is False
    assert startup.reason == constants.READINESS_TIMEOUT


def test_gone_carries_no_identities():
    urls = {"a": _never_served_url(), "b": _never_served_url()}
    verdict = readiness.check_endpoints_gone(endpoints=urls, timeout_s=1.0)
    assert not verdict.identities


if __name__ == "__main__":
    sys.exit(as_script(dict(globals())))
