# WP70 / AC3 — blind counterpart 2 for "stop runs on success, failure, abort and
# KeyboardInterrupt".
#
# Different angle: the exit paths are enumerated as data and driven through one loop, and
# each one is checked against THREE oracles rather than one — the console was closed, the
# store directory is gone, and the relay no longer reports itself as started. A teardown
# that closes the console but leaves the store behind fails here and passes a
# close-counting test.
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

RUN_ID = "20260803T165959Z-30-aabbcc"


class Boom(RuntimeError):
    pass


class Aborted(BaseException):
    """A BaseException that is not KeyboardInterrupt — the case a narrow
    `except (Exception, KeyboardInterrupt):` teardown still misses."""


EXITS = {
    "normal": None,
    "exception": Boom,
    "keyboard_interrupt": KeyboardInterrupt,
    "system_exit": SystemExit,
    "other_base_exception": Aborted,
}


def build(tmp_path: Path, name: str):
    console = relay.RelayPlanConsole()
    repo_root = tmp_path / name
    (repo_root / constants.RELAY_ENTRY_REL).parent.mkdir(parents=True, exist_ok=True)
    (repo_root / constants.RELAY_ENTRY_REL).write_bytes(b"// built\n")
    state = {"listening": False, "closes": 0}

    local = relay.LocalRelay(
        console=console,
        repo_root=repo_root,
        run_id=RUN_ID,
        store_root=tmp_path / f"stores-{name}",
        port_probe=lambda host, port: bool(state["listening"]),
        health_probe=lambda url: {"ok": True, "documents": 0, "clients": 0},
        room_minter=lambda url, room: {"id": "r", "token": "SENTINEL-TOKEN"},
    )

    def close(cid):
        state["closes"] += 1
        state["listening"] = False
        return {"closed": True}

    console.close_console = close
    return local, state


@pytest.mark.parametrize("label", sorted(EXITS))
def test_every_exit_path_closes_the_console_and_removes_the_store(
    tmp_path: Path, label: str
) -> None:
    raiser = EXITS[label]
    local, state = build(tmp_path, f"exit-{label}")

    def body():
        with local as handle:
            handle.start()
            state["listening"] = True
            store = Path(handle.store_dir)
            assert store.is_dir()
            if raiser is not None:
                raise raiser("exit path under test")
            return store

    if raiser is None:
        store_dir = body()
    else:
        with pytest.raises(raiser):
            body()
        store_dir = Path(local.store_dir)

    assert state["closes"] == 1, f"{label}: the console was not closed"
    assert not store_dir.exists(), f"{label}: the run-scoped store survived"
    assert local.started is False, f"{label}: the relay still reports itself as started"


def test_a_relay_that_never_started_needs_no_teardown_on_any_path(
    tmp_path: Path,
) -> None:
    local, state = build(tmp_path, "never-started")
    with pytest.raises(Boom):
        with local:
            raise Boom("failed before start()")
    assert state["closes"] == 0
    assert local.started is False


def test_the_exit_paths_are_genuinely_different_exception_hierarchies() -> None:
    assert issubclass(Boom, Exception)
    assert issubclass(KeyboardInterrupt, BaseException) and not issubclass(
        KeyboardInterrupt, Exception
    )
    assert issubclass(SystemExit, BaseException) and not issubclass(SystemExit, Exception)
    assert issubclass(Aborted, BaseException) and not issubclass(Aborted, Exception)
