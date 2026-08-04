# WP70 / AC3 — blind counterpart 2 for "'stopped' means the port refuses a connection,
# verified by a bounded probe; an orphaned listener is RELAY_NOT_STOPPED".
#
# Different angle: "a stop that does not release the port poisons the next run." So the
# consequence is checked end to end — an orphaned listener from run one makes run two's
# start() a RELAY_PORT_OCCUPIED refusal, and the two named reasons are distinct so a
# reader can tell "we failed to stop" from "someone else has the port".
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


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.now += seconds


def build(tmp_path: Path, name: str, world: dict, run_id: str):
    """Two relays over ONE shared world dict — the port is a machine-wide resource."""
    console = relay.RelayPlanConsole()
    repo_root = tmp_path / "repo"
    (repo_root / constants.RELAY_ENTRY_REL).parent.mkdir(parents=True, exist_ok=True)
    (repo_root / constants.RELAY_ENTRY_REL).write_bytes(b"// built\n")
    clock = Clock()
    local = relay.LocalRelay(
        console=console,
        repo_root=repo_root,
        run_id=run_id,
        store_root=tmp_path / f"stores-{name}",
        port_probe=lambda host, port: bool(world["listening"]),
        health_probe=lambda url: {"ok": True, "documents": 0, "clients": 0},
        room_minter=lambda url, room: {"id": "r", "token": "SENTINEL-TOKEN"},
        clock=clock,
        sleeper=clock.sleep,
    )
    console.close_console = lambda cid: {"closed": True}  # never frees the port
    return local, console


def test_an_orphaned_listener_poisons_the_next_run(tmp_path: Path) -> None:
    world = {"listening": False}
    first, _c1 = build(tmp_path, "run1", world, "20260803T185959Z-28-889900")
    first.start()
    world["listening"] = True

    with pytest.raises(relay.RelayNotStopped):
        first.stop(timeout_s=1.0)

    second, console2 = build(tmp_path, "run2", world, "20260803T185959Z-28-889901")
    with pytest.raises(relay.RelayPortOccupied):
        second.start()
    assert console2.requests == [], "the poisoned run still planned a process"


def test_the_two_reasons_are_distinct_and_both_sanctioned() -> None:
    assert constants.RELAY_NOT_STOPPED != constants.RELAY_PORT_OCCUPIED
    assert constants.RELAY_NOT_STOPPED in constants.FAILURE_REASONS
    assert constants.RELAY_PORT_OCCUPIED in constants.FAILURE_REASONS
    assert relay.RelayNotStopped is not relay.RelayPortOccupied
    assert issubclass(relay.RelayNotStopped, relay.RelayError)
    assert issubclass(relay.RelayPortOccupied, relay.RelayError)


def test_a_clean_stop_leaves_the_port_free_for_the_next_run(tmp_path: Path) -> None:
    world = {"listening": False}
    first, console1 = build(tmp_path, "clean1", world, "20260803T185959Z-28-889902")
    first.start()
    world["listening"] = True
    console1.close_console = lambda cid: world.__setitem__("listening", False) or {"closed": True}
    assert first.stop(timeout_s=5.0).stopped is True

    second, _c2 = build(tmp_path, "clean2", world, "20260803T185959Z-28-889903")
    second.start()
    assert second.started is True


def test_the_not_stopped_failure_does_not_terminate_the_listener(tmp_path: Path) -> None:
    # D15 again: failing to stop is not a licence to escalate.
    world = {"listening": False}
    local, console = build(tmp_path, "noescalate", world, "20260803T185959Z-28-889904")
    local.start()
    world["listening"] = True
    with pytest.raises(relay.RelayNotStopped):
        local.stop(timeout_s=1.0)
    assert world["listening"] is True


def test_the_bounded_probe_expires_rather_than_looping_forever(tmp_path: Path) -> None:
    world = {"listening": False}
    local, _console = build(tmp_path, "bounded", world, "20260803T185959Z-28-889905")
    local.start()
    world["listening"] = True
    with pytest.raises(relay.RelayNotStopped):
        local.stop(timeout_s=0.5)
