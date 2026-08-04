# WP70 / AC3 — "Before start, an occupied port is a **named refusal**, never an adoption
# and never a kill: the rig may not attach to a relay it did not start … and it may not
# terminate a process it did not start (D15/S2)."
#
# The refusal is easy to write and easy to get wrong in one specific way: refusing AFTER
# the launch was planned. A plan that reached the console is a process on the operator's
# machine, whatever the rig then reports. So the oracle is the console double's request
# log — it must be EMPTY — not the exception alone.
#
#   ├── T1 an occupied port raises RelayPortOccupied with reason RELAY_PORT_OCCUPIED
#   ├── T2 the console double recorded ZERO launches (no run_command, no run_python)
#   ├── T3 the refusal creates no run-scoped store directory either
#   ├── T4 the relay is not marked started, ready, or owned by the rig afterwards
#   ├── T5 the refusal names the port and the host, and carries no room token
#   └── T6 a FREE port plans exactly one launch — so T2 is not vacuously true
#
# DATA SAFETY: no socket is opened and no process is started. The port probe is injected
# and the console is `relay.RelayPlanConsole`, which plans calls and executes none.

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
LAUNCH_TOOLS = {"run_command", "run_python"}


def launches(console) -> list:
    return [r for r in console.requests if r.get("mcp", {}).get("tool_name") in LAUNCH_TOOLS]


def make_relay(tmp_path: Path, *, occupied: bool) -> tuple:
    console = relay.RelayPlanConsole()
    entry = tmp_path / "repo" / constants.RELAY_ENTRY_REL
    entry.parent.mkdir(parents=True, exist_ok=True)
    entry.write_bytes(b"// built relay entry\n")
    local = relay.LocalRelay(
        console=console,
        repo_root=tmp_path / "repo",
        run_id=RUN_ID,
        store_root=tmp_path / "store-root",
        port_probe=lambda host, port: occupied,
        health_probe=lambda base_url: {"ok": True, "documents": 1, "clients": 2},
        room_minter=lambda base_url, name: {"id": "room-1", "token": "SENTINEL-TOKEN"},
    )
    return local, console


def test_an_occupied_port_raises_the_named_refusal(tmp_path: Path) -> None:
    local, _console = make_relay(tmp_path, occupied=True)
    with pytest.raises(relay.RelayPortOccupied) as excinfo:
        local.start()
    assert excinfo.value.reason == constants.RELAY_PORT_OCCUPIED
    assert constants.RELAY_PORT_OCCUPIED in constants.FAILURE_REASONS


def test_the_console_double_recorded_zero_launches(tmp_path: Path) -> None:
    local, console = make_relay(tmp_path, occupied=True)
    with pytest.raises(relay.RelayPortOccupied):
        local.start()
    assert launches(console) == [], "a process was planned before the port was refused"
    assert console.requests == [], "the refusal still reached the console surface"


def test_the_refusal_creates_no_run_scoped_store_directory(tmp_path: Path) -> None:
    local, _console = make_relay(tmp_path, occupied=True)
    with pytest.raises(relay.RelayPortOccupied):
        local.start()
    assert not Path(local.store_dir).exists(), "the refusal left a store directory behind"


def test_the_relay_is_not_marked_started_ready_or_owned(tmp_path: Path) -> None:
    local, _console = make_relay(tmp_path, occupied=True)
    with pytest.raises(relay.RelayPortOccupied):
        local.start()
    assert local.started is False
    assert local.ready is False
    assert local.started_by_rig is False
    assert local.console_id is None
    assert local.room is None


def test_the_refusal_names_the_port_and_host_and_carries_no_token(tmp_path: Path) -> None:
    local, _console = make_relay(tmp_path, occupied=True)
    with pytest.raises(relay.RelayPortOccupied) as excinfo:
        local.start()
    message = str(excinfo.value)
    assert str(constants.RELAY_PORT) in message
    assert constants.RELAY_HOST in message
    assert "SENTINEL-TOKEN" not in message


def test_a_free_port_plans_exactly_one_launch(tmp_path: Path) -> None:
    # Without this, "zero launches" would pass for a relay that never launches anything.
    local, console = make_relay(tmp_path, occupied=False)
    local.start()
    assert len(launches(console)) == 1
    assert local.started is True
    assert local.started_by_rig is True
    assert local.console_id is not None
    # Started is not ready — a spawned-process fact is not a readiness fact.
    assert local.ready is False
