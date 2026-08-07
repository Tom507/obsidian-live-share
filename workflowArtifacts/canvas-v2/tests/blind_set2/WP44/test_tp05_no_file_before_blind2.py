# WP44 / AC2 (blind 2) — "no file existed" is a claim about the OWNER's file,
# not about the moment the check happens.
#
# Angle: the previous sets provision a fresh vault and tear it down. Here the
# fresh vault goes through the sequences that tempt an implementation into
# deciding "there was a file after all": a teardown after a recovery run, a
# teardown after the settings file was written by something else mid-run, and a
# teardown on a vault where only the marker survives.

from __future__ import annotations

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


def fresh_vault(tmp_path: Path, name: str) -> Path:
    vault = tmp_path / name
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    return vault


def test_a_recovery_run_still_knows_there_was_no_original(tmp_path: Path) -> None:
    vault = fresh_vault(tmp_path, "v-recovery")

    ports.provision_port(vault, constants.ROLE_A)  # run 1, then crash
    record = ports.provision_port(vault, constants.ROLE_B)  # run 2

    assert record.had_original is False
    assert record.original_sha256 is None
    assert not (vault / constants.SETTINGS_BACKUP_REL).exists()

    result = ports.restore_port(vault)
    assert result.had_original is False
    assert not (vault / constants.PLUGIN_DATA_REL).exists()


def test_three_runs_and_one_teardown_still_leave_nothing(tmp_path: Path) -> None:
    vault = fresh_vault(tmp_path, "v-three")
    plugin_dir = vault / constants.PLUGIN_DIR_REL

    for role in (constants.ROLE_A, constants.ROLE_B, constants.ROLE_A):
        ports.provision_port(vault, role)

    ports.restore_port(vault)

    assert list(plugin_dir.iterdir()) == []


def test_the_marker_alone_is_enough_to_clean_up(tmp_path: Path) -> None:
    # Only the marker survived a crash (the settings write never landed). Teardown
    # must still succeed and must not invent a file.
    vault = fresh_vault(tmp_path, "v-marker-only")
    (vault / constants.PROVISION_MARKER_REL).write_bytes(
        json.dumps(
            {
                "runId": "20260101T000000Z-31-aa11bb",
                "role": constants.ROLE_A,
                "port": constants.REAL_CONTROL_PORT_A,
                "hadOriginal": False,
                "originalSha256": None,
                "pid": 31,
                "createdAt": "2026-01-01T00:00:00+00:00",
            },
            indent=2,
        ).encode("utf-8")
    )

    result = ports.restore_port(vault)

    assert result.restored is True
    assert result.had_original is False
    assert result.settings_file_present is False
    assert not (vault / constants.PLUGIN_DATA_REL).exists()
    assert not (vault / constants.PROVISION_MARKER_REL).exists()


def test_a_vault_that_never_ran_is_left_completely_alone(tmp_path: Path) -> None:
    vault = fresh_vault(tmp_path, "v-untouched")
    (vault / constants.PLUGIN_DIR_REL / "main.js").write_bytes(b"// build\n")

    result = ports.restore_port(vault)

    assert result.restored is False
    assert result.reason is None
    assert not (vault / constants.PLUGIN_DATA_REL).exists()
    assert (vault / constants.PLUGIN_DIR_REL / "main.js").read_bytes() == b"// build\n"


def test_the_provisioned_file_is_the_only_thing_the_run_adds(tmp_path: Path) -> None:
    vault = fresh_vault(tmp_path, "v-only")
    plugin_dir = vault / constants.PLUGIN_DIR_REL

    ports.provision_port(vault, constants.ROLE_A)

    added = sorted(p.name for p in plugin_dir.iterdir())
    assert added == sorted(
        Path(rel).name
        for rel in (constants.PLUGIN_DATA_REL, constants.PROVISION_MARKER_REL)
    ), "a fresh vault must not gain a backup file"

    # nothing but the port is in the file the rig created — it must not seed the
    # owner's vault with a set of invented defaults
    settings = json.loads((vault / constants.PLUGIN_DATA_REL).read_bytes().decode())
    assert list(settings) == [constants.SETTINGS_PORT_KEY]
