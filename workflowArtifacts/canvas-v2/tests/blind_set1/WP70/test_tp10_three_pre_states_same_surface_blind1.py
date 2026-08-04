# WP70 / AC2 — blind counterpart 1 for "the rig does not assume the two vaults' stored
# values agree, are empty, or are equal — provisioning succeeds from three different
# pre-states and lands the same narrowed surface".
#
# Different data: the pre-states are shaped by what is MISSING rather than by what is
# set — the key absent entirely, the key present as `null`, and the key present with the
# scratch folder's own name already in it (the pre-state that would let a lazy
# implementation "already be correct" for the wrong reason).
#
# DATA SAFETY: synthetic fixture vaults under tmp_path, guarded against both owner vaults.

from __future__ import annotations

import json
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

RUN_ID = "20260804T070707Z-15-bbccdd"

PRE_STATES = {
    "key_absent": b'{\n  "clientId": "no-shared-folder-key"\n}\n',
    "key_null": b'{\n  "sharedFolder": null,\n  "excludePatterns": null\n}\n',
    "already_the_scratch_folder": (
        b'{\n  "sharedFolder": "_e2e-rig",\n  "excludePatterns": ["_e2e-rig/**"]\n}\n'
    ),
    "nested_owner_folder": b'{\n  "sharedFolder": "Team/Projekte/Aktuell"\n}\n',
}


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


def make_room() -> relay.RelayRoom:
    return relay.RelayRoom(
        id="6f6f6f6f-7070-8181-9292-a3a3b4b4c5c5",
        token="SENTINEL-BLIND1-TOKEN",
        name=f"{constants.RELAY_ROOM_NAME_PREFIX}{RUN_ID}",
        base_url=constants.RELAY_BASE_URL,
    )


def provision(tmp_path: Path, label: str, role: str) -> Path:
    vault = assert_synthetic(tmp_path / f"vault-{label}-{role}")
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(PRE_STATES[label])
    provisioning.provision_gate_settings(
        vault, role, room=make_room(), run_id=RUN_ID, control_probe=silent_control_probe
    )
    return vault


@pytest.mark.parametrize("label", sorted(PRE_STATES))
@pytest.mark.parametrize("role", constants.ROLES)
def test_every_pre_state_lands_the_same_narrowed_surface(
    tmp_path: Path, label: str, role: str
) -> None:
    vault = provision(tmp_path, label, role)
    parsed = json.loads((vault / constants.PLUGIN_DATA_REL).read_bytes().decode("utf-8-sig"))
    assert parsed["sharedFolder"] == constants.SCRATCH_FOLDER
    assert parsed["excludePatterns"] == []


@pytest.mark.parametrize("label", sorted(PRE_STATES))
def test_every_pre_state_restores_byte_exactly(tmp_path: Path, label: str) -> None:
    vault = provision(tmp_path, label, constants.ROLE_A)
    provisioning.restore_gate_settings(vault)
    assert (vault / constants.PLUGIN_DATA_REL).read_bytes() == PRE_STATES[label]


def test_the_already_correct_pre_state_is_still_narrowed_not_trusted(
    tmp_path: Path,
) -> None:
    # This vault's sharedFolder is already the scratch folder — but its excludePatterns
    # would exclude the scratch folder from the surface, which is a shared surface
    # containing nothing. The rig establishes the state; it does not trust it.
    vault = provision(tmp_path, "already_the_scratch_folder", constants.ROLE_B)
    parsed = json.loads((vault / constants.PLUGIN_DATA_REL).read_bytes().decode("utf-8"))
    assert parsed["excludePatterns"] == []


def test_fixture_audit_the_pre_states_are_genuinely_different() -> None:
    parsed = {label: json.loads(raw.decode("utf-8")) for label, raw in PRE_STATES.items()}
    assert "sharedFolder" not in parsed["key_absent"]
    assert parsed["key_null"]["sharedFolder"] is None
    assert parsed["already_the_scratch_folder"]["excludePatterns"] != []
    assert parsed["nested_owner_folder"]["sharedFolder"].count("/") == 2
