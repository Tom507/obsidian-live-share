# WP70 / AC3 — blind counterpart 1 for "'stopped' means the port refuses a connection,
# verified by a bounded probe; an orphaned listener is RELAY_NOT_STOPPED".
#
# Different angle: the port is ALREADY free when stop runs — a graceful shutdown that
# completed before the rig looked. The verdict must still be reached by probing, the
# result must still say the port is free, and a relay that stopped promptly must not fail
# the run. The mirror case is a close that never takes effect at all.
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

RUN_ID = "20260803T195959Z-27-778899"


class Clock:
    def __init__(self) -> None:
        self.now = 0.0
        self.slept: list = []

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds


def build(tmp_path: Path, name: str):
    """A relay whose port state is a mutable dict the test drives."""
    console = relay.RelayPlanConsole()
    repo_root = tmp_path / name
    (repo_root / constants.RELAY_ENTRY_REL).parent.mkdir(parents=True, exist_ok=True)
    (repo_root / constants.RELAY_ENTRY_REL).write_bytes(b"// built\n")
    clock = Clock()
    state = {"listening": False, "probes": 0, "closes": 0}

    def port_probe(host, port):
        state["probes"] += 1
        return bool(state["listening"])

    local = relay.LocalRelay(
        console=console,
        repo_root=repo_root,
        run_id=RUN_ID,
        store_root=tmp_path / f"stores-{name}",
        port_probe=port_probe,
        health_probe=lambda url: {"ok": True, "documents": 0, "clients": 0},
        room_minter=lambda url, room: {"id": "r", "token": "SENTINEL-TOKEN"},
        clock=clock,
        sleeper=clock.sleep,
    )
    return local, console, clock, state


def test_a_port_that_is_already_free_is_a_prompt_stop(tmp_path: Path) -> None:
    local, console, clock, state = build(tmp_path, "prompt")
    local.start()
    console.close_console = lambda cid: {"closed": True}
    before = state["probes"]

    result = local.stop(timeout_s=5.0)

    assert result.stopped is True
    assert result.port_free is True
    assert result.reason is None
    assert state["probes"] > before, "the verdict was not reached by probing"
    assert clock.slept == [], "the rig paused before asking whether the port was free"


def test_the_stop_result_reports_the_probe_it_made(tmp_path: Path) -> None:
    local, console, _clock, state = build(tmp_path, "counted")
    local.start()
    state["listening"] = True
    console.close_console = lambda cid: state.__setitem__("listening", False) or {"closed": True}

    result = local.stop(timeout_s=10.0)
    assert result.probes >= 1
    assert result.stopped is True


def test_a_port_that_never_frees_fails_the_run(tmp_path: Path) -> None:
    local, console, _clock, state = build(tmp_path, "orphan")
    local.start()
    state["listening"] = True
    console.close_console = lambda cid: {"closed": True}  # returns, frees nothing

    with pytest.raises(relay.RelayNotStopped) as excinfo:
        local.stop(timeout_s=2.0)
    assert excinfo.value.reason == constants.RELAY_NOT_STOPPED
    assert str(constants.RELAY_PORT) in str(excinfo.value)
    assert local.stopped is False


def test_release_propagates_the_not_stopped_failure(tmp_path: Path) -> None:
    local, console, _clock, state = build(tmp_path, "release-orphan")
    local.start()
    state["listening"] = True
    console.close_console = lambda cid: {"closed": True}

    with pytest.raises(relay.RelayNotStopped):
        local.release(timeout_s=2.0)


def test_a_stop_that_reports_free_really_saw_a_free_port(tmp_path: Path) -> None:
    # Without this, "stopped" would be satisfiable by a stop() that never probes.
    local, console, _clock, state = build(tmp_path, "honest")
    local.start()
    state["listening"] = True
    calls = {"n": 0}

    def close(cid):
        calls["n"] += 1
        state["listening"] = False
        return {"closed": True}

    console.close_console = close
    result = local.stop(timeout_s=5.0)
    assert calls["n"] == 1
    assert result.port_free is True
    assert state["listening"] is False
