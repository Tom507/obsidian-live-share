# WP70 / AC1 — blind counterpart 1 for "the marker's pinned field set is unchanged, and
# the restore path is byte-unchanged".
#
# Different angle: the NO-PRIOR-FILE branch, where the marker records `hadOriginal:false`
# and the restore path must remove the rig's file rather than write one back — and a
# direct comparison of the marker written by the ten-member path against the marker
# written by WP44's one-member path, which must be the same shape.
#
# DATA SAFETY: synthetic fixture vaults under tmp_path, guarded against both owner vaults.

from __future__ import annotations

import json
import sys
from pathlib import Path

# --- repo bootstrap (T3_SharedContract §0.2) --------------------------------------
for _parent in Path(__file__).resolve().parents:
    if (_parent / "tools").is_dir() and (_parent / "plugin").is_dir():
        _TOOLS = _parent / "tools"
        break
else:  # pragma: no cover
    raise RuntimeError(f"obsidian-live-share repo root not found from {__file__}")
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, ports, provisioning, relay  # noqa: E402

OWNER_VAULTS = (
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga"),
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie"),
)


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


def make_vault(tmp_path: Path, name: str, data_json=None) -> Path:
    vault = assert_synthetic(tmp_path / name)
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    if data_json is not None:
        (vault / constants.PLUGIN_DATA_REL).write_bytes(data_json)
    return vault


def make_room() -> relay.RelayRoom:
    return relay.RelayRoom(
        id="0a0a0a0a-1b1b-2c2c-3d3d-4e4e5f5f6060",
        token="SENTINEL-BLIND1-TOKEN",
        name=f"{constants.RELAY_ROOM_NAME_PREFIX}20260804T151515Z-2-ccddee",
        base_url=constants.RELAY_BASE_URL,
    )


def marker_of(vault: Path) -> dict:
    return json.loads((vault / constants.PROVISION_MARKER_REL).read_bytes().decode("utf-8"))


def test_the_no_prior_file_branch_marks_had_original_false(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-absent")
    provisioning.provision_gate_settings(
        vault, constants.ROLE_A, room=make_room(), control_probe=silent_control_probe
    )
    marker = marker_of(vault)
    assert tuple(marker) == constants.PROVISION_MARKER_FIELDS
    assert marker["hadOriginal"] is False
    assert marker["originalSha256"] is None
    assert not (vault / constants.SETTINGS_BACKUP_REL).exists()


def test_the_no_prior_file_branch_restores_to_no_file(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-absent-restore")
    provisioning.provision_gate_settings(
        vault, constants.ROLE_B, room=make_room(), control_probe=silent_control_probe
    )
    assert (vault / constants.PLUGIN_DATA_REL).is_file()

    provisioning.restore_gate_settings(vault)
    assert not (vault / constants.PLUGIN_DATA_REL).exists()
    assert not (vault / constants.PROVISION_MARKER_REL).exists()
    assert sorted(p.name for p in (vault / constants.PLUGIN_DIR_REL).iterdir()) == []


def test_the_ten_member_marker_has_the_same_shape_as_the_one_member_marker(
    tmp_path: Path,
) -> None:
    original = b'{\n  "clientId": "fixture"\n}\n'
    ten = make_vault(tmp_path, "vault-ten", original)
    one = make_vault(tmp_path, "vault-one", original)

    provisioning.provision_gate_settings(
        ten, constants.ROLE_A, room=make_room(), control_probe=silent_control_probe
    )
    ports.provision_port(one, constants.ROLE_A)

    ten_marker, one_marker = marker_of(ten), marker_of(one)
    assert tuple(ten_marker) == tuple(one_marker) == constants.PROVISION_MARKER_FIELDS
    assert ten_marker["hadOriginal"] == one_marker["hadOriginal"]
    assert ten_marker["originalSha256"] == one_marker["originalSha256"]
    assert ten_marker["port"] == one_marker["port"] == constants.REAL_CONTROL_PORT_A


def test_restore_ignores_a_settings_file_replaced_mid_run(tmp_path: Path) -> None:
    original = b'{\n\t"clientId": "fixture-tabs"\n}'
    vault = make_vault(tmp_path, "vault-clobber", original)
    provisioning.provision_gate_settings(
        vault, constants.ROLE_A, room=make_room(), control_probe=silent_control_probe
    )
    # `canvas.setFlag` -> `saveSettings()` writes the live in-memory copy over the file.
    (vault / constants.PLUGIN_DATA_REL).write_bytes(b'{"rewrittenByThePlugin": true}')

    provisioning.restore_gate_settings(vault)
    assert (vault / constants.PLUGIN_DATA_REL).read_bytes() == original
