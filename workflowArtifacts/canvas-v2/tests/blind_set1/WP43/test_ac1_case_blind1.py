"""WP43 / AC1 (blind 1) — case-insensitive resolution must not become case-blind matching.

Angle of attack: the configured path is fully upper-cased (the opposite direction from the
visible test) and the registry additionally holds an unrelated vault. Case folding must resolve
the right entry and must not make a genuinely different vault resolve to it.

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
    (root / "Archive").mkdir(parents=True, exist_ok=True)
    (root / "Archive" / "old.md").write_text("fixture\n", encoding="utf-8")
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


def test_uppercased_configured_path_resolves_and_neighbour_does_not(tmp_path: Path) -> None:
    target = _vault(tmp_path / "roots" / "PrimaryVault")
    neighbour = _vault(tmp_path / "roots" / "SecondaryVault")

    registry = _registry(
        tmp_path / "appdata" / "obsidian" / "obsidian.json",
        {"dead000000000001": str(target), "dead000000000002": str(neighbour)},
    )

    shouted = str(target).upper()
    assert shouted != str(target)

    resolution = vaults.resolve_vault(shouted, registry_path=registry)

    assert resolution.ok is True
    assert resolution.registry_id == "dead000000000001"
    assert resolution.registry_id != "dead000000000002"
    assert _key(resolution.resolved_path) == _key(target)

    neighbour_resolution = vaults.resolve_vault(str(neighbour), registry_path=registry)
    assert neighbour_resolution.registry_id == "dead000000000002"
