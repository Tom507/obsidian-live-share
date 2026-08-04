# WP70 / obsidian-git precondition — blind counterpart 2 for "capture -> modify ->
# restore -> independently verified restore of `community-plugins.json`".
#
# Different angle: the borrow must be SEPARATE from WP44's `data.json` borrow. Both are
# exercised over one vault at the same time, and each must be restorable on its own, in
# either order, without either one's marker or backup being mistaken for the other's.
# "Two restore paths over one file is the failure this charter is written to avoid" —
# these are two files, and that is exactly why they get two namespaces.
#
# DATA SAFETY: synthetic fixture vaults under tmp_path, guarded against both owner vaults.

from __future__ import annotations

import hashlib
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

RUN_ID = "20260803T065959Z-40-445566"
DATA_JSON = b'{\r\n\t"clientId": "fixture-both"\r\n}'
COMMUNITY = b'[\r\n\t"obsidian-git",\r\n\t"dataview",\r\n\t"live-share"\r\n]'


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
    (vault / constants.PLUGIN_DATA_REL).write_bytes(DATA_JSON)
    (vault / constants.COMMUNITY_PLUGINS_REL).write_bytes(COMMUNITY)
    return vault


def make_room() -> relay.RelayRoom:
    return relay.RelayRoom(
        id="22223333-4444-5555-6666-777788889999",
        token="SENTINEL-BLIND2-TOKEN",
        name=f"{constants.RELAY_ROOM_NAME_PREFIX}{RUN_ID}",
        base_url=constants.RELAY_BASE_URL,
    )


def borrow_both(vault: Path) -> None:
    provisioning.disable_community_plugins(vault, constants.ROLE_A, run_id=RUN_ID)
    provisioning.provision_gate_settings(
        vault, constants.ROLE_A, room=make_room(), run_id=RUN_ID,
        control_probe=silent_control_probe,
    )


@pytest.mark.parametrize("order", ["settings_first", "plugins_first"])
def test_both_borrows_restore_in_either_order(tmp_path: Path, order: str) -> None:
    vault = make_vault(tmp_path, f"both-{order}")
    borrow_both(vault)

    if order == "settings_first":
        provisioning.restore_gate_settings(vault)
        provisioning.restore_community_plugins(vault)
    else:
        provisioning.restore_community_plugins(vault)
        provisioning.restore_gate_settings(vault)

    assert (vault / constants.PLUGIN_DATA_REL).read_bytes() == DATA_JSON
    assert (vault / constants.COMMUNITY_PLUGINS_REL).read_bytes() == COMMUNITY


def test_each_borrow_writes_into_its_own_namespace(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "namespaces")
    borrow_both(vault)

    assert (vault / constants.SETTINGS_BACKUP_REL).read_bytes() == DATA_JSON
    assert (vault / constants.COMMUNITY_PLUGINS_BACKUP_REL).read_bytes() == COMMUNITY
    assert (vault / constants.PROVISION_MARKER_REL).is_file()
    assert (vault / constants.COMMUNITY_PLUGINS_MARKER_REL).is_file()
    assert Path(constants.SETTINGS_BACKUP_REL).name != Path(constants.COMMUNITY_PLUGINS_BACKUP_REL).name


def test_restoring_one_borrow_does_not_disturb_the_other(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "isolated")
    borrow_both(vault)
    during_settings = (vault / constants.PLUGIN_DATA_REL).read_bytes()

    provisioning.restore_community_plugins(vault)
    assert (vault / constants.COMMUNITY_PLUGINS_REL).read_bytes() == COMMUNITY
    assert (vault / constants.PLUGIN_DATA_REL).read_bytes() == during_settings
    assert (vault / constants.PROVISION_MARKER_REL).is_file()

    provisioning.restore_gate_settings(vault)
    assert (vault / constants.PLUGIN_DATA_REL).read_bytes() == DATA_JSON


def test_the_independent_verification_uses_hashes_of_bytes_only(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "hashes")
    community_sha = hashlib.sha256(COMMUNITY).hexdigest()
    data_sha = hashlib.sha256(DATA_JSON).hexdigest()

    borrow_both(vault)
    community_result = provisioning.restore_community_plugins(vault)
    settings_result = provisioning.restore_gate_settings(vault)

    assert community_result.restored_sha256 == community_sha
    assert community_result.restored_size == len(COMMUNITY)
    assert settings_result.restored_sha256 == data_sha
    assert settings_result.restored_size == len(DATA_JSON)


def test_both_files_really_changed_in_between(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "genuine")
    borrow_both(vault)
    assert (vault / constants.PLUGIN_DATA_REL).read_bytes() != DATA_JSON
    assert (vault / constants.COMMUNITY_PLUGINS_REL).read_bytes() != COMMUNITY
