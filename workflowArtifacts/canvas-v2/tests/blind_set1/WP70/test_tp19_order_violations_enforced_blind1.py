# WP70 / AC4 — blind counterpart 1 for "out-of-order calls raise GATE_ORDER_VIOLATION at
# the boundary that owns them".
#
# Different angle: the boundaries are approached from the WRONG SIDE — mint_room() after
# the relay was stopped, wait_ready() before start(), a second mint_room() on the same
# relay, and a GateSequence completed out of turn. In a mediated run every one of these is
# reachable by an agent replaying a step, so each must refuse where it arrives.
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

from obsidian_e2e import constants, provisioning, relay  # noqa: E402

RUN_ID = "20260803T155959Z-31-bbccdd"


def build(tmp_path: Path, name: str):
    console = relay.RelayPlanConsole()
    repo_root = tmp_path / name
    (repo_root / constants.RELAY_ENTRY_REL).parent.mkdir(parents=True, exist_ok=True)
    (repo_root / constants.RELAY_ENTRY_REL).write_bytes(b"// built\n")
    state = {"listening": False}
    minted = {"n": 0}

    def minter(base_url, room_name):
        minted["n"] += 1
        return {"id": f"room-{minted['n']}", "token": "SENTINEL-TOKEN"}

    local = relay.LocalRelay(
        console=console,
        repo_root=repo_root,
        run_id=RUN_ID,
        store_root=tmp_path / f"stores-{name}",
        port_probe=lambda host, port: bool(state["listening"]),
        health_probe=lambda url: {"ok": True, "documents": 0, "clients": 0},
        room_minter=minter,
    )
    console.close_console = lambda cid: state.__setitem__("listening", False) or {"closed": True}
    return local, state, minted


def test_wait_ready_before_start_is_refused(tmp_path: Path) -> None:
    local, _state, _minted = build(tmp_path, "no-start")
    with pytest.raises(relay.GateOrderViolation) as excinfo:
        local.wait_ready(timeout_s=1.0)
    assert excinfo.value.reason == constants.GATE_ORDER_VIOLATION


def test_mint_room_after_the_relay_was_stopped_is_refused(tmp_path: Path) -> None:
    local, state, minted = build(tmp_path, "after-stop")
    local.start()
    state["listening"] = True
    local.wait_ready()
    local.stop()

    with pytest.raises(relay.GateOrderViolation):
        local.mint_room()
    assert minted["n"] == 0


def test_a_second_mint_room_on_the_same_relay_is_refused(tmp_path: Path) -> None:
    # "Any design that assumes a fixed room id, or that reuses a room id found in a
    # vault, is wrong by construction." A run has exactly one room.
    local, state, minted = build(tmp_path, "twice")
    local.start()
    state["listening"] = True
    local.wait_ready()
    first = local.mint_room()

    with pytest.raises(relay.GateOrderViolation):
        local.mint_room()
    assert minted["n"] == 1
    assert local.room is first


def test_a_gate_sequence_completed_out_of_turn_is_refused() -> None:
    sequence = provisioning.GateSequence(run_id=RUN_ID)
    steps = provisioning.GateSequence.STEPS
    sequence.begin(steps[0])

    with pytest.raises(provisioning.GateOrderViolation):
        sequence.complete(steps[1])
    with pytest.raises(provisioning.GateOrderViolation):
        sequence.complete("not-a-step")
    assert sequence.completed == ()
    sequence.complete(steps[0])
    assert sequence.completed == (steps[0],)


def test_a_gate_sequence_completed_without_a_begin_is_refused() -> None:
    sequence = provisioning.GateSequence(run_id=RUN_ID)
    with pytest.raises(provisioning.GateOrderViolation):
        sequence.complete(provisioning.GateSequence.STEPS[0])
    assert sequence.record()["steps"] == []
