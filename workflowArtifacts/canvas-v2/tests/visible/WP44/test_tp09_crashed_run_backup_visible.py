# WP44 / AC3 — an original saved by an earlier CRASHED run is still restorable on
# the next run, and is never overwritten by the current (already-provisioned) state.
#
# A crashed run leaves the vault mid-borrow: data.json carries the rig's port, the
# backup and the marker are still there, and no restore ever ran. The next run must
# treat that backup as the truth about the owner's file, not the file on disk.
#
#   ├── T1 a second run over a crashed state does not touch the backup.
#   ├── T2 restoring after the second run yields the ORIGINAL bytes, not the
#   │      bytes the crashed run left behind.
#   ├── T3 a different port on the second run changes only the live setting.
#   └── T4 the crashed "there was no file" case recovers too: teardown removes the
#          file rather than restoring a fabricated one.
#
# Data safety: fixture vault under tmp_path only.

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

ORIGINAL_BYTES = (
    '{\r\n'
    '  "serverUrl": "wss://example.invalid/ws-mux/",\r\n'
    '  "serverPassword": "FAKE-PASSWORD-NOT-REAL-0000",\r\n'
    '  "roomId": "fixture-room"\r\n'
    '}'
).encode("utf-8")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def make_vault(tmp_path: Path, name: str, original: bytes | None) -> Path:
    vault = tmp_path / name
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    if original is not None:
        (vault / constants.PLUGIN_DATA_REL).write_bytes(original)
    return vault


def crashed_run(tmp_path: Path, name: str, original: bytes | None) -> Path:
    """A vault left exactly as a run that died before teardown would leave it."""
    vault = make_vault(tmp_path, name, original)
    ports.provision_port(vault, constants.ROLE_A)
    # ... and then the process died. No restore_port call.
    return vault


def test_a_second_run_does_not_overwrite_the_crashed_runs_backup(tmp_path: Path) -> None:
    vault = crashed_run(tmp_path, "vault-crashed", ORIGINAL_BYTES)
    backup_path = vault / constants.SETTINGS_BACKUP_REL
    backup_before = backup_path.read_bytes()
    assert backup_before == ORIGINAL_BYTES

    ports.provision_port(vault, constants.ROLE_A)

    assert backup_path.read_bytes() == ORIGINAL_BYTES
    assert backup_path.read_bytes() == backup_before
    marker = json.loads((vault / constants.PROVISION_MARKER_REL).read_bytes().decode("utf-8"))
    assert marker["originalSha256"] == sha256_bytes(ORIGINAL_BYTES)
    assert marker["hadOriginal"] is True


def test_restore_after_the_recovery_run_yields_the_true_original(tmp_path: Path) -> None:
    vault = crashed_run(tmp_path, "vault-crashed", ORIGINAL_BYTES)
    settings_path = vault / constants.PLUGIN_DATA_REL
    left_by_crash = settings_path.read_bytes()
    assert left_by_crash != ORIGINAL_BYTES  # sanity: the crash really left the port in

    ports.provision_port(vault, constants.ROLE_A)
    result = ports.restore_port(vault)

    assert result.restored is True
    assert settings_path.read_bytes() == ORIGINAL_BYTES
    assert not (vault / constants.SETTINGS_BACKUP_REL).exists()
    assert not (vault / constants.PROVISION_MARKER_REL).exists()


def test_the_recovery_run_may_provision_a_different_port(tmp_path: Path) -> None:
    vault = crashed_run(tmp_path, "vault-crashed", ORIGINAL_BYTES)

    record = ports.provision_port(vault, constants.ROLE_B, port=constants.REAL_CONTROL_PORT_B)

    live = json.loads((vault / constants.PLUGIN_DATA_REL).read_bytes().decode("utf-8"))
    assert int(live[constants.SETTINGS_PORT_KEY]) == constants.REAL_CONTROL_PORT_B
    assert record.port == constants.REAL_CONTROL_PORT_B
    # The captured original is a property of the vault, not of the current run.
    assert (vault / constants.SETTINGS_BACKUP_REL).read_bytes() == ORIGINAL_BYTES

    ports.restore_port(vault)
    assert (vault / constants.PLUGIN_DATA_REL).read_bytes() == ORIGINAL_BYTES


def test_the_crashed_no_original_case_recovers_to_no_file(tmp_path: Path) -> None:
    vault = crashed_run(tmp_path, "vault-crashed-fresh", None)
    settings_path = vault / constants.PLUGIN_DATA_REL
    assert settings_path.is_file()  # the crashed run created it

    ports.provision_port(vault, constants.ROLE_A)

    marker = json.loads((vault / constants.PROVISION_MARKER_REL).read_bytes().decode("utf-8"))
    assert marker["hadOriginal"] is False, (
        "the second run must not conclude from the file it wrote itself that the "
        "owner had one"
    )
    assert not (vault / constants.SETTINGS_BACKUP_REL).exists()

    result = ports.restore_port(vault)
    assert result.restored is True
    assert result.had_original is False
    assert not settings_path.exists()
