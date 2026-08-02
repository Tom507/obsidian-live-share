# WP44 / AC2 — the "no settings file existed before" case.
#
# A vault where the plugin has never saved settings has NO data.json. Restoring
# such a vault to "the identical bytes" means leaving no file at all — not an
# empty file, not `{}`, not a file containing every default. Anything else is a
# file the owner did not have before the run.
#
#   ├── T1 provisioning creates the settings file and records hadOriginal=false.
#   ├── T2 no backup file is created — there was nothing to back up.
#   ├── T3 teardown removes the file entirely; the plugin directory is byte-for-
#   │      byte the directory it was before the run.
#   └── T4 a leftover empty / `{}` file is an explicit failure, not a pass.
#
# Data safety: fixture vault under tmp_path only.

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


def make_empty_plugin_vault(tmp_path: Path, name: str = "vault-fresh") -> Path:
    """A vault with the plugin installed but no settings ever saved."""
    vault = tmp_path / name
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    # main.js is what a real install has; data.json deliberately absent.
    (vault / constants.PLUGIN_DIR_REL / "main.js").write_bytes(b"// fixture build\n")
    return vault


def test_provisioning_creates_the_file_and_records_that_there_was_none(
    tmp_path: Path,
) -> None:
    vault = make_empty_plugin_vault(tmp_path)
    settings_path = vault / constants.PLUGIN_DATA_REL
    assert not settings_path.exists()

    record = ports.provision_port(vault, constants.ROLE_A)

    assert settings_path.is_file()
    parsed = json.loads(settings_path.read_bytes().decode("utf-8"))
    assert int(parsed[constants.SETTINGS_PORT_KEY]) == record.port

    assert record.had_original is False
    assert record.original_sha256 is None

    marker = json.loads((vault / constants.PROVISION_MARKER_REL).read_bytes().decode("utf-8"))
    assert marker["hadOriginal"] is False
    assert marker["originalSha256"] is None


def test_no_backup_file_is_created_when_there_was_nothing_to_back_up(
    tmp_path: Path,
) -> None:
    vault = make_empty_plugin_vault(tmp_path)

    ports.provision_port(vault, constants.ROLE_A)

    assert not (vault / constants.SETTINGS_BACKUP_REL).exists(), (
        "a backup of a file that never existed is a fabricated original — "
        "restore would then leave a file behind"
    )


def test_teardown_leaves_no_file_at_all(tmp_path: Path) -> None:
    vault = make_empty_plugin_vault(tmp_path)
    plugin_dir = vault / constants.PLUGIN_DIR_REL
    settings_path = vault / constants.PLUGIN_DATA_REL
    names_before = sorted(p.name for p in plugin_dir.iterdir())

    ports.provision_port(vault, constants.ROLE_A)
    result = ports.restore_port(vault)

    assert not settings_path.exists(), "the rig's addition must be removed, not emptied"
    assert result.restored is True
    assert result.had_original is False
    assert result.settings_file_present is False
    assert result.reason is None

    assert sorted(p.name for p in plugin_dir.iterdir()) == names_before
    assert not (vault / constants.SETTINGS_BACKUP_REL).exists()
    assert not (vault / constants.PROVISION_MARKER_REL).exists()


def test_an_empty_or_stub_file_left_behind_is_a_failure(tmp_path: Path) -> None:
    # Same cycle as T3, phrased as the exact defect it exists to catch: a restore
    # that "clears" the settings instead of removing the file.
    vault = make_empty_plugin_vault(tmp_path)
    settings_path = vault / constants.PLUGIN_DATA_REL

    ports.provision_port(vault, constants.ROLE_B)
    ports.restore_port(vault)

    if settings_path.exists():
        leftover = settings_path.read_bytes()
        raise AssertionError(
            "settings file still present after teardown "
            f"({len(leftover)} bytes) — the vault must look untouched"
        )
