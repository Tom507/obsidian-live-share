"""WP43 / AC1 (visible) — a configured vault path containing spaces resolves to its registry entry.

Data safety: every path used here lives under pytest's ``tmp_path``. The real vaults
(``ObsidianOrga`` / ``ObsidianOrga - Kopie``) and ``%APPDATA%\\obsidian`` are never touched.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

_TOOLS = Path(__file__).resolve().parents[5] / "tools"
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, vaults  # noqa: E402

PLUGIN_DIR_REL = constants.PLUGIN_DIR_REL
COMMUNITY_PLUGINS_REL = constants.COMMUNITY_PLUGINS_REL
PLUGIN_MAIN_REL = getattr(constants, "PLUGIN_MAIN_REL", PLUGIN_DIR_REL + "/main.js")


def _norm(value) -> str:
    return os.path.normcase(os.path.normpath(os.path.abspath(str(value))))


def _make_vault(root: Path) -> Path:
    (root / "Daily Notes").mkdir(parents=True, exist_ok=True)
    (root / "Daily Notes" / "2026-08-01.md").write_text("# fixture\n", encoding="utf-8")
    plugin_main = root / Path(PLUGIN_MAIN_REL)
    plugin_main.parent.mkdir(parents=True, exist_ok=True)
    plugin_main.write_text(f"/* fixture build :: {constants.SETTINGS_PORT_KEY} */\n", encoding="utf-8")
    community = root / Path(COMMUNITY_PLUGINS_REL)
    community.parent.mkdir(parents=True, exist_ok=True)
    community.write_text(json.dumps([constants.PLUGIN_ID]), encoding="utf-8")
    return root


def _write_registry(path: Path, entries: dict[str, str]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "vaults": {
            vault_id: {"path": vault_path, "ts": 1_770_000_000_000, "open": False}
            for vault_id, vault_path in entries.items()
        }
    }
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def test_space_bearing_vault_path_resolves_to_its_registry_entry(tmp_path: Path) -> None:
    vault = _make_vault(tmp_path / "vaults" / "Orga Notes Alpha")
    assert " " in vault.name, "fixture must exercise the space-in-path case"

    registry = _write_registry(
        tmp_path / "appdata" / "obsidian.json",
        {"a1b2c3d4e5f60001": str(vault)},
    )

    resolution = vaults.resolve_vault(str(vault), registry_path=registry)

    assert resolution.ok is True
    assert resolution.failure is None
    assert resolution.registry_id == "a1b2c3d4e5f60001"
    assert resolution.vault_name == "Orga Notes Alpha"
    assert _norm(resolution.resolved_path) == _norm(vault)
