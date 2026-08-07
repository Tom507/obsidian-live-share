# WP70 / AC3, D15 / S2 — blind counterpart 2 for "the rig never terminates a process it
# did not start".
#
# Different angle: the console double is armed to RECORD any attempt at all. If the rig
# reaches for a close on a relay it does not own, the double raises immediately, so the
# failure is attributed at the call site rather than to a later assertion. A second relay
# object pointed at the same port must also not be able to close the first one's console.
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

RUN_ID = "20260804T000102Z-22-223344"


class ForbiddenClose(AssertionError):
    """Raised at the call site the moment the rig reaches for a foreign process."""


class ArmedConsole(relay.RelayPlanConsole):
    def __init__(self) -> None:
        super().__init__()
        self.armed = True
        self.closed: list = []

    def close_console(self, console_id):
        if self.armed:
            raise ForbiddenClose(f"the rig tried to close {console_id!r}")
        self.closed.append(console_id)
        return {"closed": True}


def build(tmp_path: Path, name: str, *, occupied: bool, console=None):
    console = console or ArmedConsole()
    repo_root = tmp_path / name
    (repo_root / constants.RELAY_ENTRY_REL).parent.mkdir(parents=True, exist_ok=True)
    (repo_root / constants.RELAY_ENTRY_REL).write_bytes(b"// built\n")
    return (
        relay.LocalRelay(
            console=console,
            repo_root=repo_root,
            run_id=RUN_ID,
            store_root=tmp_path / f"stores-{name}",
            port_probe=lambda host, port: occupied,
            health_probe=lambda url: {"ok": True, "documents": 0, "clients": 0},
            room_minter=lambda url, room: {"id": "r", "token": "SENTINEL-TOKEN"},
        ),
        console,
    )


def test_stop_on_an_unstarted_relay_never_reaches_close(tmp_path: Path) -> None:
    local, console = build(tmp_path, "never", occupied=False)
    result = local.stop()
    assert console.closed == []
    assert result.closed is False


def test_release_after_a_port_refusal_never_reaches_close(tmp_path: Path) -> None:
    local, console = build(tmp_path, "refused", occupied=True)
    with pytest.raises(relay.RelayPortOccupied):
        local.start()
    result = local.release()  # must not raise ForbiddenClose
    assert console.closed == []
    assert result.closed is False


def test_a_second_relay_object_cannot_close_the_first_ones_console(
    tmp_path: Path,
) -> None:
    first, console = build(tmp_path, "first", occupied=False)
    first.start()
    assert first.console_id is not None

    second, _same = build(tmp_path, "second", occupied=True, console=console)
    with pytest.raises(relay.RelayPortOccupied):
        second.start()
    result = second.stop()  # armed console would raise if it reached close
    assert result.closed is False
    assert console.closed == []


def test_the_armed_console_really_would_have_fired(tmp_path: Path) -> None:
    # Without this, "never reached close" would pass for a console that cannot raise.
    local, console = build(tmp_path, "armed", occupied=False)
    local.start()
    with pytest.raises(ForbiddenClose):
        local.stop()


def test_disarming_the_console_lets_the_rigs_own_stop_complete(tmp_path: Path) -> None:
    local, console = build(tmp_path, "disarmed", occupied=False)
    local.start()
    console.armed = False
    result = local.stop()
    assert console.closed == [local.console_id] or len(console.closed) == 1
    assert result.closed is True
