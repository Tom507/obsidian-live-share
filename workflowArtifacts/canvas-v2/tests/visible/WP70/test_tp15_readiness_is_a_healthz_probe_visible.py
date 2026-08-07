# WP70 / AC3 — "Readiness is a **positive probe of `GET /healthz` reporting `ok`**,
# bounded, naming the awaited condition on expiry — never a sleep, and never the mere
# fact that a process was spawned."
#
# Three distinct claims, each falsifiable on its own:
#   * POSITIVE — the oracle is the body the server sends about itself, not a spawn.
#   * BOUNDED  — it expires, and the expiry names the condition it was waiting for.
#   * NOT A SLEEP — the loop is driven by the probe. With a clock that never advances,
#     a condition-driven loop still returns; a sleep-driven one cannot. And with a probe
#     that is ok immediately, the pause seam is never used at all.
#
#   ├── T1 a started relay is NOT ready — a spawned-process fact is not readiness
#   ├── T2 wait_ready returns the healthz body once it reports ok
#   ├── T3 a probe that is ok on the first call never invokes the pause seam
#   ├── T4 with a frozen clock, readiness still arrives — the loop polls the condition
#   ├── T5 expiry raises RELAY_READINESS_TIMEOUT naming /healthz and `ok`
#   ├── T6 a healthz body WITHOUT ok:true never counts as ready
#   └── T7 relay.py never calls time.sleep — the pause is an injected seam
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
        _REPO = _parent
        _TOOLS = _parent / "tools"
        break
else:  # pragma: no cover
    raise RuntimeError(f"obsidian-live-share repo root not found from {__file__}")
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, relay  # noqa: E402

RUN_ID = "20260804T000000Z-1-a1b2c3"
HEALTHY = {"ok": True, "uptime": 1.5, "sessions": 0, "documents": 0, "clients": 0}


class Clock:
    """A clock the test advances explicitly; nothing here waits on wall time."""

    def __init__(self) -> None:
        self.now = 1000.0
        self.slept: list = []

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds


def make_relay(tmp_path: Path, health_sequence: list, clock: Clock, **kwargs):
    console = relay.RelayPlanConsole()
    entry = tmp_path / "repo" / constants.RELAY_ENTRY_REL
    entry.parent.mkdir(parents=True, exist_ok=True)
    entry.write_bytes(b"// built relay entry\n")
    calls = {"n": 0}

    def health_probe(base_url: str):
        index = min(calls["n"], len(health_sequence) - 1)
        calls["n"] += 1
        return health_sequence[index]

    local = relay.LocalRelay(
        console=console,
        repo_root=tmp_path / "repo",
        run_id=RUN_ID,
        store_root=tmp_path / "store-root",
        port_probe=lambda host, port: False,
        health_probe=health_probe,
        room_minter=lambda base_url, name: {"id": "room-1", "token": "SENTINEL-TOKEN"},
        clock=clock,
        sleeper=clock.sleep,
        **kwargs,
    )
    local.probe_calls = calls  # type: ignore[attr-defined]
    return local


def test_a_started_relay_is_not_ready(tmp_path: Path) -> None:
    clock = Clock()
    local = make_relay(tmp_path, [None], clock)
    local.start()
    assert local.started is True
    assert local.ready is False, "a spawn that returned was treated as readiness"


def test_wait_ready_returns_the_healthz_body_once_it_reports_ok(tmp_path: Path) -> None:
    clock = Clock()
    local = make_relay(tmp_path, [None, None, HEALTHY], clock)
    local.start()

    body = local.wait_ready()
    assert body["ok"] is True
    assert body == HEALTHY
    assert local.ready is True
    assert local.probe_calls["n"] == 3, "the loop stopped polling before the condition held"


def test_a_probe_that_is_ok_immediately_never_uses_the_pause_seam(tmp_path: Path) -> None:
    clock = Clock()
    local = make_relay(tmp_path, [HEALTHY], clock)
    local.start()
    local.wait_ready()
    assert clock.slept == [], "the rig slept before asking the condition"


def test_with_a_frozen_clock_readiness_still_arrives(tmp_path: Path) -> None:
    # A loop driven by elapsed time cannot make progress here; one driven by the probe
    # can. This is the assertion that distinguishes a wait from a sleep.
    class FrozenClock(Clock):
        def sleep(self, seconds: float) -> None:
            self.slept.append(seconds)  # deliberately does NOT advance `now`

    clock = FrozenClock()
    local = make_relay(tmp_path, [None, None, None, HEALTHY], clock)
    local.start()
    body = local.wait_ready(timeout_s=5.0)
    assert body["ok"] is True
    assert local.probe_calls["n"] == 4


def test_expiry_names_the_awaited_condition(tmp_path: Path) -> None:
    clock = Clock()
    local = make_relay(tmp_path, [None], clock)
    local.start()

    with pytest.raises(relay.RelayReadinessTimeout) as excinfo:
        local.wait_ready(timeout_s=2.0)

    message = str(excinfo.value)
    assert excinfo.value.reason == constants.RELAY_READINESS_TIMEOUT
    assert constants.RELAY_HEALTH_PATH in message
    assert "ok" in message
    assert local.ready is False
    # Bounded: it gave up rather than polling forever, within one poll of the budget.
    assert clock.now - 1000.0 <= 2.0 + relay.POLL_INTERVAL_S


def test_a_healthz_body_without_ok_true_is_never_ready(tmp_path: Path) -> None:
    clock = Clock()
    local = make_relay(tmp_path, [{"ok": False, "documents": 0, "clients": 0}], clock)
    local.start()
    with pytest.raises(relay.RelayReadinessTimeout):
        local.wait_ready(timeout_s=1.0)
    assert local.ready is False


def test_relay_py_never_calls_time_sleep() -> None:
    source = (_TOOLS / "obsidian_e2e" / "relay.py").read_text(encoding="utf-8")
    assert re.search(r"\btime\s*\.\s*sleep\s*\(", source) is None, (
        "relay.py calls time.sleep directly; the pause must be the injected seam"
    )
    assert re.search(r"\basyncio\s*\.\s*sleep\s*\(", source) is None
    assert "sleeper" in source, "relay.py has no injected pause seam"
