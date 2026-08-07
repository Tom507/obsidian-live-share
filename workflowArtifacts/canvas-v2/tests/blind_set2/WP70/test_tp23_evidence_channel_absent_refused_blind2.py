# WP70 / AC5 — blind counterpart 2 for "the mechanism refuses under
# PROPAGATION_EVIDENCE_UNAVAILABLE when either evidence channel is absent".
#
# ⚠ AC5's positive leg cannot be settled by this work package at all — it needs two real
# Obsidian instances, which is WP7's run. Nothing here observes propagation.
#
# Different angle: the channel is BUILT rather than handed over. `relay_observation()`
# assembles the positive channel from the relay's own healthz body and the frames its own
# store retained; a relay with no room, no readiness or no store cannot produce one, and
# the refusal must come from the builder rather than from the evaluator downstream.
#
# DATA SAFETY: no socket is opened and no process is started; the store is under tmp_path.

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

RUN_ID = "20260803T085959Z-38-223344"
HEALTHY = {"ok": True, "uptime": 3.0, "sessions": 1, "documents": 1, "clients": 2}


def build(tmp_path: Path, name: str, health=None):
    console = relay.RelayPlanConsole()
    repo_root = tmp_path / name
    (repo_root / constants.RELAY_ENTRY_REL).parent.mkdir(parents=True, exist_ok=True)
    (repo_root / constants.RELAY_ENTRY_REL).write_bytes(b"// built\n")
    state = {"listening": False}
    local = relay.LocalRelay(
        console=console,
        repo_root=repo_root,
        run_id=RUN_ID,
        store_root=tmp_path / f"stores-{name}",
        port_probe=lambda host, port: bool(state["listening"]),
        health_probe=lambda url: HEALTHY if health is None else health,
        room_minter=lambda url, room: {"id": "room-obs", "token": "SENTINEL-TOKEN"},
    )
    console.close_console = lambda cid: state.__setitem__("listening", False) or {"closed": True}
    return local, state


def ready_relay(tmp_path: Path, name: str, frames: int = 0):
    local, state = build(tmp_path, name)
    local.start()
    state["listening"] = True
    local.wait_ready()
    local.mint_room()
    frames_dir = Path(local.store_paths()["data/frames"])
    for index in range(frames):
        (frames_dir / f"{index:06d}.frame").write_bytes(b"x")
    return local


def test_a_relay_with_no_minted_room_cannot_build_the_channel(tmp_path: Path) -> None:
    local, state = build(tmp_path, "no-room")
    local.start()
    state["listening"] = True
    local.wait_ready()
    with pytest.raises(relay.PropagationEvidenceUnavailable):
        relay.relay_observation(local)


def test_a_relay_that_was_never_ready_cannot_build_the_channel(tmp_path: Path) -> None:
    local, _state = build(tmp_path, "not-ready")
    with pytest.raises(relay.PropagationEvidenceUnavailable):
        relay.relay_observation(local)


def test_a_built_channel_carries_every_relay_side_key(tmp_path: Path) -> None:
    local = ready_relay(tmp_path, "built", frames=5)
    observation = relay.relay_observation(local)
    assert set(relay.RELAY_EVIDENCE_KEYS) <= set(observation)
    assert observation["roomId"] == "room-obs"
    assert observation["documents"] == HEALTHY["documents"]
    assert observation["clients"] == HEALTHY["clients"]
    assert observation["frames"] == 5


def test_a_built_channel_evaluates_against_a_clean_negative_control(
    tmp_path: Path,
) -> None:
    local = ready_relay(tmp_path, "evaluated", frames=9)
    verdict = relay.evaluate_propagation(
        relay.PropagationEvidence(
            positive=relay.relay_observation(local),
            negative={"relayMediated": False, "changed": False},
            positive_window_s=3.0,
            negative_window_s=8.0,
        )
    )
    assert verdict.positive_observed is True
    assert verdict.satisfied is True


def test_a_built_channel_with_no_frames_is_not_a_positive_observation(
    tmp_path: Path,
) -> None:
    local = ready_relay(tmp_path, "no-frames", frames=0)
    verdict = relay.evaluate_propagation(
        relay.PropagationEvidence(
            positive=relay.relay_observation(local),
            negative={"relayMediated": False, "changed": False},
            positive_window_s=3.0,
            negative_window_s=8.0,
        )
    )
    assert verdict.positive_observed is False
    assert verdict.satisfied is False
    assert verdict.reason == constants.PROPAGATION_EVIDENCE_UNAVAILABLE


def test_the_built_channel_carries_no_token(tmp_path: Path) -> None:
    local = ready_relay(tmp_path, "no-token", frames=2)
    observation = relay.relay_observation(local)
    assert "SENTINEL-TOKEN" not in repr(observation)
    assert "token" not in observation
