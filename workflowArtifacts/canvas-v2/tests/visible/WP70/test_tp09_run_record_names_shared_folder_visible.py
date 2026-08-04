# WP70 / AC2 — "The rig states this positively in its run record — which folder is
# shared, in both vaults — rather than inferring it from a successful sync."
#
# "Positively, in both vaults" is the whole assertion. A record that names one vault, or
# that says "sharing established: true" without naming the folder, or that is derived by
# reading back the file the provisioner just wrote, does not satisfy AC2 — and C50 AC5
# is the independent detector precisely so that read-back cannot become the evidence.
#
#   ├── T1 the record names the shared folder for BOTH roles, explicitly
#   ├── T2 the record names the folder as a value, not merely a boolean
#   ├── T3 a record built from one vault only is refused, not silently accepted
#   ├── T4 a record whose two vaults disagree is refused under SHARED_SURFACE_NOT_ESTABLISHED
#   ├── T5 the record carries no room token and no owner settings value
#   └── T6 the record is JSON-serialisable — a run record that cannot be written is none
#
# DATA SAFETY: synthetic fixture vaults under tmp_path, guarded against both owner
# vaults. Sentinel credential values only.

from __future__ import annotations

import json
import sys
from dataclasses import replace
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

SENTINEL_ROOM_TOKEN = "SENTINEL-ROOM-TOKEN-c0ffee-DO-NOT-LEAK"
RUN_ID = "20260804T000000Z-1-a1b2c3"

ORIGINAL_A = b'{\n  "sharedFolder": "",\n  "clientId": "fixture-a"\n}\n'
ORIGINAL_B = b'{\n  "sharedFolder": "Notizen",\n  "clientId": "fixture-b"\n}\n'


def assert_synthetic(path: Path) -> Path:
    resolved = Path(path).resolve()
    for owner in OWNER_VAULTS:
        owner_resolved = Path(owner).resolve()
        assert resolved != owner_resolved, f"ABORT: {resolved} is an owner vault"
        assert owner_resolved not in resolved.parents, f"ABORT: {resolved} is inside an owner vault"
        assert resolved not in owner_resolved.parents, f"ABORT: {resolved} contains an owner vault"
    return resolved


def make_vault(tmp_path: Path, name: str, data_json: bytes) -> Path:
    vault = assert_synthetic(tmp_path / name)
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(data_json)
    return vault


def make_room() -> relay.RelayRoom:
    return relay.RelayRoom(
        id="11111111-2222-3333-4444-555555555555",
        token=SENTINEL_ROOM_TOKEN,
        name=f"{constants.RELAY_ROOM_NAME_PREFIX}{RUN_ID}",
        base_url=constants.RELAY_BASE_URL,
    )


@pytest.fixture()
def both_records(tmp_path: Path) -> list:
    room = make_room()
    vault_a = make_vault(tmp_path, "vault-a", ORIGINAL_A)
    vault_b = make_vault(tmp_path, "vault-b - Kopie", ORIGINAL_B)
    return [
        provisioning.provision_gate_settings(vault_a, constants.ROLE_A, room=room, run_id=RUN_ID, control_probe=silent_control_probe),
        provisioning.provision_gate_settings(vault_b, constants.ROLE_B, room=room, run_id=RUN_ID, control_probe=silent_control_probe),
    ]

def test_the_record_names_the_shared_folder_for_both_roles(both_records: list) -> None:
    record = provisioning.shared_surface_record(both_records)

    roles = [entry["role"] for entry in record["vaults"]]
    assert sorted(roles) == sorted(constants.ROLES)
    for entry in record["vaults"]:
        assert entry["sharedFolder"] == constants.SCRATCH_FOLDER
        assert entry["vaultPath"]


def test_the_record_names_the_folder_as_a_value_not_merely_a_boolean(
    both_records: list,
) -> None:
    record = provisioning.shared_surface_record(both_records)
    assert record["sharedFolder"] == constants.SCRATCH_FOLDER
    assert record["excludePatterns"] == []
    assert record["established"] is True
    # A boolean alone would satisfy "established" without saying WHAT is shared.
    assert isinstance(record["sharedFolder"], str) and record["sharedFolder"]


def test_a_record_built_from_one_vault_only_is_refused(both_records: list) -> None:
    with pytest.raises(provisioning.SharedSurfaceNotEstablished) as excinfo:
        provisioning.shared_surface_record(both_records[:1])
    assert excinfo.value.reason == constants.SHARED_SURFACE_NOT_ESTABLISHED


def test_a_record_whose_two_vaults_disagree_is_refused(both_records: list) -> None:
    doctored = [both_records[0], replace(both_records[1], shared_folder="Notizen")]
    with pytest.raises(provisioning.SharedSurfaceNotEstablished) as excinfo:
        provisioning.shared_surface_record(doctored)
    assert excinfo.value.reason == constants.SHARED_SURFACE_NOT_ESTABLISHED


def test_the_record_carries_no_room_token_and_no_owner_settings_value(
    both_records: list,
) -> None:
    raw = json.dumps(provisioning.shared_surface_record(both_records))
    assert SENTINEL_ROOM_TOKEN not in raw
    assert "fixture-a" not in raw and "fixture-b" not in raw
    assert "Notizen" not in raw


def test_the_record_is_json_serialisable(both_records: list) -> None:
    raw = json.dumps(provisioning.shared_surface_record(both_records), sort_keys=True)
    assert json.loads(raw)["sharedFolder"] == constants.SCRATCH_FOLDER
