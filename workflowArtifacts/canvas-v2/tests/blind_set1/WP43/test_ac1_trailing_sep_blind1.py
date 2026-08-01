"""WP43 / AC1 (blind 1) — the trailing separator sits on the *registry* side this time.

Angle of attack: normalisation must be symmetric. The registry records the vault path with a
trailing POSIX separator, the caller supplies the bare native path, and the reported vault name
must not degenerate into an empty string (the classic ``basename('x/')`` bug).

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

_MAIN_REL = getattr(constants, "PLUGIN_MAIN_REL", constants.PLUGIN_DIR_REL + "/main.js")


def _key(value) -> str:
    return os.path.normcase(os.path.normpath(os.path.abspath(str(value))))


def _vault(root: Path) -> Path:
    (root / "Meetings").mkdir(parents=True, exist_ok=True)
    (root / "Meetings" / "standup.md").write_text("fixture\n", encoding="utf-8")
    main_js = root / Path(_MAIN_REL)
    main_js.parent.mkdir(parents=True, exist_ok=True)
    main_js.write_text(f"//{constants.SETTINGS_PORT_KEY}\n", encoding="utf-8")
    community = root / Path(constants.COMMUNITY_PLUGINS_REL)
    community.parent.mkdir(parents=True, exist_ok=True)
    community.write_text(json.dumps([constants.PLUGIN_ID]), encoding="utf-8")
    return root


def _registry(path: Path, mapping: dict[str, str]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"vaults": {k: {"path": v} for k, v in mapping.items()}}), encoding="utf-8")
    return path


def test_registry_recorded_trailing_separator_still_matches_bare_configured_path(tmp_path: Path) -> None:
    vault = _vault(tmp_path / "libraries" / "KnowledgeBase")
    recorded = vault.as_posix() + "/"
    registry = _registry(tmp_path / "appdata" / "obsidian.json", {"5150000000000003": recorded})

    resolution = vaults.resolve_vault(str(vault), registry_path=registry)

    assert resolution.ok is True
    assert resolution.registry_id == "5150000000000003"
    assert _key(resolution.resolved_path) == _key(vault)
    assert resolution.vault_name == "KnowledgeBase"
    assert not str(resolution.resolved_path).endswith(("/", "\\"))
