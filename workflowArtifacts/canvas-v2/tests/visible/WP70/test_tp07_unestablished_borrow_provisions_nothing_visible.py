# WP70 / AC1 — "A run that cannot establish its borrow provisions nothing."
#
# The oracle is the whole vault, not the settings file: a refusal that leaves a marker,
# a backup, a temporary file or a mutated `data.json` behind has already provisioned
# something. Every case below fingerprints the entire vault tree before the attempt and
# asserts it is unchanged afterwards.
#
#   ├── T1 a missing plugin directory refuses under PLUGIN_MISSING, vault unchanged
#   ├── T2 a backup with no marker refuses under PROVISION_CONFLICT, vault unchanged
#   ├── T3 a marker whose backup is gone refuses, vault unchanged
#   ├── T4 a marker with the wrong field set refuses, vault unchanged
#   ├── T5 settings that are not a JSON object refuse, vault unchanged
#   └── T6 the refusal names a sanctioned reason from constants.FAILURE_REASONS
#
# DATA SAFETY: synthetic fixture vaults under tmp_path, guarded against both owner
# vaults. Sentinel credential values only.

from __future__ import annotations

import hashlib
import json
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

from obsidian_e2e import constants, ports, provisioning, relay  # noqa: E402


def silent_control_probe(port: int) -> bool:
    """No Obsidian instance is running in a unit test — and none may be started."""
    return False

OWNER_VAULTS = (
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga"),
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie"),
)

SENTINEL_ROOM_TOKEN = "SENTINEL-ROOM-TOKEN-c0ffee-DO-NOT-LEAK"
ORIGINAL = b'{\n  "clientId": "fixture-client"\n}\n'


def assert_synthetic(path: Path) -> Path:
    resolved = Path(path).resolve()
    for owner in OWNER_VAULTS:
        owner_resolved = Path(owner).resolve()
        assert resolved != owner_resolved, f"ABORT: {resolved} is an owner vault"
        assert owner_resolved not in resolved.parents, f"ABORT: {resolved} is inside an owner vault"
        assert resolved not in owner_resolved.parents, f"ABORT: {resolved} contains an owner vault"
    return resolved


def make_vault(tmp_path: Path, name: str, data_json=None, *, plugin_dir: bool = True) -> Path:
    vault = assert_synthetic(tmp_path / name)
    if plugin_dir:
        (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    else:
        vault.mkdir(parents=True, exist_ok=True)
    if data_json is not None:
        (vault / constants.PLUGIN_DATA_REL).write_bytes(data_json)
    return vault


def make_room() -> relay.RelayRoom:
    return relay.RelayRoom(
        id="11111111-2222-3333-4444-555555555555",
        token=SENTINEL_ROOM_TOKEN,
        name=f"{constants.RELAY_ROOM_NAME_PREFIX}20260804T000000Z-1-a1b2c3",
        base_url=constants.RELAY_BASE_URL,
    )


def fingerprint(vault: Path) -> dict:
    """(relative posix path -> sha256 of bytes) for every file in the vault."""
    out = {}
    for path in sorted(vault.rglob("*")):
        if path.is_file():
            out[path.relative_to(vault).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    return out


def refuse(vault: Path) -> ports.ProvisionError:
    before = fingerprint(vault)
    with pytest.raises(ports.ProvisionError) as excinfo:
        provisioning.provision_gate_settings(vault, constants.ROLE_A, room=make_room(), control_probe=silent_control_probe)
    assert fingerprint(vault) == before, "the refusal provisioned something"
    assert excinfo.value.reason in constants.FAILURE_REASONS
    return excinfo.value

def test_a_missing_plugin_directory_refuses_and_provisions_nothing(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-no-plugin", plugin_dir=False)
    error = refuse(vault)
    assert error.reason == constants.PLUGIN_MISSING
    assert not (vault / constants.PLUGIN_DIR_REL).exists(), "the rig created a plugin directory"


def test_a_backup_with_no_marker_refuses_and_provisions_nothing(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-orphan-backup", ORIGINAL)
    (vault / constants.SETTINGS_BACKUP_REL).write_bytes(b'{"stale": true}\n')
    error = refuse(vault)
    assert error.reason == constants.PROVISION_CONFLICT


def test_a_marker_whose_backup_is_gone_refuses_and_provisions_nothing(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-lost-backup", ORIGINAL)
    marker = {
        "runId": "20260804T000000Z-1-000001",
        "role": constants.ROLE_A,
        "port": constants.REAL_CONTROL_PORT_A,
        "hadOriginal": True,
        "originalSha256": "0" * 64,
        "pid": 4242,
        "createdAt": "2026-08-04T00:00:00+00:00",
    }
    (vault / constants.PROVISION_MARKER_REL).write_bytes(
        json.dumps(marker, indent=2).encode("utf-8") + b"\n"
    )
    error = refuse(vault)
    assert error.reason == constants.PROVISION_CONFLICT


def test_a_marker_with_the_wrong_field_set_refuses_and_provisions_nothing(
    tmp_path: Path,
) -> None:
    vault = make_vault(tmp_path, "vault-bad-marker", ORIGINAL)
    (vault / constants.PROVISION_MARKER_REL).write_bytes(
        json.dumps({"runId": "x", "role": constants.ROLE_A}).encode("utf-8")
    )
    error = refuse(vault)
    assert error.reason == constants.PROVISION_CONFLICT


def test_settings_that_are_not_a_json_object_refuse_and_provision_nothing(
    tmp_path: Path,
) -> None:
    vault = make_vault(tmp_path, "vault-not-json", b"[1, 2, 3]\n")
    error = refuse(vault)
    assert error.reason == constants.PROVISION_CONFLICT
    assert (vault / constants.PLUGIN_DATA_REL).read_bytes() == b"[1, 2, 3]\n"


def test_a_refusal_leaves_no_temporary_file_behind(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-no-temp", b"{ this is not json ")
    refuse(vault)
    leftovers = [p.name for p in (vault / constants.PLUGIN_DIR_REL).iterdir()]
    assert leftovers == ["data.json"], f"a refusal left artefacts behind: {leftovers}"
