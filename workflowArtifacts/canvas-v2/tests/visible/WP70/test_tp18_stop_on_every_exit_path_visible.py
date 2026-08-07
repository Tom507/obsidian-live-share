# WP70 / AC3 — "Stop runs on success, failure, abort and interruption."
#
# Four exit paths, and the third and fourth are the ones a `try/except Exception:`
# teardown silently misses: `KeyboardInterrupt` and `SystemExit` derive from
# `BaseException`. A relay that survives an aborted run holds the port and poisons the
# next one, which is exactly what AC3's "orphaned listener is a failed run" is about.
#
#   ├── T1 normal exit of the context manager stops and releases
#   ├── T2 an exception inside the context stops, releases and re-raises
#   ├── T3 a KeyboardInterrupt inside the context stops and releases
#   ├── T4 a SystemExit inside the context stops and releases
#   ├── T5 the store directory is removed on all four paths
#   └── T6 a stop failure on the exception path does not swallow the original exception
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


class Boom(RuntimeError):
    pass


def make_relay(tmp_path: Path, name: str = "repo"):
    console = relay.RelayPlanConsole()
    repo_root = tmp_path / name
    entry = repo_root / constants.RELAY_ENTRY_REL
    entry.parent.mkdir(parents=True, exist_ok=True)
    entry.write_bytes(b"// built relay entry\n")
    state = {"listening": False, "closed": 0}

    def port_probe(host, port):
        return bool(state["listening"])

    local = relay.LocalRelay(
        console=console,
        repo_root=repo_root,
        run_id=RUN_ID,
        store_root=tmp_path / f"store-root-{name}",
        port_probe=port_probe,
        health_probe=lambda base_url: {"ok": True, "documents": 0, "clients": 0},
        room_minter=lambda base_url, name_: {"id": "room-1", "token": "SENTINEL-TOKEN"},
    )

    def close(console_id):
        state["closed"] += 1
        state["listening"] = False
        return {"closed": True}

    console.close_console = close
    return local, console, state


def test_normal_exit_stops_and_releases(tmp_path: Path) -> None:
    local, _console, state = make_relay(tmp_path, "normal")
    with local as handle:
        handle.start()
        state["listening"] = True
        store_dir = Path(handle.store_dir)
        assert store_dir.is_dir()
    assert state["closed"] == 1
    assert not store_dir.exists()


def test_an_exception_inside_the_context_still_stops(tmp_path: Path) -> None:
    local, _console, state = make_relay(tmp_path, "boom")
    with pytest.raises(Boom):
        with local as handle:
            handle.start()
            state["listening"] = True
            store_dir = Path(handle.store_dir)
            raise Boom("the gate failed mid-run")
    assert state["closed"] == 1
    assert not store_dir.exists()


def test_an_abort_inside_the_context_still_stops(tmp_path: Path) -> None:
    """KeyboardInterrupt derives from BaseException — a bare `except Exception:`
    teardown would leave the relay holding the port."""
    local, _console, state = make_relay(tmp_path, "abort")
    with pytest.raises(KeyboardInterrupt):
        with local as handle:
            handle.start()
            state["listening"] = True
            store_dir = Path(handle.store_dir)
            raise KeyboardInterrupt
    assert state["closed"] == 1
    assert not store_dir.exists()


def test_a_system_exit_inside_the_context_still_stops(tmp_path: Path) -> None:
    local, _console, state = make_relay(tmp_path, "sysexit")
    with pytest.raises(SystemExit):
        with local as handle:
            handle.start()
            state["listening"] = True
            store_dir = Path(handle.store_dir)
            raise SystemExit(3)
    assert state["closed"] == 1
    assert not store_dir.exists()


def test_the_relay_was_genuinely_running_in_between(tmp_path: Path) -> None:
    # Without this, every path above would pass for a relay that never starts.
    local, _console, state = make_relay(tmp_path, "genuine")
    with local as handle:
        handle.start()
        state["listening"] = True
        assert handle.started is True
        assert handle.started_by_rig is True
        assert handle.console_id is not None
    assert state["closed"] == 1
    assert local.started is False


def test_a_stop_failure_does_not_swallow_the_original_exception(tmp_path: Path) -> None:
    # The port stays bound, so release() cannot succeed. The run's own failure is the
    # one that must reach the caller; the stuck relay is reported, not substituted.
    local, console, state = make_relay(tmp_path, "stuck")

    def stuck_close(console_id):
        state["closed"] += 1
        return {"closed": True}  # returns, but the port stays bound

    console.close_console = stuck_close
    with pytest.raises(Boom):
        with local as handle:
            handle.start()
            state["listening"] = True
            raise Boom("the original failure")

    assert state["closed"] == 1, "teardown did not even attempt the stop"
    assert local.stopped is False
