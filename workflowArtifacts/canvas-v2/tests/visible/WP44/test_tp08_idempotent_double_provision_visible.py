# WP44 / AC3 — provisioning twice yields the same state and exactly ONE saved
# original, and that original is the pre-first-provision content.
#
# The defect this exists to catch is the obvious one: a second `provision_port`
# that captures the CURRENT file — which by then already contains the rig's own
# port — and overwrites the real original with it. The run then restores the
# owner's vault to a state the owner never had.
#
#   ├── T1 two provisions leave identical settings bytes.
#   ├── T2 exactly one backup and one marker exist, and the plugin directory holds
#   │      nothing else the rig created.
#   ├── T3 the backup is the PRE-first-provision content, not the provisioned one.
#   └── T4 one restore is enough; a second restore is a safe no-op.
#
# Data safety: fixture vault under tmp_path only.

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from obsidian_e2e import constants, ports

ORIGINAL_BYTES = (
    '{\n'
    '\t"serverUrl": "wss://example.invalid/ws-mux/",\n'
    '\t"serverPassword": "FAKE-PASSWORD-NOT-REAL-0000",\n'
    '\t"roomId": "fixture-room"\n'
    '}\n'
).encode("utf-8")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def make_vault(tmp_path: Path, name: str = "vault-a") -> Path:
    vault = tmp_path / name
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(ORIGINAL_BYTES)
    return vault


def read_marker(vault: Path) -> dict:
    return json.loads((vault / constants.PROVISION_MARKER_REL).read_bytes().decode("utf-8"))


def test_two_provisions_leave_the_same_settings_state(tmp_path: Path) -> None:
    vault = make_vault(tmp_path)
    settings_path = vault / constants.PLUGIN_DATA_REL

    ports.provision_port(vault, constants.ROLE_A)
    after_first = settings_path.read_bytes()

    ports.provision_port(vault, constants.ROLE_A)
    after_second = settings_path.read_bytes()

    assert after_second == after_first
    parsed = json.loads(after_second.decode("utf-8"))
    assert int(parsed[constants.SETTINGS_PORT_KEY]) == constants.REAL_CONTROL_PORT_A


def test_exactly_one_saved_original_and_one_marker(tmp_path: Path) -> None:
    vault = make_vault(tmp_path)
    plugin_dir = vault / constants.PLUGIN_DIR_REL

    ports.provision_port(vault, constants.ROLE_A)
    ports.provision_port(vault, constants.ROLE_A)

    names = sorted(p.name for p in plugin_dir.iterdir())
    expected = sorted(
        Path(rel).name
        for rel in (
            constants.PLUGIN_DATA_REL,
            constants.SETTINGS_BACKUP_REL,
            constants.PROVISION_MARKER_REL,
        )
    )
    assert names == expected, (
        "a second provisioning must not create a second backup under any name"
    )


def test_the_saved_original_is_the_pre_first_provision_content(tmp_path: Path) -> None:
    vault = make_vault(tmp_path)
    original_digest = sha256_bytes(ORIGINAL_BYTES)

    ports.provision_port(vault, constants.ROLE_A)
    provisioned = (vault / constants.PLUGIN_DATA_REL).read_bytes()
    assert sha256_bytes(provisioned) != original_digest  # sanity: state did change

    ports.provision_port(vault, constants.ROLE_A)

    backup = (vault / constants.SETTINGS_BACKUP_REL).read_bytes()
    assert backup == ORIGINAL_BYTES, "the second capture overwrote the real original"
    assert sha256_bytes(backup) != sha256_bytes(provisioned)

    marker = read_marker(vault)
    assert marker["hadOriginal"] is True
    assert marker["originalSha256"] == original_digest


def test_one_restore_is_enough_and_a_second_is_a_safe_no_op(tmp_path: Path) -> None:
    vault = make_vault(tmp_path)
    settings_path = vault / constants.PLUGIN_DATA_REL

    ports.provision_port(vault, constants.ROLE_A)
    ports.provision_port(vault, constants.ROLE_A)

    first = ports.restore_port(vault)
    assert first.restored is True
    assert settings_path.read_bytes() == ORIGINAL_BYTES

    second = ports.restore_port(vault)
    assert second.restored is False, "there is nothing left to restore"
    assert second.reason is None
    assert settings_path.read_bytes() == ORIGINAL_BYTES
    assert not (vault / constants.SETTINGS_BACKUP_REL).exists()
    assert not (vault / constants.PROVISION_MARKER_REL).exists()
