# WP70 / AC3 — blind counterpart 2 for "readiness is a positive GET /healthz `ok` probe,
# bounded, naming the awaited condition on expiry; no sleep is used as a wait".
#
# Different angle: falsification of the NEGATIVE half. "never a sleep, and never the mere
# fact that a process was spawned." So: an `ok` that is not the boolean `true` is not
# readiness; a body that arrives without the loop having been given a chance to poll is
# impossible; and the whole rig source is scanned for a wall-clock wait, since the
# charter's "no wall-clock sleeps anywhere" covers the stop path and the AC5 windows too.
#
# DATA SAFETY: no socket is opened and no process is started; every probe is injected.

from __future__ import annotations

import re
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

RUN_ID = "20260803T225959Z-24-445566"
NOT_OK = (
    {"ok": "true", "documents": 0, "clients": 0},
    {"ok": 1, "documents": 0, "clients": 0},
    {"ok": None},
    {"ok": False},
    {},
    None,
)


class Clock:
    def __init__(self) -> None:
        self.now = 10.0
        self.slept: list = []

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds


def build(tmp_path: Path, name: str, body):
    console = relay.RelayPlanConsole()
    repo_root = tmp_path / name
    (repo_root / constants.RELAY_ENTRY_REL).parent.mkdir(parents=True, exist_ok=True)
    (repo_root / constants.RELAY_ENTRY_REL).write_bytes(b"// built\n")
    clock = Clock()
    local = relay.LocalRelay(
        console=console,
        repo_root=repo_root,
        run_id=RUN_ID,
        store_root=tmp_path / f"stores-{name}",
        port_probe=lambda host, port: False,
        health_probe=lambda url: body,
        room_minter=lambda url, room: {"id": "r", "token": "SENTINEL-TOKEN"},
        clock=clock,
        sleeper=clock.sleep,
    )
    return local, clock


@pytest.mark.parametrize("body", NOT_OK, ids=lambda b: repr(b)[:28])
def test_only_a_boolean_true_ok_counts_as_ready(tmp_path: Path, body) -> None:
    local, _clock = build(tmp_path, f"v{abs(hash(repr(body))) % 9999}", body)
    local.start()
    with pytest.raises(relay.RelayReadinessTimeout):
        local.wait_ready(timeout_s=1.0)
    assert local.ready is False


def test_a_boolean_true_ok_does_count(tmp_path: Path) -> None:
    local, clock = build(tmp_path, "ready", {"ok": True, "documents": 0, "clients": 0})
    local.start()
    assert local.wait_ready(timeout_s=1.0)["ok"] is True
    assert clock.slept == []


def test_the_relay_module_uses_no_wall_clock_wait_anywhere() -> None:
    source = (_TOOLS / "obsidian_e2e" / "relay.py").read_text(encoding="utf-8")
    for pattern in (
        r"\btime\s*\.\s*sleep\s*\(",
        r"\basyncio\s*\.\s*sleep\s*\(",
        r"\bEvent\s*\(\s*\)\s*\.\s*wait\s*\(",
        r"\bselect\s*\.\s*select\s*\(",
    ):
        assert re.search(pattern, source) is None, f"relay.py matches {pattern}"


def test_the_provisioning_module_uses_no_wall_clock_wait_anywhere() -> None:
    source = (_TOOLS / "obsidian_e2e" / "provisioning.py").read_text(encoding="utf-8")
    assert re.search(r"\btime\s*\.\s*sleep\s*\(", source) is None
    assert re.search(r"\basyncio\s*\.\s*sleep\s*\(", source) is None


def test_mint_room_is_still_refused_after_a_not_ok_body(tmp_path: Path) -> None:
    # A spawned-process fact plus a healthz body that is not `ok` is not readiness, and
    # the room boundary must still refuse.
    local, _clock = build(tmp_path, "notok", {"ok": False})
    local.start()
    with pytest.raises(relay.RelayReadinessTimeout):
        local.wait_ready(timeout_s=1.0)
    with pytest.raises(relay.GateOrderViolation) as excinfo:
        local.mint_room()
    assert excinfo.value.reason == constants.GATE_ORDER_VIOLATION
