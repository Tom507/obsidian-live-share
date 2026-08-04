# WP70 / AC3 — blind counterpart 1 for "stop runs on success, failure, abort and
# KeyboardInterrupt".
#
# Different angle: the relay is entered inside a `contextlib.ExitStack` alongside other
# resources, which is how a real gate run holds it — and the exit paths are driven by a
# generator that is closed early (GeneratorExit) and by an exception raised from a nested
# context. Release must still happen exactly once.
#
# DATA SAFETY: no socket is opened and no process is started; every probe is injected.

from __future__ import annotations

import contextlib
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

RUN_ID = "20260803T175959Z-29-99aabb"


class Boom(RuntimeError):
    pass


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


def test_an_exit_stack_releases_the_relay_on_a_normal_exit(tmp_path: Path) -> None:
    local, state = build(tmp_path, "stack-normal")
    with contextlib.ExitStack() as stack:
        handle = stack.enter_context(local)
        handle.start()
        state["listening"] = True
        store_dir = Path(handle.store_dir)
    assert state["closes"] == 1
    assert not store_dir.exists()


def test_an_exit_stack_releases_the_relay_when_a_later_resource_raises(
    tmp_path: Path,
) -> None:
    local, state = build(tmp_path, "stack-raises")

    @contextlib.contextmanager
    def failing_resource():
        yield "resource"
        raise Boom("teardown of a later resource failed")

    with pytest.raises(Boom):
        with contextlib.ExitStack() as stack:
            handle = stack.enter_context(local)
            handle.start()
            state["listening"] = True
            stack.enter_context(failing_resource())
    assert state["closes"] == 1


def test_a_generator_closed_early_still_releases(tmp_path: Path) -> None:
    local, state = build(tmp_path, "generator")

    def run():
        with local as handle:
            handle.start()
            state["listening"] = True
            yield handle
            yield handle  # never reached: the generator is closed after the first yield

    gen = run()
    next(gen)
    gen.close()  # raises GeneratorExit inside the `with`
    assert state["closes"] == 1


def test_release_is_idempotent_when_the_body_also_released(tmp_path: Path) -> None:
    local, state = build(tmp_path, "double")
    with local as handle:
        handle.start()
        state["listening"] = True
        handle.release()
    assert state["closes"] == 1, "the context manager released a second time"


def test_the_relay_was_genuinely_running_inside_the_stack(tmp_path: Path) -> None:
    local, state = build(tmp_path, "genuine")
    with contextlib.ExitStack() as stack:
        handle = stack.enter_context(local)
        handle.start()
        state["listening"] = True
        assert handle.console_id is not None
        assert Path(handle.store_dir).is_dir()
    assert state["closes"] == 1
