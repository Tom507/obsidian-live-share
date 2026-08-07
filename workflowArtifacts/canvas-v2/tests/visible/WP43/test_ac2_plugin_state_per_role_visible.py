"""WP43 / AC2 (visible) — per role the module reports plugin presence and enablement.

Role a: plugin installed and listed in ``community-plugins.json`` → present + enabled.
Role b: no plugin directory at all → ``PLUGIN_MISSING``.

Data safety: fixtures only, under pytest's ``tmp_path``. ``data.json`` content is never asserted on.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

_TOOLS = Path(__file__).resolve().parents[5] / "tools"
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, vaults  # noqa: E402

PLUGIN_MAIN_REL = getattr(constants, "PLUGIN_MAIN_REL", constants.PLUGIN_DIR_REL + "/main.js")


def _base_vault(root: Path) -> Path:
    (root / "Notes").mkdir(parents=True, exist_ok=True)
    (root / "Notes" / "n.md").write_text("# fixture\n", encoding="utf-8")
    (root / ".obsidian").mkdir(parents=True, exist_ok=True)
    return root


def _install_plugin(root: Path) -> None:
    main_js = root / Path(PLUGIN_MAIN_REL)
    main_js.parent.mkdir(parents=True, exist_ok=True)
    main_js.write_text(f"/* fixture build :: {constants.SETTINGS_PORT_KEY} */\n", encoding="utf-8")


def _enable(root: Path, plugin_ids: list[str]) -> None:
    community = root / Path(constants.COMMUNITY_PLUGINS_REL)
    community.parent.mkdir(parents=True, exist_ok=True)
    community.write_text(json.dumps(plugin_ids), encoding="utf-8")


def _write_registry(path: Path, entries: dict[str, str]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"vaults": {k: {"path": v} for k, v in entries.items()}}), encoding="utf-8")
    return path


def test_present_and_enabled_versus_plugin_missing(tmp_path: Path) -> None:
    vault_a = _base_vault(tmp_path / "vaults" / "WithPlugin")
    _install_plugin(vault_a)
    _enable(vault_a, [constants.PLUGIN_ID])

    vault_b = _base_vault(tmp_path / "vaults" / "WithoutPlugin")
    _enable(vault_b, ["dataview"])

    registry = _write_registry(
        tmp_path / "appdata" / "obsidian.json",
        {"e2e0000000000001": str(vault_a), "e2e0000000000002": str(vault_b)},
    )

    result = vaults.discover_instances(
        vault_paths={constants.ROLE_A: str(vault_a), constants.ROLE_B: str(vault_b)},
        registry_path=registry,
    )

    instance_a = result.instances[constants.ROLE_A]
    assert instance_a.plugin_present is True
    assert instance_a.plugin_enabled is True
    assert instance_a.plugin_state != constants.PLUGIN_MISSING
    assert instance_a.plugin_state != constants.PLUGIN_PRESENT_BUT_DISABLED

    instance_b = result.instances[constants.ROLE_B]
    assert instance_b.plugin_present is False
    assert instance_b.plugin_state == constants.PLUGIN_MISSING
