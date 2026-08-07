# WP70 / AC3, D15 / S2 — blind counterpart 1 for "the rig never terminates a process it
# did not start".
#
# Different angle: the relay DID start, then something else went wrong. A readiness
# timeout, a room-mint failure and a mid-run abort all leave the rig owning a process it
# started — so those must close, while a relay that was never started must not, even when
# a listener appeared on the port in the meantime (a foreign process taking the port
# after the rig gave up is the exact trap D15 exists for).
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

RUN_ID = "20260804T010101Z-21-112233"


class Clock:
    def __init__(self) -> None:
        self.now = 0.0
        self.slept: list = []

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds


def build(tmp_path: Path, *, listening: list, health):
    console = relay.RelayPlanConsole()
    repo_root = tmp_path / "repo"
    (repo_root / constants.RELAY_ENTRY_REL).parent.mkdir(parents=True, exist_ok=True)
    (repo_root / constants.RELAY_ENTRY_REL).write_bytes(b"// built\n")
    clock = Clock()
    closes: list = []

    local = relay.LocalRelay(
        console=console,
        repo_root=repo_root,
        run_id=RUN_ID,
        store_root=tmp_path / "stores",
        port_probe=lambda host, port: bool(listening[0]),
        health_probe=health,
        room_minter=lambda base_url, name: {"id": "r", "token": "SENTINEL-TOKEN"},
        clock=clock,
        sleeper=clock.sleep,
    )

    def close(console_id):
        closes.append(console_id)
        listening[0] = False
        return {"closed": True}

    console.close_console = close
    return local, closes, clock


def test_a_readiness_timeout_still_closes_the_rigs_own_relay(tmp_path: Path) -> None:
    listening = [False]
    local, closes, _clock = build(tmp_path, listening=listening, health=lambda url: None)
    local.start()
    listening[0] = True
    with pytest.raises(relay.RelayReadinessTimeout):
        local.wait_ready(timeout_s=1.0)

    result = local.release()
    assert closes == [local.console_id] or len(closes) == 1
    assert result.closed is True


def test_a_relay_that_never_started_is_not_closed_even_if_a_listener_appears(
    tmp_path: Path,
) -> None:
    listening = [True]  # someone else has the port
    local, closes, _clock = build(
        tmp_path, listening=listening, health=lambda url: {"ok": True, "documents": 0, "clients": 0}
    )
    with pytest.raises(relay.RelayPortOccupied):
        local.start()

    local.release()
    assert closes == [], "the rig closed a console it never opened"
    assert listening[0] is True, "the foreign listener was terminated"


def test_a_relay_that_gave_up_before_starting_does_not_adopt_a_later_listener(
    tmp_path: Path,
) -> None:
    listening = [True]
    local, closes, _clock = build(
        tmp_path, listening=listening, health=lambda url: {"ok": True, "documents": 0, "clients": 0}
    )
    with pytest.raises(relay.RelayPortOccupied):
        local.start()
    # The foreign relay answers healthz perfectly. It is still not the rig's.
    assert local.ready is False
    with pytest.raises(relay.GateOrderViolation):
        local.mint_room()
    assert closes == []


def test_stop_after_a_successful_start_closes_exactly_once(tmp_path: Path) -> None:
    listening = [False]
    local, closes, _clock = build(
        tmp_path, listening=listening, health=lambda url: {"ok": True, "documents": 0, "clients": 0}
    )
    local.start()
    listening[0] = True
    local.stop()
    local.stop()
    assert len(closes) == 1
