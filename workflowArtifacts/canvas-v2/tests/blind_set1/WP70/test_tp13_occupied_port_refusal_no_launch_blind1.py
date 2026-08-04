# WP70 / AC3 — blind counterpart 1 for "an occupied port is a named refusal
# (RELAY_PORT_OCCUPIED) and no process is planned".
#
# Different angle: the ordering INSIDE start(). The port check must be the first thing
# that happens — before the build, before the store directory, before anything reaches
# the console — because every one of those is a side effect on the operator's machine
# that a refusal is not entitled to leave behind.
#
# DATA SAFETY: no socket is opened and no process is started; the probe is injected and
# the console is `relay.RelayPlanConsole`, which plans calls and executes none.

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

RUN_ID = "20260804T030303Z-19-ff0011"


def build_relay(tmp_path: Path, *, occupied: bool, entry_built: bool = True, port=None):
    console = relay.RelayPlanConsole()
    repo_root = tmp_path / "repo"
    entry = repo_root / constants.RELAY_ENTRY_REL
    entry.parent.mkdir(parents=True, exist_ok=True)
    if entry_built:
        entry.write_bytes(b"// built\n")
    probes = {"n": 0}

    def port_probe(host, port_):
        probes["n"] += 1
        return occupied

    local = relay.LocalRelay(
        console=console,
        repo_root=repo_root,
        run_id=RUN_ID,
        store_root=tmp_path / "stores",
        port=constants.RELAY_PORT if port is None else port,
        port_probe=port_probe,
        health_probe=lambda base_url: {"ok": True, "documents": 0, "clients": 0},
        room_minter=lambda base_url, name: {"id": "r", "token": "SENTINEL-TOKEN"},
    )
    return local, console, probes


def test_the_port_is_checked_before_anything_else_happens(tmp_path: Path) -> None:
    local, console, probes = build_relay(tmp_path, occupied=True, entry_built=False)
    with pytest.raises(relay.RelayPortOccupied):
        local.start()
    assert probes["n"] >= 1, "start() never probed the port"
    assert console.requests == [], "a build or a launch reached the console"
    assert not Path(local.store_dir).exists()


def test_the_refusal_happens_even_when_the_bundle_would_need_building(
    tmp_path: Path,
) -> None:
    # An unbuilt entry would normally trigger the `tsc` build. An occupied port must
    # refuse first: building for a run that cannot start is a side effect for nothing.
    local, console, _probes = build_relay(tmp_path, occupied=True, entry_built=False)
    with pytest.raises(relay.RelayPortOccupied) as excinfo:
        local.start()
    assert excinfo.value.reason == constants.RELAY_PORT_OCCUPIED
    assert console.requests == []


def test_an_overridden_port_is_the_one_reported(tmp_path: Path) -> None:
    local, _console, _probes = build_relay(tmp_path, occupied=True, port=45678)
    with pytest.raises(relay.RelayPortOccupied) as excinfo:
        local.start()
    assert "45678" in str(excinfo.value)
    assert local.port == 45678


def test_the_refusal_is_repeatable_and_never_becomes_an_adoption(tmp_path: Path) -> None:
    local, console, _probes = build_relay(tmp_path, occupied=True)
    for _ in range(3):
        with pytest.raises(relay.RelayPortOccupied):
            local.start()
    assert console.requests == []
    assert local.started_by_rig is False
    assert local.room is None


def test_a_free_port_reaches_the_console_exactly_once(tmp_path: Path) -> None:
    # Without this, "nothing reached the console" would pass for a relay that never
    # plans anything at all.
    local, console, _probes = build_relay(tmp_path, occupied=False)
    local.start()
    launches = [r for r in console.requests if r["mcp"]["tool_name"] == "run_command"]
    assert len(launches) == 1
    assert launches[0]["argv"][0] == "node"
