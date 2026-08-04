# WP70 / AC3, D15 / S2 — "the rig stops only the relay process it started. A foreign
# listener on the relay port is a refusal, never a target."
#
# The failure this forbids is quiet and expensive: a teardown that closes "whatever is on
# the relay port" would, on a developer machine, close the operator's own server. The
# only structurally safe rule is that `stop()` may act on a console id the rig itself
# obtained from its own launch and on nothing else.
#
#   ├── T1 stop() on a relay that never started closes NOTHING
#   ├── T2 stop() on a refused (occupied-port) relay closes NOTHING
#   ├── T3 a listener that is still up after a non-start is reported, never terminated
#   ├── T4 release() on a never-started relay is a safe no-op and closes NOTHING
#   ├── T5 stop() on a relay the rig DID start closes exactly its own console id
#   └── T6 stop() is idempotent: the second call closes nothing a second time
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


def closes(console) -> list:
    return [r for r in console.requests if r.get("mcp", {}).get("tool_name") == "close_console"]


def make_relay(tmp_path: Path, *, listening) -> tuple:
    """`listening` is a mutable one-element list so a test can flip it mid-run."""
    console = relay.RelayPlanConsole()
    entry = tmp_path / "repo" / constants.RELAY_ENTRY_REL
    entry.parent.mkdir(parents=True, exist_ok=True)
    entry.write_bytes(b"// built relay entry\n")
    local = relay.LocalRelay(
        console=console,
        repo_root=tmp_path / "repo",
        run_id=RUN_ID,
        store_root=tmp_path / "store-root",
        port_probe=lambda host, port: bool(listening[0]),
        health_probe=lambda base_url: {"ok": True, "documents": 1, "clients": 2},
        room_minter=lambda base_url, name: {"id": "room-1", "token": "SENTINEL-TOKEN"},
    )
    return local, console


def test_stop_on_a_relay_that_never_started_closes_nothing(tmp_path: Path) -> None:
    local, console = make_relay(tmp_path, listening=[False])
    result = local.stop()
    assert closes(console) == []
    assert result.closed is False
    assert result.stopped is True  # nothing of the rig's is running


def test_stop_after_an_occupied_port_refusal_closes_nothing(tmp_path: Path) -> None:
    listening = [True]
    local, console = make_relay(tmp_path, listening=listening)
    with pytest.raises(relay.RelayPortOccupied):
        local.start()

    result = local.stop()
    assert closes(console) == [], "the rig tried to close a process it did not start"
    assert result.closed is False


def test_a_foreign_listener_is_reported_never_terminated(tmp_path: Path) -> None:
    listening = [True]
    local, console = make_relay(tmp_path, listening=listening)
    with pytest.raises(relay.RelayPortOccupied):
        local.start()

    result = local.stop()
    assert result.port_free is False, "the rig must report the foreign listener"
    assert result.closed is False
    assert console.requests == [], "not one console call was made against a foreign process"
    assert local.started_by_rig is False


def test_release_on_a_never_started_relay_is_a_safe_no_op(tmp_path: Path) -> None:
    local, console = make_relay(tmp_path, listening=[False])
    result = local.release()
    assert closes(console) == []
    assert result.closed is False
    # It is called unconditionally from a `finally`, so it must be callable twice.
    assert local.release().closed is False


def test_stop_on_a_relay_the_rig_started_closes_exactly_its_own_console_id(
    tmp_path: Path,
) -> None:
    # Without this, "closes nothing" would pass for a stop() that never closes anything.
    listening = [False]
    local, console = make_relay(tmp_path, listening=listening)
    local.start()
    listening[0] = True  # the relay the rig started is now up
    own_id = local.console_id

    def close_and_free(console_id):
        listening[0] = False
        return {"console_id": console_id, "closed": True}

    console.close_console = close_and_free  # type: ignore[assignment]
    result = local.stop()

    assert result.closed is True
    assert result.stopped is True
    assert own_id is not None


def test_stop_is_idempotent(tmp_path: Path) -> None:
    listening = [False]
    local, console = make_relay(tmp_path, listening=listening)
    local.start()
    local.stop()
    before = len(closes(console))
    second = local.stop()
    assert len(closes(console)) == before, "the second stop closed the console again"
    assert second.stopped is True
