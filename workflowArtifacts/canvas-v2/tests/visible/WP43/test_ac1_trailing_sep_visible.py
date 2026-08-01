"""WP43 / AC1 (visible) — a configured path with a trailing separator resolves to its registry entry.

Data safety: fixtures only, under pytest's ``tmp_path``.
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

PLUGIN_MAIN_REL = getattr(constants, "PLUGIN_MAIN_REL", constants.PLUGIN_DIR_REL + "/main.js")


def _norm(value) -> str:
    return os.path.normcase(os.path.normpath(os.path.abspath(str(value))))


def _make_vault(root: Path) -> Path:
    (root / "Notes").mkdir(parents=True, exist_ok=True)
    (root / "Notes" / "a.md").write_text("# fixture\n", encoding="utf-8")
    main_js = root / Path(PLUGIN_MAIN_REL)
    main_js.parent.mkdir(parents=True, exist_ok=True)
    main_js.write_text(f"/* {constants.SETTINGS_PORT_KEY} */\n", encoding="utf-8")
    community = root / Path(constants.COMMUNITY_PLUGINS_REL)
    community.parent.mkdir(parents=True, exist_ok=True)
    community.write_text(json.dumps([constants.PLUGIN_ID]), encoding="utf-8")
    return root


def _write_registry(path: Path, entries: dict[str, str]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"vaults": {k: {"path": v, "ts": 42} for k, v in entries.items()}}), encoding="utf-8"
    )
    return path


def test_trailing_separator_in_configured_path_resolves(tmp_path: Path) -> None:
    vault = _make_vault(tmp_path / "vaults" / "TrailingVault")
    registry = _write_registry(tmp_path / "appdata" / "obsidian.json", {"1234000000000001": str(vault)})

    configured = str(vault) + os.sep
    assert configured.endswith(os.sep)

    resolution = vaults.resolve_vault(configured, registry_path=registry)

    assert resolution.ok is True
    assert resolution.failure is None
    assert resolution.registry_id == "1234000000000001"
    assert resolution.vault_name == "TrailingVault"
    assert _norm(resolution.resolved_path) == _norm(vault)
