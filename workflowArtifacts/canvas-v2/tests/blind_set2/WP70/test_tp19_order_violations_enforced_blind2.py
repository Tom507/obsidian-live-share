# WP70 / AC4 — blind counterpart 2 for "out-of-order calls raise GATE_ORDER_VIOLATION at
# the boundary that owns them".
#
# Different angle: the pinned boundary TABLE is walked as data. Each row is exercised as
# a pair — the violating call, and the same call once its predecessor has run — so every
# row is shown both to refuse and to be satisfiable. A row that only ever refuses is a
# boundary nobody can pass, which is not enforcement either.
#
# DATA SAFETY: synthetic fixture vault under tmp_path, guarded against both owner vaults.
# No socket is opened and no process is started.

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

from obsidian_e2e import constants, provisioning, relay  # noqa: E402

OWNER_VAULTS = (
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga"),
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie"),
)

RUN_ID = "20260803T145959Z-32-ccddee"
ORIGINAL = b'{\n  "clientId": "fixture-order"\n}\n'


def silent_control_probe(port: int) -> bool:
    return False


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


def build(tmp_path: Path, name: str):
    console = relay.RelayPlanConsole()
    repo_root = tmp_path / f"repo-{name}"
    (repo_root / constants.RELAY_ENTRY_REL).parent.mkdir(parents=True, exist_ok=True)
    (repo_root / constants.RELAY_ENTRY_REL).write_bytes(b"// built\n")
    state = {"listening": False}
    return relay.LocalRelay(
        console=console,
        repo_root=repo_root,
        run_id=RUN_ID,
        store_root=tmp_path / f"stores-{name}",
        port_probe=lambda host, port: bool(state["listening"]),
        health_probe=lambda url: {"ok": True, "documents": 0, "clients": 0},
        room_minter=lambda url, room: {"id": "room-x", "token": "SENTINEL-TOKEN"},
    ), state


def test_row_mint_room_before_healthz_refuses_then_passes(tmp_path: Path) -> None:
    local, state = build(tmp_path, "row1")
    local.start()
    state["listening"] = True

    with pytest.raises(relay.GateOrderViolation):
        local.mint_room()

    local.wait_ready()
    room = local.mint_room()
    assert room.id == "room-x"


def test_row_provision_without_a_room_refuses_then_passes(tmp_path: Path) -> None:
    local, state = build(tmp_path, "row2")
    local.start()
    state["listening"] = True
    local.wait_ready()
    vault = make_vault(tmp_path, "vault-row2")

    with pytest.raises(provisioning.GateOrderViolation):
        provisioning.provision_gate_settings(
            vault, constants.ROLE_A, room=None, run_id=RUN_ID, control_probe=silent_control_probe
        )
    assert (vault / constants.PLUGIN_DATA_REL).read_bytes() == ORIGINAL

    room = local.mint_room()
    record = provisioning.provision_gate_settings(
        vault, constants.ROLE_A, room=room, run_id=RUN_ID, control_probe=silent_control_probe
    )
    assert record.room_id == "room-x"


def test_row_gate_sequence_step_out_of_order_refuses_then_passes() -> None:
    steps = provisioning.GateSequence.STEPS
    sequence = provisioning.GateSequence(run_id=RUN_ID)

    with pytest.raises(provisioning.GateOrderViolation):
        sequence.begin(steps[1])

    sequence.begin(steps[0])
    sequence.complete(steps[0])
    sequence.begin(steps[1])
    assert sequence.current == steps[1]


def test_every_boundary_raises_the_one_shared_exception_type() -> None:
    assert provisioning.GateOrderViolation is relay.GateOrderViolation
    assert relay.GateOrderViolation.reason == constants.GATE_ORDER_VIOLATION
    assert issubclass(relay.GateOrderViolation, relay.RelayError)


def test_the_ordering_is_enforced_and_not_merely_described() -> None:
    # A pinned order that the code does not check is an order an agent can step around.
    steps = provisioning.GateSequence.STEPS
    for skip in range(2, len(steps)):
        sequence = provisioning.GateSequence(run_id=RUN_ID)
        sequence.begin(steps[0])
        sequence.complete(steps[0])
        with pytest.raises(provisioning.GateOrderViolation):
            sequence.begin(steps[skip])
