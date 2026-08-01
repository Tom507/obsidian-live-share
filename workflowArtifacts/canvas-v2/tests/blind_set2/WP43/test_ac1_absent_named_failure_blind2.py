"""WP43 / AC1 (blind 2) — two different kinds of "cannot use this vault" stay two different names,
and a near-miss registry entry is never used as a fallback.

Angle of attack: role a is *in* the registry but its directory does not exist on disk
(``VAULT_PATH_MISSING``); role b is a real directory that is *not* in the registry while a
sibling entry with an almost identical name sits there to tempt a guess
(``VAULT_NOT_IN_REGISTRY``). The two reasons must not collapse into one.

Data safety: fixtures only, under pytest's ``tmp_path``.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

_TOOLS = Path(__file__).resolve().parents[5] / "tools"
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, vaults  # noqa: E402

_MAIN = getattr(constants, "PLUGIN_MAIN_REL", constants.PLUGIN_DIR_REL + "/main.js")


def _vault(root: Path) -> Path:
    (root / "Refs").mkdir(parents=True, exist_ok=True)
    (root / "Refs" / "r.md").write_text("fixture\n", encoding="utf-8")
    main_js = root / Path(_MAIN)
    main_js.parent.mkdir(parents=True, exist_ok=True)
    main_js.write_text(f"/*{constants.SETTINGS_PORT_KEY}*/", encoding="utf-8")
    community = root / Path(constants.COMMUNITY_PLUGINS_REL)
    community.parent.mkdir(parents=True, exist_ok=True)
    community.write_text(json.dumps([constants.PLUGIN_ID]), encoding="utf-8")
    return root


def test_missing_directory_and_missing_entry_are_distinct_named_failures(tmp_path: Path) -> None:
    ghost = tmp_path / "vaults" / "GhostVault"  # registered, never created on disk
    decoy = _vault(tmp_path / "vaults" / "Orga Fixture")
    orphan = _vault(tmp_path / "vaults" / "Orga Fixture Two")

    registry = tmp_path / "cfg" / "obsidian.json"
    registry.parent.mkdir(parents=True, exist_ok=True)
    registry.write_text(
        json.dumps(
            {
                "vaults": {
                    "0bad000000000001": {"path": str(ghost)},
                    "0bad000000000002": {"path": str(decoy)},
                }
            }
        ),
        encoding="utf-8",
    )

    ghost_resolution = vaults.resolve_vault(str(ghost), registry_path=registry)
    orphan_resolution = vaults.resolve_vault(str(orphan), registry_path=registry)

    assert ghost_resolution.ok is False
    assert ghost_resolution.failure == constants.VAULT_PATH_MISSING
    assert ghost_resolution.failure != constants.VAULT_NOT_IN_REGISTRY

    assert orphan_resolution.ok is False
    assert orphan_resolution.failure == constants.VAULT_NOT_IN_REGISTRY
    # the near-identical decoy must not be handed back as a guess
    assert orphan_resolution.registry_id is None
    assert orphan_resolution.resolved_path is None

    assert constants.VAULT_PATH_MISSING != constants.VAULT_NOT_IN_REGISTRY
