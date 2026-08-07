# WP70 / AC1 — "the marker's pinned field set is unchanged, and the restore path is not
# modified at all."
#
# WP70 writes ten members where WP44 wrote one. The temptation is to record what was
# written into the marker — which would add fields to a set that `ports.py` validates by
# exact comparison, and would put provisioned values into a file on disk, which S4
# forbids. The marker's job is to record what the OWNER had; that job did not change.
#
#   ├── T1 the pinned marker field set is still WP44's seven fields, in order
#   ├── T2 a ten-member provisioning writes a marker with exactly those seven keys
#   ├── T3 the marker carries no provisioned value and no room identifier
#   ├── T4 restore is still driven by the backup file, not by the provisioned state
#   ├── T5 restore still removes the backup and the marker, leaving no rig artefact
#   └── T6 the no-prior-file case still restores to NO FILE, not to an empty object
#
# DATA SAFETY: synthetic fixture vaults under tmp_path, guarded against both owner
# vaults. Sentinel credential values only.

from __future__ import annotations

import json
import sys
from pathlib import Path

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

WP44_MARKER_FIELDS = (
    "runId",
    "role",
    "port",
    "hadOriginal",
    "originalSha256",
    "pid",
    "createdAt",
)

ROOM_ID = "11111111-2222-3333-4444-555555555555"
SENTINEL_ROOM_TOKEN = "SENTINEL-ROOM-TOKEN-c0ffee-DO-NOT-LEAK"

ORIGINAL = b'{\n  "clientId": "fixture-client",\n  "sharedFolder": "Notes/Shared"\n}\n'


def assert_synthetic(path: Path) -> Path:
    resolved = Path(path).resolve()
    for owner in OWNER_VAULTS:
        owner_resolved = Path(owner).resolve()
        assert resolved != owner_resolved, f"ABORT: {resolved} is an owner vault"
        assert owner_resolved not in resolved.parents, f"ABORT: {resolved} is inside an owner vault"
        assert resolved not in owner_resolved.parents, f"ABORT: {resolved} contains an owner vault"
    return resolved


def make_vault(tmp_path: Path, name: str, data_json) -> Path:
    vault = assert_synthetic(tmp_path / name)
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    if data_json is not None:
        (vault / constants.PLUGIN_DATA_REL).write_bytes(data_json)
    return vault


def make_room() -> relay.RelayRoom:
    return relay.RelayRoom(
        id=ROOM_ID,
        token=SENTINEL_ROOM_TOKEN,
        name=f"{constants.RELAY_ROOM_NAME_PREFIX}20260804T000000Z-1-a1b2c3",
        base_url=constants.RELAY_BASE_URL,
    )

def test_the_pinned_marker_field_set_is_still_wp44s_seven_fields() -> None:
    assert constants.PROVISION_MARKER_FIELDS == WP44_MARKER_FIELDS


def test_a_ten_member_provisioning_writes_exactly_those_seven_marker_keys(
    tmp_path: Path,
) -> None:
    vault = make_vault(tmp_path, "vault-marker", ORIGINAL)
    provisioning.provision_gate_settings(vault, constants.ROLE_A, room=make_room(), control_probe=silent_control_probe)

    marker = json.loads((vault / constants.PROVISION_MARKER_REL).read_bytes().decode("utf-8"))
    assert tuple(marker) == WP44_MARKER_FIELDS


def test_the_marker_carries_no_provisioned_value_and_no_room_identifier(
    tmp_path: Path,
) -> None:
    vault = make_vault(tmp_path, "vault-marker-values", ORIGINAL)
    provisioning.provision_gate_settings(vault, constants.ROLE_A, room=make_room(), control_probe=silent_control_probe)

    raw = (vault / constants.PROVISION_MARKER_REL).read_bytes().decode("utf-8")
    assert ROOM_ID not in raw
    assert SENTINEL_ROOM_TOKEN not in raw
    assert constants.SETTINGS_SHARED_FOLDER not in raw
    assert "Notes/Shared" not in raw, "an owner value reached the marker"
    for key in constants.PROVISIONED_SETTINGS_KEYS:
        if key == "role":  # the marker legitimately records the rig role "a"/"b"
            continue
        assert key not in raw, f"the marker records the provisioned key {key}"


def test_restore_is_driven_by_the_backup_not_by_the_provisioned_state(
    tmp_path: Path,
) -> None:
    # The restore path reads the backup verbatim. Rewriting the live file to something
    # else entirely must not change what restore produces.
    vault = make_vault(tmp_path, "vault-restore-source", ORIGINAL)
    settings = vault / constants.PLUGIN_DATA_REL
    provisioning.provision_gate_settings(vault, constants.ROLE_B, room=make_room(), control_probe=silent_control_probe)

    settings.write_bytes(b'{"clobbered": true}\n')
    provisioning.restore_gate_settings(vault)

    assert settings.read_bytes() == ORIGINAL


def test_restore_leaves_no_rig_artefact_behind(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-artefacts", ORIGINAL)
    plugin_dir = vault / constants.PLUGIN_DIR_REL
    names_before = sorted(p.name for p in plugin_dir.iterdir())

    provisioning.provision_gate_settings(vault, constants.ROLE_A, room=make_room(), control_probe=silent_control_probe)
    assert (vault / constants.SETTINGS_BACKUP_REL).is_file()
    assert (vault / constants.PROVISION_MARKER_REL).is_file()

    result = provisioning.restore_gate_settings(vault)
    assert result.restored is True
    assert not (vault / constants.SETTINGS_BACKUP_REL).exists()
    assert not (vault / constants.PROVISION_MARKER_REL).exists()
    assert sorted(p.name for p in plugin_dir.iterdir()) == names_before


def test_the_no_prior_file_case_still_restores_to_no_file(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-absent", None)
    settings = vault / constants.PLUGIN_DATA_REL
    assert not settings.exists()

    provisioning.provision_gate_settings(vault, constants.ROLE_A, room=make_room(), control_probe=silent_control_probe)
    assert settings.is_file()

    result = provisioning.restore_gate_settings(vault)
    assert result.restored is True
    assert result.had_original is False
    assert result.settings_file_present is False
    assert not settings.exists(), "teardown left an empty file where the owner had none"
