"""WP43 / AC2 (visible) — "present but disabled" is a distinct named state, not a variant of
"missing".

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

PLUGIN_MAIN_REL = getattr(constants, "PLUGIN_MAIN_REL", constants.PLUGIN_DIR_REL + "/main.js")


def _vault(root: Path, *, install: bool, enabled: bool) -> Path:
    (root / "Notes").mkdir(parents=True, exist_ok=True)
    (root / "Notes" / "n.md").write_text("# fixture\n", encoding="utf-8")
    if install:
        main_js = root / Path(PLUGIN_MAIN_REL)
        main_js.parent.mkdir(parents=True, exist_ok=True)
        main_js.write_text(f"/* {constants.SETTINGS_PORT_KEY} */\n", encoding="utf-8")
    community = root / Path(constants.COMMUNITY_PLUGINS_REL)
    community.parent.mkdir(parents=True, exist_ok=True)
    community.write_text(json.dumps([constants.PLUGIN_ID] if enabled else []), encoding="utf-8")
    return root


def test_the_two_states_are_different_values(tmp_path: Path) -> None:
    assert isinstance(constants.PLUGIN_MISSING, str)
    assert isinstance(constants.PLUGIN_PRESENT_BUT_DISABLED, str)
    assert constants.PLUGIN_PRESENT_BUT_DISABLED != constants.PLUGIN_MISSING
    assert len({constants.PLUGIN_MISSING, constants.PLUGIN_PRESENT_BUT_DISABLED}) == 2
    # not a subtype expressed by containment either
    assert constants.PLUGIN_MISSING not in constants.PLUGIN_PRESENT_BUT_DISABLED
    assert constants.PLUGIN_PRESENT_BUT_DISABLED not in constants.PLUGIN_MISSING


def test_disabled_vault_is_not_reported_as_missing(tmp_path: Path) -> None:
    disabled_vault = _vault(tmp_path / "vaults" / "DisabledVault", install=True, enabled=False)
    missing_vault = _vault(tmp_path / "vaults" / "MissingVault", install=False, enabled=False)

    registry = tmp_path / "appdata" / "obsidian.json"
    registry.parent.mkdir(parents=True, exist_ok=True)
    registry.write_text(
        json.dumps(
            {
                "vaults": {
                    "d100000000000001": {"path": str(disabled_vault)},
                    "d100000000000002": {"path": str(missing_vault)},
                }
            }
        ),
        encoding="utf-8",
    )

    result = vaults.discover_instances(
        vault_paths={constants.ROLE_A: str(disabled_vault), constants.ROLE_B: str(missing_vault)},
        registry_path=registry,
    )

    disabled = result.instances[constants.ROLE_A]
    missing = result.instances[constants.ROLE_B]

    assert disabled.plugin_state == constants.PLUGIN_PRESENT_BUT_DISABLED
    assert disabled.plugin_state != constants.PLUGIN_MISSING
    assert missing.plugin_state == constants.PLUGIN_MISSING
    assert disabled.plugin_state != missing.plugin_state
