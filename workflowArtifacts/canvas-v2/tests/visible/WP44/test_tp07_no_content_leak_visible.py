# WP44 / AC2 (S4) — the capture record is a fingerprint, never a copy.
#
# data.json holds a live production secret. The rig is allowed to keep the
# original bytes in exactly one place: the backup file, beside the original,
# inside the vault. The marker file, the returned record, and every log or error
# string must carry hashes and structure only.
#
#   ├── T1 the marker has exactly the pinned key set and the pinned types.
#   ├── T2 originalSha256 is the sha256 of the original bytes — the hash, not a
#   │      truncation, not a copy.
#   ├── T3 no secret-shaped value appears in the marker, the record's repr, or
#   │      any file in the vault other than data.json and its backup.
#   └── T4 after teardown not even the backup remains.
#
# Data safety: fixture vault under tmp_path; the "secrets" are obvious fakes.

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

FAKE_SECRETS = {
    "serverPassword": "FAKE-PASSWORD-NOT-REAL-aaaaaaaaaaaaaaaa",
    "token": "FAKE-TOKEN-NOT-REAL-bbbbbbbbbbbbbbbb",
    "jwt": "FAKE-JWT-NOT-REAL-cccccccccccccccc",
}
ORIGINAL_BYTES = json.dumps(
    {"serverUrl": "wss://example.invalid/ws-mux/", **FAKE_SECRETS, "roomId": "fixture-room"},
    indent=2,
).encode("utf-8")

MARKER_KEYS = {
    "runId",
    "role",
    "port",
    "hadOriginal",
    "originalSha256",
    "pid",
    "createdAt",
}


def make_vault(tmp_path: Path) -> Path:
    vault = tmp_path / "vault-secretish"
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(ORIGINAL_BYTES)
    return vault


def test_marker_shape_is_exactly_the_pinned_schema(tmp_path: Path) -> None:
    vault = make_vault(tmp_path)

    record = ports.provision_port(vault, constants.ROLE_B)

    marker = json.loads((vault / constants.PROVISION_MARKER_REL).read_bytes().decode("utf-8"))
    assert set(marker) == MARKER_KEYS

    assert isinstance(marker["runId"], str) and marker["runId"]
    assert marker["role"] == constants.ROLE_B
    assert isinstance(marker["port"], int) and marker["port"] == record.port
    assert marker["hadOriginal"] is True
    assert isinstance(marker["originalSha256"], str)
    assert isinstance(marker["pid"], int)
    assert isinstance(marker["createdAt"], str) and marker["createdAt"]


def test_original_sha256_is_the_hash_of_the_original_bytes(tmp_path: Path) -> None:
    vault = make_vault(tmp_path)

    ports.provision_port(vault, constants.ROLE_A)

    marker = json.loads((vault / constants.PROVISION_MARKER_REL).read_bytes().decode("utf-8"))
    expected = hashlib.sha256(ORIGINAL_BYTES).hexdigest()
    assert marker["originalSha256"] == expected
    assert len(marker["originalSha256"]) == 64


def test_no_settings_value_escapes_data_json_or_its_backup(tmp_path: Path) -> None:
    vault = make_vault(tmp_path)

    record = ports.provision_port(vault, constants.ROLE_A)

    allowed = {
        (vault / constants.PLUGIN_DATA_REL).resolve(),
        (vault / constants.SETTINGS_BACKUP_REL).resolve(),
    }
    for path in vault.rglob("*"):
        if not path.is_file() or path.resolve() in allowed:
            continue
        blob = path.read_bytes()
        for secret in FAKE_SECRETS.values():
            assert secret.encode("utf-8") not in blob, (
                f"a settings value leaked into {path.name}"
            )

    rendered = f"{record!r} {record}"
    for secret in FAKE_SECRETS.values():
        assert secret not in rendered, "the provision record must carry no settings content"


def test_teardown_removes_the_backup_too(tmp_path: Path) -> None:
    vault = make_vault(tmp_path)

    ports.provision_port(vault, constants.ROLE_A)
    ports.restore_port(vault)

    assert not (vault / constants.SETTINGS_BACKUP_REL).exists(), (
        "a copy of the owner's secret must not outlive the run"
    )
    assert (vault / constants.PLUGIN_DATA_REL).read_bytes() == ORIGINAL_BYTES
