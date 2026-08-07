# WP44 / AC2 (blind 1) — the "no settings file" case in a populated plugin folder.
#
# Angle: the visible set uses a nearly empty plugin directory. A restore that
# "cleans up" by clearing the folder, or that leaves a zero-byte data.json, is
# only visible when the folder has other content and a subfolder. The oracle here
# is a full recursive manifest of the vault, plus an explicit read of whatever
# data.json may have been left behind.

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

# T3_SharedContract import rule: `import tools.…` resolves to the WORKSPACE `tools`
# package (a regular package always beats a namespace portion), never to this repo's.
# Put <repo>/tools on sys.path and import by the globally unique package name.
_TOOLS = Path(__file__).resolve().parents[5] / "tools"
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, ports  # noqa: E402


def manifest(root: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root).as_posix()
        out[rel] = (
            "dir" if path.is_dir() else hashlib.sha256(path.read_bytes()).hexdigest()
        )
    return out


def make_vault(tmp_path: Path, name: str = "Vault ohne data") -> Path:
    vault = tmp_path / name
    plugin_dir = vault / constants.PLUGIN_DIR_REL
    plugin_dir.mkdir(parents=True, exist_ok=True)
    (plugin_dir / "main.js").write_bytes(b"// fixture build\n")
    (plugin_dir / "styles.css").write_bytes(b".ls{}\n")
    (plugin_dir / "assets").mkdir()
    (plugin_dir / "assets" / "icon.svg").write_bytes(b"<svg/>")
    (vault / "Notes").mkdir()
    (vault / "Notes" / "keep me.md").write_bytes("# Notiz — nicht anfassen\n".encode("utf-8"))
    return vault


def test_the_vault_is_bit_identical_after_a_full_cycle(tmp_path: Path) -> None:
    vault = make_vault(tmp_path)
    before = manifest(vault)
    assert f"{constants.PLUGIN_DATA_REL}" not in before

    ports.provision_port(vault, constants.ROLE_B)
    ports.restore_port(vault)

    assert manifest(vault) == before


def test_nothing_at_all_is_left_where_data_json_would_be(tmp_path: Path) -> None:
    vault = make_vault(tmp_path)
    settings_path = vault / constants.PLUGIN_DATA_REL

    ports.provision_port(vault, constants.ROLE_A)
    assert settings_path.is_file()

    result = ports.restore_port(vault)

    assert result.settings_file_present is False
    assert not settings_path.exists()
    assert not settings_path.is_file()
    # not a directory either, and no near-miss sibling name
    plugin_dir = vault / constants.PLUGIN_DIR_REL
    leftovers = [p.name for p in plugin_dir.iterdir() if p.name.startswith("data")]
    assert leftovers == []


def test_restoring_twice_still_leaves_nothing(tmp_path: Path) -> None:
    vault = make_vault(tmp_path)
    before = manifest(vault)

    ports.provision_port(vault, constants.ROLE_A)
    ports.restore_port(vault)
    second = ports.restore_port(vault)

    assert second.restored is False
    assert second.reason is None
    assert manifest(vault) == before


def test_a_run_that_never_reaches_teardown_can_still_be_cleaned_up_later(
    tmp_path: Path,
) -> None:
    # crash after provisioning: the next teardown must still remove the file
    vault = make_vault(tmp_path)
    before = manifest(vault)

    ports.provision_port(vault, constants.ROLE_A)
    # (crash — no restore)
    ports.provision_port(vault, constants.ROLE_A)
    ports.restore_port(vault)

    assert manifest(vault) == before
