# WP44 / AC2 — restore returns the settings file to the IDENTICAL bytes.
#
# "Byte-exact" is the whole point: the file being borrowed is the owner's live
# plugin configuration. The oracle is sha256 of the bytes plus the exact length —
# never the content itself (T3_SharedContract S4).
#
#   ├── T1 provision then restore reproduces the original bytes exactly.
#   ├── T2 the file really was modified in between (a no-op implementation must
#   │      not be able to pass T1).
#   ├── T3 restore leaves no rig artefact behind: no backup, no marker.
#   └── T4 the RestoreResult describes what happened.
#
# Data safety: fixture vault under tmp_path; obviously-fake credential values.

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

# T3_SharedContract import rule: `import tools.…` resolves to the WORKSPACE `tools`
# package (a regular package always beats a namespace portion), never to this repo's.
# Put <repo>/tools on sys.path and import by the globally unique package name.
_TOOLS = Path(__file__).resolve().parents[5] / "tools"
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, ports  # noqa: E402

FAKE_SETTINGS = {
    "serverUrl": "wss://example.invalid/ws-mux/",
    "serverPassword": "FAKE-PASSWORD-NOT-REAL-0000",
    "token": "FAKE-TOKEN-0000",
    "roomId": "fixture-room",
    "clientId": "fixture-client",
    "role": "guest",
}
ORIGINAL_BYTES = json.dumps(FAKE_SETTINGS, indent=2).encode("utf-8") + b"\n"


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def make_vault(tmp_path: Path, original: bytes) -> Path:
    vault = tmp_path / "vault-a"
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(original)
    return vault


def test_restore_reproduces_the_original_bytes(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, ORIGINAL_BYTES)
    settings_path = vault / constants.PLUGIN_DATA_REL
    original_digest = sha256_bytes(ORIGINAL_BYTES)

    ports.provision_port(vault, constants.ROLE_A)
    result = ports.restore_port(vault)

    restored = settings_path.read_bytes()
    assert sha256_bytes(restored) == original_digest
    assert len(restored) == len(ORIGINAL_BYTES)
    assert restored == ORIGINAL_BYTES

    assert result.restored is True
    assert result.had_original is True
    assert result.settings_file_present is True
    assert result.reason is None


def test_the_file_was_genuinely_modified_in_between(tmp_path: Path) -> None:
    # Guards T1 against passing for the wrong reason: if provisioning never wrote
    # anything, "restore" would be trivially byte-exact and the rig useless.
    vault = make_vault(tmp_path, ORIGINAL_BYTES)
    settings_path = vault / constants.PLUGIN_DATA_REL

    record = ports.provision_port(vault, constants.ROLE_A)

    provisioned = settings_path.read_bytes()
    assert sha256_bytes(provisioned) != sha256_bytes(ORIGINAL_BYTES)
    parsed = json.loads(provisioned.decode("utf-8"))
    assert int(parsed[constants.SETTINGS_PORT_KEY]) == record.port

    ports.restore_port(vault)
    assert settings_path.read_bytes() == ORIGINAL_BYTES


def test_restore_leaves_no_rig_artefact_behind(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, ORIGINAL_BYTES)
    plugin_dir = vault / constants.PLUGIN_DIR_REL
    names_before = sorted(p.name for p in plugin_dir.iterdir())

    ports.provision_port(vault, constants.ROLE_A)
    assert (vault / constants.SETTINGS_BACKUP_REL).is_file()
    assert (vault / constants.PROVISION_MARKER_REL).is_file()

    ports.restore_port(vault)

    assert not (vault / constants.SETTINGS_BACKUP_REL).exists()
    assert not (vault / constants.PROVISION_MARKER_REL).exists()
    assert sorted(p.name for p in plugin_dir.iterdir()) == names_before


def test_the_backup_holds_the_original_bytes_verbatim(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, ORIGINAL_BYTES)

    record = ports.provision_port(vault, constants.ROLE_A)

    backup = (vault / constants.SETTINGS_BACKUP_REL).read_bytes()
    assert backup == ORIGINAL_BYTES
    assert record.original_sha256 == sha256_bytes(ORIGINAL_BYTES)
    assert record.had_original is True
