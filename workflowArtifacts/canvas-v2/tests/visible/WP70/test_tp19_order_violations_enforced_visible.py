# WP70 / AC4 — "Each ordering constraint is enforced by the code, not only documented."
#
# The run is agent-mediated (C71): `lifecycle.py`'s only console backend plans calls and
# an agent executes them. An ordering that only the plan expresses is an ordering an
# agent can step around, so each constraint must be a refusal AT THE BOUNDARY THAT OWNS
# IT — refusing wherever the out-of-order call arrives from. The pinned table:
#
#   | boundary                                            | refuses with            |
#   | relay.mint_room() before healthz ok                 | GATE_ORDER_VIOLATION    |
#   | provision_gate_settings() without a minted room     | GATE_ORDER_VIOLATION    |
#   | GateSequence step out of the pinned order           | GATE_ORDER_VIOLATION    |
#
#   ├── T1 mint_room() before start() is refused
#   ├── T2 mint_room() after start() but before healthz-ok is refused
#   ├── T3 provisioning without a minted room is refused, and writes nothing
#   ├── T4 a GateSequence step that skips a predecessor is refused
#   ├── T5 a GateSequence step replayed after completion is refused
#   └── T6 the two modules raise the SAME exception type, so a caller cannot miss one
#
# DATA SAFETY: synthetic fixture vault under tmp_path, guarded against both owner
# vaults. No socket is opened and no process is started.

from __future__ import annotations

import hashlib
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

from obsidian_e2e import constants, provisioning, relay  # noqa: E402


def silent_control_probe(port: int) -> bool:
    """No Obsidian instance is running in a unit test — and none may be started."""
    return False

OWNER_VAULTS = (
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga"),
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie"),
)

RUN_ID = "20260804T000000Z-1-a1b2c3"
ORIGINAL = b'{\n  "clientId": "fixture-client"\n}\n'


def assert_synthetic(path: Path) -> Path:
    resolved = Path(path).resolve()
    for owner in OWNER_VAULTS:
        owner_resolved = Path(owner).resolve()
        assert resolved != owner_resolved, f"ABORT: {resolved} is an owner vault"
        assert owner_resolved not in resolved.parents, f"ABORT: {resolved} is inside an owner vault"
        assert resolved not in owner_resolved.parents, f"ABORT: {resolved} contains an owner vault"
    return resolved


def make_vault(tmp_path: Path, name: str) -> Path:
    vault = assert_synthetic(tmp_path / name)
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(ORIGINAL)
    return vault


def make_relay(tmp_path: Path, *, healthy: bool = True):
    console = relay.RelayPlanConsole()
    repo_root = tmp_path / "repo"
    entry = repo_root / constants.RELAY_ENTRY_REL
    entry.parent.mkdir(parents=True, exist_ok=True)
    entry.write_bytes(b"// built relay entry\n")
    return relay.LocalRelay(
        console=console,
        repo_root=repo_root,
        run_id=RUN_ID,
        store_root=tmp_path / "store-root",
        port_probe=lambda host, port: False,
        health_probe=lambda base_url: {"ok": True, "documents": 0, "clients": 0}
        if healthy
        else None,
        room_minter=lambda base_url, name: {"id": "room-1", "token": "SENTINEL-TOKEN"},
    )


def plugin_dir_fingerprint(vault: Path) -> dict:
    directory = vault / constants.PLUGIN_DIR_REL
    return {
        p.name: hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(directory.iterdir())
        if p.is_file()
    }

def test_mint_room_before_start_is_refused(tmp_path: Path) -> None:
    local = make_relay(tmp_path)
    with pytest.raises(relay.GateOrderViolation) as excinfo:
        local.mint_room()
    assert excinfo.value.reason == constants.GATE_ORDER_VIOLATION
    assert local.room is None


def test_mint_room_before_healthz_ok_is_refused(tmp_path: Path) -> None:
    local = make_relay(tmp_path)
    local.start()
    assert local.ready is False
    with pytest.raises(relay.GateOrderViolation) as excinfo:
        local.mint_room()
    assert excinfo.value.reason == constants.GATE_ORDER_VIOLATION
    assert local.room is None
    # …and it works once readiness is established, so T2 is not vacuous.
    local.wait_ready()
    room = local.mint_room()
    assert room.id == "room-1"


def test_provisioning_without_a_minted_room_is_refused_and_writes_nothing(
    tmp_path: Path,
) -> None:
    vault = make_vault(tmp_path, "vault-no-room")
    before = plugin_dir_fingerprint(vault)
    with pytest.raises(provisioning.GateOrderViolation) as excinfo:
        provisioning.provision_gate_settings(vault, constants.ROLE_A, room=None, run_id=RUN_ID, control_probe=silent_control_probe)
    assert excinfo.value.reason == constants.GATE_ORDER_VIOLATION
    assert plugin_dir_fingerprint(vault) == before
    assert not (vault / constants.PROVISION_MARKER_REL).exists()


def test_a_gate_sequence_step_that_skips_a_predecessor_is_refused() -> None:
    sequence = provisioning.GateSequence(run_id=RUN_ID)
    steps = provisioning.GateSequence.STEPS
    assert len(steps) >= 5

    sequence.begin(steps[0])
    sequence.complete(steps[0])
    with pytest.raises(provisioning.GateOrderViolation) as excinfo:
        sequence.begin(steps[2])
    assert excinfo.value.reason == constants.GATE_ORDER_VIOLATION
    assert sequence.completed == (steps[0],)


def test_a_gate_sequence_step_replayed_after_completion_is_refused() -> None:
    sequence = provisioning.GateSequence(run_id=RUN_ID)
    steps = provisioning.GateSequence.STEPS
    sequence.begin(steps[0])
    sequence.complete(steps[0])
    sequence.begin(steps[1])
    sequence.complete(steps[1])

    with pytest.raises(provisioning.GateOrderViolation):
        sequence.begin(steps[0])
    with pytest.raises(provisioning.GateOrderViolation):
        sequence.begin("a-step-that-does-not-exist")
    assert sequence.completed == (steps[0], steps[1])


def test_both_modules_raise_the_same_order_violation_type() -> None:
    # One reason, one exception type: a caller that catches the relay's must also catch
    # the provisioner's, or the mediated run gets to step around half the table.
    assert provisioning.GateOrderViolation is relay.GateOrderViolation
    assert relay.GateOrderViolation.reason == constants.GATE_ORDER_VIOLATION
    assert constants.GATE_ORDER_VIOLATION in constants.FAILURE_REASONS
