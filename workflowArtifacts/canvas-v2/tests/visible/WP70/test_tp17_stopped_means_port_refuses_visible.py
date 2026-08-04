# WP70 / AC3 — "'stopped' means the **port no longer accepts a connection**, verified by
# a bounded probe — not that a terminate call returned. An orphaned listener at the end
# of a run is a failed run."
#
# "Windows process termination is not graceful by default and the server's only shutdown
# channel is a signal." So the one thing a returned `close_console` proves is that the
# call returned. The oracle is the port.
#
#   ├── T1 a close that releases the port yields stopped=True and port_free=True
#   ├── T2 a close that RETURNS but leaves the port bound is RELAY_NOT_STOPPED
#   ├── T3 the stopped verdict is reached by probing, not by the close call's return
#   ├── T4 the probe is bounded and tolerates a port that frees itself late
#   ├── T5 RELAY_NOT_STOPPED names the port, and the failure is not downgraded
#   └── T6 an orphaned listener leaves the relay marked not-stopped for the run record
#
# DATA SAFETY: no socket is opened and no process is started; every probe is injected.

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# --- repo bootstrap (T3_SharedContract §0.2) --------------------------------------
for _parent in Path(__file__).resolve().parents:
    if (_parent / "tools").is_dir() and (_parent / "plugin").is_dir():
        _REPO = _parent
        _TOOLS = _parent / "tools"
        break
else:  # pragma: no cover
    raise RuntimeError(f"obsidian-live-share repo root not found from {__file__}")
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, relay  # noqa: E402

RUN_ID = "20260804T000000Z-1-a1b2c3"


class Clock:
    def __init__(self) -> None:
        self.now = 500.0
        self.slept: list = []

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds


def make_relay(tmp_path: Path, listening: list, clock: Clock):
    console = relay.RelayPlanConsole()
    repo_root = tmp_path / "repo"
    entry = repo_root / constants.RELAY_ENTRY_REL
    entry.parent.mkdir(parents=True, exist_ok=True)
    entry.write_bytes(b"// built relay entry\n")
    probes = {"n": 0}

    def port_probe(host, port):
        probes["n"] += 1
        return bool(listening[0])

    local = relay.LocalRelay(
        console=console,
        repo_root=repo_root,
        run_id=RUN_ID,
        store_root=tmp_path / "store-root",
        port_probe=port_probe,
        health_probe=lambda base_url: {"ok": True, "documents": 0, "clients": 0},
        room_minter=lambda base_url, name: {"id": "room-1", "token": "SENTINEL-TOKEN"},
        clock=clock,
        sleeper=clock.sleep,
    )
    local.probes = probes  # type: ignore[attr-defined]
    return local, console


def test_a_close_that_releases_the_port_is_stopped(tmp_path: Path) -> None:
    clock = Clock()
    listening = [False]
    local, console = make_relay(tmp_path, listening, clock)
    local.start()
    listening[0] = True

    console.close_console = lambda cid: listening.__setitem__(0, False) or {"closed": True}
    result = local.stop()

    assert result.closed is True
    assert result.port_free is True
    assert result.stopped is True
    assert result.reason is None


def test_a_close_that_returns_but_leaves_the_port_bound_is_not_stopped(
    tmp_path: Path,
) -> None:
    clock = Clock()
    listening = [False]
    local, console = make_relay(tmp_path, listening, clock)
    local.start()
    listening[0] = True

    console.close_console = lambda cid: {"closed": True}  # returns; frees nothing
    with pytest.raises(relay.RelayNotStopped) as excinfo:
        local.stop(timeout_s=2.0)

    assert excinfo.value.reason == constants.RELAY_NOT_STOPPED
    assert constants.RELAY_NOT_STOPPED in constants.FAILURE_REASONS


def test_the_verdict_is_reached_by_probing_not_by_the_close_return(tmp_path: Path) -> None:
    clock = Clock()
    # The port must be FREE when start() probes it — start()'s own contract (AC3, T13) is
    # that an occupied port is a named refusal, never an adoption. The relay is up, and
    # therefore the port bound, only from after start(). Same shape as the two tests above.
    listening = [False]
    local, console = make_relay(tmp_path, listening, clock)
    local.start()
    listening[0] = True
    before = local.probes["n"]

    console.close_console = lambda cid: {"closed": True}
    with pytest.raises(relay.RelayNotStopped):
        local.stop(timeout_s=1.0)

    assert local.probes["n"] > before, "stop() never probed the port"


def test_the_probe_is_bounded_and_tolerates_a_late_release(tmp_path: Path) -> None:
    # The port frees itself on the fourth probe. A stop() that gave up after one probe
    # would report a false RELAY_NOT_STOPPED; one that never gives up would hang.
    clock = Clock()
    console = relay.RelayPlanConsole()
    repo_root = tmp_path / "repo"
    entry = repo_root / constants.RELAY_ENTRY_REL
    entry.parent.mkdir(parents=True, exist_ok=True)
    entry.write_bytes(b"// built relay entry\n")

    state = {"probes": 0, "listening": False}

    def port_probe(host, port):
        state["probes"] += 1
        # probe 1 is start()'s free-port check; the relay is up from probe 2, and the
        # close takes effect only by probe 5.
        return bool(state["listening"]) and state["probes"] < 5

    local = relay.LocalRelay(
        console=console,
        repo_root=repo_root,
        run_id=RUN_ID,
        store_root=tmp_path / "store-root",
        port_probe=port_probe,
        health_probe=lambda base_url: {"ok": True, "documents": 0, "clients": 0},
        room_minter=lambda base_url, name: {"id": "room-1", "token": "SENTINEL-TOKEN"},
        clock=clock,
        sleeper=clock.sleep,
    )
    local.start()
    state["listening"] = True
    console.close_console = lambda cid: {"closed": True}

    result = local.stop(timeout_s=10.0)

    assert result.stopped is True
    assert result.port_free is True
    assert state["probes"] >= 4, "stop() gave up after a single probe"
    assert clock.now - 500.0 <= 10.0 + relay.POLL_INTERVAL_S


def test_relay_not_stopped_names_the_port_and_is_not_downgraded(tmp_path: Path) -> None:
    clock = Clock()
    listening = [False]
    local, console = make_relay(tmp_path, listening, clock)
    local.start()
    listening[0] = True  # the relay is up; the close below will not free it
    console.close_console = lambda cid: {"closed": True}

    with pytest.raises(relay.RelayNotStopped) as excinfo:
        local.stop(timeout_s=1.0)
    assert str(constants.RELAY_PORT) in str(excinfo.value)


def test_an_orphaned_listener_leaves_the_relay_marked_not_stopped(tmp_path: Path) -> None:
    clock = Clock()
    listening = [False]
    local, console = make_relay(tmp_path, listening, clock)
    local.start()
    listening[0] = True  # the orphan: still bound after the close returns
    console.close_console = lambda cid: {"closed": True}

    with pytest.raises(relay.RelayNotStopped):
        local.stop(timeout_s=1.0)
    assert local.stopped is False
    assert local.ready is False
