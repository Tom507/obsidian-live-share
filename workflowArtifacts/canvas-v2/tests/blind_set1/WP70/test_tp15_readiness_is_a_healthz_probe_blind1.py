# WP70 / AC3 — blind counterpart 1 for "readiness is a positive GET /healthz `ok` probe,
# bounded, naming the awaited condition on expiry; no sleep is used as a wait".
#
# Different angle: the probe FAILS rather than answers. "Node binds late; a spawn that
# returned tells you nothing" — so a connection refused, a socket timeout and a malformed
# body are all "not ready yet", not run-ending errors, and the loop must keep asking. The
# readiness verdict is still the body's own `ok`.
#
# DATA SAFETY: no socket is opened and no process is started; every probe is injected.

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# --- repo bootstrap (T3_SharedContract §0.2) --------------------------------------
for _parent in Path(__file__).resolve().parents:
    if (_parent / "tools").is_dir() and (_parent / "plugin").is_dir():
        _TOOLS = _parent / "tools"
        break
else:  # pragma: no cover
    raise RuntimeError(f"obsidian-live-share repo root not found from {__file__}")
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, relay  # noqa: E402

RUN_ID = "20260803T235959Z-23-334455"
HEALTHY = {"ok": True, "uptime": 0.2, "sessions": 0, "documents": 0, "clients": 0}


class Clock:
    def __init__(self) -> None:
        self.now = 100.0
        self.slept: list = []

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds


def build(tmp_path: Path, responses):
    console = relay.RelayPlanConsole()
    repo_root = tmp_path / "repo"
    (repo_root / constants.RELAY_ENTRY_REL).parent.mkdir(parents=True, exist_ok=True)
    (repo_root / constants.RELAY_ENTRY_REL).write_bytes(b"// built\n")
    clock = Clock()
    calls = {"n": 0}

    def health_probe(base_url: str):
        index = min(calls["n"], len(responses) - 1)
        calls["n"] += 1
        answer = responses[index]
        if isinstance(answer, BaseException):
            raise answer
        return answer

    local = relay.LocalRelay(
        console=console,
        repo_root=repo_root,
        run_id=RUN_ID,
        store_root=tmp_path / "stores",
        port_probe=lambda host, port: False,
        health_probe=health_probe,
        room_minter=lambda url, name: {"id": "r", "token": "SENTINEL-TOKEN"},
        clock=clock,
        sleeper=clock.sleep,
    )
    return local, clock, calls


def test_a_connection_refused_is_not_ready_yet_and_not_an_error(tmp_path: Path) -> None:
    local, _clock, calls = build(
        tmp_path,
        [ConnectionRefusedError("node has not bound yet"), ConnectionRefusedError("still not"), HEALTHY],
    )
    local.start()
    body = local.wait_ready(timeout_s=30.0)
    assert body["ok"] is True
    assert calls["n"] == 3


def test_a_socket_timeout_is_not_ready_yet_and_not_an_error(tmp_path: Path) -> None:
    local, _clock, calls = build(tmp_path, [TimeoutError("probe timed out"), HEALTHY])
    local.start()
    assert local.wait_ready(timeout_s=30.0)["ok"] is True
    assert calls["n"] == 2


def test_a_malformed_body_is_not_readiness(tmp_path: Path) -> None:
    local, _clock, _calls = build(tmp_path, [{"not": "a healthz body"}])
    local.start()
    with pytest.raises(relay.RelayReadinessTimeout):
        local.wait_ready(timeout_s=2.0)
    assert local.ready is False


def test_a_persistently_refused_connection_expires_with_the_named_condition(
    tmp_path: Path,
) -> None:
    local, clock, _calls = build(tmp_path, [ConnectionRefusedError("never comes up")])
    local.start()
    with pytest.raises(relay.RelayReadinessTimeout) as excinfo:
        local.wait_ready(timeout_s=3.0)
    message = str(excinfo.value)
    assert constants.RELAY_HEALTH_PATH in message
    assert "ok" in message
    assert clock.now - 100.0 <= 3.0 + relay.POLL_INTERVAL_S


def test_readiness_is_not_re_probed_once_established(tmp_path: Path) -> None:
    local, _clock, calls = build(tmp_path, [HEALTHY])
    local.start()
    local.wait_ready()
    first = calls["n"]
    local.wait_ready()
    assert calls["n"] == first, "wait_ready re-probed an already-ready relay"
    assert local.ready is True
