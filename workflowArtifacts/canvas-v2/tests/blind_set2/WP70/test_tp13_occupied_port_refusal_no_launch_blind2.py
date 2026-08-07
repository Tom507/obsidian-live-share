# WP70 / AC3 — blind counterpart 2 for "an occupied port is a named refusal
# (RELAY_PORT_OCCUPIED) and no process is planned".
#
# Different angle: the STRUCTURAL guarantee behind "no process is planned". The console
# is an injected seam with no default — a relay constructed without one cannot exist —
# and the rig module contains no process-starting primitive at all. That is what makes
# it impossible for a test or a dev loop to reach a real process by accident (D16).
#
# DATA SAFETY: this test constructs relays and reads source. No socket, no process.

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

from obsidian_e2e import constants, lifecycle, relay  # noqa: E402

RUN_ID = "20260804T020202Z-20-001122"
FORBIDDEN = (
    r"\bimport\s+subprocess\b",
    r"\bfrom\s+subprocess\s+import\b",
    r"\bPopen\s*\(",
    r"\bos\s*\.\s*system\s*\(",
    r"\bos\s*\.\s*exec[a-z]*\s*\(",
    r"\bos\s*\.\s*spawn[a-z]*\s*\(",
    r"\bmultiprocessing\b",
)


def test_a_relay_cannot_be_constructed_without_a_console(tmp_path: Path) -> None:
    with pytest.raises(TypeError):
        relay.LocalRelay(repo_root=tmp_path, run_id=RUN_ID)  # type: ignore[call-arg]


@pytest.mark.parametrize("module", ["relay.py", "provisioning.py"])
@pytest.mark.parametrize("pattern", FORBIDDEN)
def test_the_new_modules_contain_no_process_starting_primitive(
    module: str, pattern: str
) -> None:
    source = (_TOOLS / "obsidian_e2e" / module).read_text(encoding="utf-8")
    assert re.search(pattern, source) is None, f"{module} matches {pattern}"


def test_the_relay_console_is_a_plan_only_console_subclass() -> None:
    assert issubclass(relay.RelayPlanConsole, lifecycle.PlanOnlyConsole)
    console = relay.RelayPlanConsole()
    assert hasattr(console, "close_console")
    assert console.requests == []


def test_an_occupied_port_refuses_before_the_console_is_used(tmp_path: Path) -> None:
    console = relay.RelayPlanConsole()
    repo_root = tmp_path / "repo"
    (repo_root / constants.RELAY_ENTRY_REL).parent.mkdir(parents=True, exist_ok=True)
    (repo_root / constants.RELAY_ENTRY_REL).write_bytes(b"// built\n")
    local = relay.LocalRelay(
        console=console,
        repo_root=repo_root,
        run_id=RUN_ID,
        store_root=tmp_path / "stores",
        port_probe=lambda host, port: True,
        health_probe=lambda base_url: None,
        room_minter=lambda base_url, name: {"id": "r", "token": "t"},
    )
    with pytest.raises(relay.RelayPortOccupied):
        local.start()
    assert console.requests == []
    assert local.console_id is None


def test_every_planned_payload_carries_an_argv_list_never_a_command_string(
    tmp_path: Path,
) -> None:
    console = relay.RelayPlanConsole()
    repo_root = tmp_path / "repo"
    (repo_root / constants.RELAY_ENTRY_REL).parent.mkdir(parents=True, exist_ok=True)
    (repo_root / constants.RELAY_ENTRY_REL).write_bytes(b"// built\n")
    local = relay.LocalRelay(
        console=console,
        repo_root=repo_root,
        run_id=RUN_ID,
        store_root=tmp_path / "stores",
        port_probe=lambda host, port: False,
        health_probe=lambda base_url: {"ok": True, "documents": 0, "clients": 0},
        room_minter=lambda base_url, name: {"id": "r", "token": "t"},
    )
    local.start()

    for request in console.requests:
        arguments = request["mcp"]["arguments"]
        if "argv" in arguments:
            assert isinstance(arguments["argv"], list)
            assert all(isinstance(part, str) for part in arguments["argv"])
