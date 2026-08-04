# WP70 / AC1 — blind counterpart 2 for "a borrow that cannot be established provisions
# nothing (vault byte-identical after the refusal)".
#
# Different angle: the borrow cannot be established because of the STATE around it rather
# than the file itself — contradictory leftovers, a marker that is a list, a marker whose
# sha256 is the wrong length, a plugin path that is a file rather than a directory. The
# oracle is a fingerprint of the whole vault, including files outside the plugin dir.
#
# DATA SAFETY: synthetic fixture vaults under tmp_path, guarded against both owner vaults.

from __future__ import annotations

import hashlib
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

from obsidian_e2e import constants, ports, provisioning, relay  # noqa: E402

OWNER_VAULTS = (
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga"),
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie"),
)

ORIGINAL = b'{\n  "clientId": "fixture-state"\n}\n'
OWNER_NOTE = b"# an owner note that must never change\n"


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
    (vault / "Notiz.md").write_bytes(OWNER_NOTE)
    return vault


def make_room() -> relay.RelayRoom:
    return relay.RelayRoom(
        id="3c3c3c3c-4d4d-5e5e-6f6f-707080809090",
        token="SENTINEL-BLIND2-TOKEN",
        name=f"{constants.RELAY_ROOM_NAME_PREFIX}20260804T202021Z-12-556677",
        base_url=constants.RELAY_BASE_URL,
    )


def fingerprint(vault: Path) -> dict:
    return {
        p.relative_to(vault).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(vault.rglob("*"))
        if p.is_file()
    }


def refuse(vault: Path) -> ports.ProvisionError:
    before = fingerprint(vault)
    with pytest.raises(ports.ProvisionError) as excinfo:
        provisioning.provision_gate_settings(
            vault, constants.ROLE_A, room=make_room(), control_probe=silent_control_probe
        )
    assert fingerprint(vault) == before, "the refusal changed the vault"
    assert (vault / "Notiz.md").read_bytes() == OWNER_NOTE
    return excinfo.value


def test_a_marker_that_is_a_list_is_refused(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-list-marker")
    (vault / constants.PROVISION_MARKER_REL).write_bytes(b'["not", "an", "object"]')
    assert refuse(vault).reason == constants.PROVISION_CONFLICT


def test_a_marker_whose_sha_is_the_wrong_length_is_refused(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-short-sha")
    marker = {
        "runId": "run-x",
        "role": constants.ROLE_A,
        "port": constants.REAL_CONTROL_PORT_A,
        "hadOriginal": True,
        "originalSha256": "abc123",
        "pid": 1,
        "createdAt": "2026-08-04T00:00:00+00:00",
    }
    (vault / constants.PROVISION_MARKER_REL).write_bytes(json.dumps(marker).encode("utf-8"))
    (vault / constants.SETTINGS_BACKUP_REL).write_bytes(ORIGINAL)
    assert refuse(vault).reason == constants.PROVISION_CONFLICT


def test_a_marker_claiming_no_original_beside_a_backup_is_refused(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-contradiction")
    marker = {
        "runId": "run-y",
        "role": constants.ROLE_B,
        "port": constants.REAL_CONTROL_PORT_B,
        "hadOriginal": False,
        "originalSha256": None,
        "pid": 2,
        "createdAt": "2026-08-04T00:00:00+00:00",
    }
    (vault / constants.PROVISION_MARKER_REL).write_bytes(json.dumps(marker).encode("utf-8"))
    (vault / constants.SETTINGS_BACKUP_REL).write_bytes(ORIGINAL)
    assert refuse(vault).reason == constants.PROVISION_CONFLICT


def test_a_vault_with_no_plugin_directory_is_refused_without_creating_one(
    tmp_path: Path,
) -> None:
    vault = assert_synthetic(tmp_path / "vault-bare")
    vault.mkdir(parents=True, exist_ok=True)
    (vault / "Notiz.md").write_bytes(OWNER_NOTE)

    error = refuse(vault)
    assert error.reason == constants.PLUGIN_MISSING
    assert not (vault / ".obsidian").exists(), "the rig created a plugin directory"
