# WP44 / AC2 — a restore that is not byte-exact is reported as
# SETTINGS_RESTORE_MISMATCH, and it never half-writes the owner's file.
#
# The rig verifies its own restore. If the bytes it is about to write, or the
# bytes on disk afterwards, do not hash to the captured original, the honest
# outcome is a named refusal that leaves the backup in place for a human — not a
# silent "restored: true" over a file nobody can reconstruct any more.
#
#   ├── T1 a backup whose bytes no longer match the captured hash → refusal.
#   ├── T2 a truncated / emptied backup → refusal.
#   ├── T3 the refusal never overwrites the settings file, and never deletes the
#   │      backup or the marker.
#   └── T4 the refusal names constants.SETTINGS_RESTORE_MISMATCH and leaks no
#          settings content into its message (S4).
#
# Data safety: fixture vault under tmp_path; fake credential values only.

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import pytest

# T3_SharedContract import rule: `import tools.…` resolves to the WORKSPACE `tools`
# package (a regular package always beats a namespace portion), never to this repo's.
# Put <repo>/tools on sys.path and import by the globally unique package name.
_TOOLS = Path(__file__).resolve().parents[5] / "tools"
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, ports  # noqa: E402

SECRET_LOOKING_VALUE = "FAKE-PASSWORD-NOT-REAL-0000"
ORIGINAL_BYTES = (
    '{\n'
    '  "serverUrl": "wss://example.invalid/ws-mux/",\n'
    f'  "serverPassword": "{SECRET_LOOKING_VALUE}",\n'
    '  "roomId": "fixture-room"\n'
    '}\n'
).encode("utf-8")


def make_vault(tmp_path: Path, name: str = "vault-a") -> Path:
    vault = tmp_path / name
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(ORIGINAL_BYTES)
    return vault


def provision_then_damage_backup(tmp_path: Path, damaged: bytes, name: str) -> Path:
    vault = make_vault(tmp_path, name)
    ports.provision_port(vault, constants.ROLE_A)
    (vault / constants.SETTINGS_BACKUP_REL).write_bytes(damaged)
    return vault


@pytest.mark.parametrize(
    ("label", "damaged"),
    [
        ("mutated", ORIGINAL_BYTES.replace(b"fixture-room", b"other-room!!")),
        ("truncated", ORIGINAL_BYTES[: len(ORIGINAL_BYTES) // 2]),
        ("emptied", b""),
        ("reformatted", json.dumps(json.loads(ORIGINAL_BYTES.decode())).encode("utf-8")),
    ],
)
def test_a_backup_that_no_longer_matches_the_captured_hash_is_refused(
    tmp_path: Path, label: str, damaged: bytes
) -> None:
    vault = provision_then_damage_backup(tmp_path, damaged, f"vault-{label}")
    settings_path = vault / constants.PLUGIN_DATA_REL
    provisioned_bytes = settings_path.read_bytes()

    with pytest.raises(Exception) as excinfo:
        ports.restore_port(vault)

    reason = getattr(excinfo.value, "reason", None)
    assert reason == constants.SETTINGS_RESTORE_MISMATCH, (
        f"{label}: every abort names exactly one failure reason from constants.py "
        f"(got {reason!r})"
    )

    # Nothing was written over the settings file, and the evidence is still there.
    assert settings_path.read_bytes() == provisioned_bytes
    assert (vault / constants.SETTINGS_BACKUP_REL).read_bytes() == damaged
    assert (vault / constants.PROVISION_MARKER_REL).is_file()


def test_the_refusal_message_leaks_no_settings_content(tmp_path: Path) -> None:
    vault = provision_then_damage_backup(tmp_path, b"{}", "vault-leak")

    with pytest.raises(Exception) as excinfo:
        ports.restore_port(vault)

    rendered = f"{excinfo.value!r} {excinfo.value}"
    assert SECRET_LOOKING_VALUE not in rendered, (
        "S4: a settings value must never appear in an error message"
    )
    assert constants.SETTINGS_RESTORE_MISMATCH in rendered or (
        getattr(excinfo.value, "reason", None) == constants.SETTINGS_RESTORE_MISMATCH
    )


def test_a_healthy_restore_is_not_affected_by_the_verification(tmp_path: Path) -> None:
    # The verification must not be so strict that the normal path fails.
    vault = make_vault(tmp_path, "vault-ok")
    ports.provision_port(vault, constants.ROLE_A)

    result = ports.restore_port(vault)

    assert result.restored is True
    assert result.reason is None
    restored = (vault / constants.PLUGIN_DATA_REL).read_bytes()
    assert hashlib.sha256(restored).hexdigest() == hashlib.sha256(ORIGINAL_BYTES).hexdigest()
