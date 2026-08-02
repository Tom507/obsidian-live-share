# WP44 / AC3 (blind 1) — crash recovery when the crashed run belonged to someone
# else.
#
# Angle: the visible set crashes and recovers within one process. Here the
# leftover state is synthesised as a FOREIGN run would have left it — another
# runId, another pid, another role, an older timestamp — because that is what the
# next run actually finds on disk. None of that may tempt the rig into treating
# the current file as the original.

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

ORIGINAL = (
    '{\n\t"serverUrl": "wss://example.invalid/ws-mux/",\n'
    '\t"serverPassword": "FAKE-PW-BLIND1-9999",\n'
    '\t"roomId": "blind-room"\n}\n'
).encode("utf-8")
ORIGINAL_SHA = hashlib.sha256(ORIGINAL).hexdigest()
FOREIGN_RUN_ID = "20260101T010203Z-4242-beefed"


def foreign_crashed_vault(tmp_path: Path, name: str) -> Path:
    """Exactly what a run from another process, killed before teardown, leaves."""
    vault = tmp_path / name
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    # the live file already carries the foreign run's port
    (vault / constants.PLUGIN_DATA_REL).write_bytes(
        json.dumps(
            {
                "serverUrl": "wss://example.invalid/ws-mux/",
                "serverPassword": "FAKE-PW-BLIND1-9999",
                "roomId": "blind-room",
                constants.SETTINGS_PORT_KEY: constants.REAL_CONTROL_PORT_B,
            },
            indent=2,
        ).encode("utf-8")
    )
    (vault / constants.SETTINGS_BACKUP_REL).write_bytes(ORIGINAL)
    (vault / constants.PROVISION_MARKER_REL).write_bytes(
        json.dumps(
            {
                "runId": FOREIGN_RUN_ID,
                "role": constants.ROLE_B,
                "port": constants.REAL_CONTROL_PORT_B,
                "hadOriginal": True,
                "originalSha256": ORIGINAL_SHA,
                "pid": 4242,
                "createdAt": "2026-01-01T01:02:03+00:00",
            },
            indent=2,
        ).encode("utf-8")
    )
    return vault


def test_a_foreign_crashed_backup_is_adopted_not_replaced(tmp_path: Path) -> None:
    vault = foreign_crashed_vault(tmp_path, "v-foreign")

    record = ports.provision_port(vault, constants.ROLE_A)

    assert record.had_original is True
    assert record.original_sha256 == ORIGINAL_SHA
    assert (vault / constants.SETTINGS_BACKUP_REL).read_bytes() == ORIGINAL
    marker = json.loads((vault / constants.PROVISION_MARKER_REL).read_bytes().decode("utf-8"))
    assert marker["originalSha256"] == ORIGINAL_SHA
    assert marker["hadOriginal"] is True


def test_the_recovery_teardown_restores_the_true_original(tmp_path: Path) -> None:
    vault = foreign_crashed_vault(tmp_path, "v-foreign")
    left_by_the_crash = (vault / constants.PLUGIN_DATA_REL).read_bytes()

    ports.provision_port(vault, constants.ROLE_A)
    result = ports.restore_port(vault)

    restored = (vault / constants.PLUGIN_DATA_REL).read_bytes()
    assert result.restored is True
    assert restored == ORIGINAL
    assert restored != left_by_the_crash
    assert hashlib.sha256(restored).hexdigest() == ORIGINAL_SHA
    assert not (vault / constants.SETTINGS_BACKUP_REL).exists()
    assert not (vault / constants.PROVISION_MARKER_REL).exists()


def test_the_new_run_may_take_the_other_role_and_port(tmp_path: Path) -> None:
    vault = foreign_crashed_vault(tmp_path, "v-foreign")

    record = ports.provision_port(vault, constants.ROLE_A)

    live = json.loads((vault / constants.PLUGIN_DATA_REL).read_bytes().decode("utf-8"))
    assert int(live[constants.SETTINGS_PORT_KEY]) == constants.REAL_CONTROL_PORT_A
    assert record.role == constants.ROLE_A
    marker = json.loads((vault / constants.PROVISION_MARKER_REL).read_bytes().decode("utf-8"))
    assert marker["port"] == constants.REAL_CONTROL_PORT_A
    assert marker["role"] == constants.ROLE_A
    # ... while the statement about the OWNER's file is unchanged
    assert marker["originalSha256"] == ORIGINAL_SHA


def test_recovery_without_an_intervening_provision_also_works(tmp_path: Path) -> None:
    # Teardown of a foreign crashed state, called directly — the reclaim path a
    # later WP will use at start-up.
    vault = foreign_crashed_vault(tmp_path, "v-direct")

    result = ports.restore_port(vault)

    assert result.restored is True
    assert result.had_original is True
    assert (vault / constants.PLUGIN_DATA_REL).read_bytes() == ORIGINAL
    assert not (vault / constants.SETTINGS_BACKUP_REL).exists()
