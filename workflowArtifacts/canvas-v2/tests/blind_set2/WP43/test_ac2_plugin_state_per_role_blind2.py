"""WP43 / AC2 (blind 2) — absent configuration files are read as states, not as crashes.

Angle of attack: neither vault has a usable ``community-plugins.json``.
Role a has the plugin installed but the enablement file does not exist at all (a vault where the
user never enabled any community plugin) → present but disabled.
Role b has no ``.obsidian`` directory whatsoever → plugin missing.
Neither case may raise, and the two must not be reported as the same state.

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

_MAIN = getattr(constants, "PLUGIN_MAIN_REL", constants.PLUGIN_DIR_REL + "/main.js")


def test_absent_enablement_file_and_absent_obsidian_dir_are_different_states(tmp_path: Path) -> None:
    vault_a = tmp_path / "vaults" / "NeverEnabled"
    (vault_a / "Notes").mkdir(parents=True, exist_ok=True)
    (vault_a / "Notes" / "a.md").write_text("fixture\n", encoding="utf-8")
    main_js = vault_a / Path(_MAIN)
    main_js.parent.mkdir(parents=True, exist_ok=True)
    main_js.write_text(f"/*{constants.SETTINGS_PORT_KEY}*/", encoding="utf-8")
    assert not (vault_a / Path(constants.COMMUNITY_PLUGINS_REL)).exists()

    vault_b = tmp_path / "vaults" / "Bare Vault"
    (vault_b / "Notes").mkdir(parents=True, exist_ok=True)
    (vault_b / "Notes" / "b.md").write_text("fixture\n", encoding="utf-8")
    assert not (vault_b / ".obsidian").exists()

    registry = tmp_path / "cfg" / "obsidian.json"
    registry.parent.mkdir(parents=True, exist_ok=True)
    registry.write_text(
        json.dumps(
            {
                "vaults": {
                    "c200000000000001": {"path": str(vault_a)},
                    "c200000000000002": {"path": str(vault_b)},
                }
            }
        ),
        encoding="utf-8",
    )

    result = vaults.discover_instances(
        vault_paths={constants.ROLE_A: str(vault_a), constants.ROLE_B: str(vault_b)},
        registry_path=registry,
    )

    never_enabled = result.instances[constants.ROLE_A]
    assert never_enabled.plugin_present is True
    assert never_enabled.plugin_enabled is False
    assert never_enabled.plugin_state == constants.PLUGIN_PRESENT_BUT_DISABLED

    bare = result.instances[constants.ROLE_B]
    assert bare.plugin_present is False
    assert bare.plugin_state == constants.PLUGIN_MISSING

    assert never_enabled.plugin_state != bare.plugin_state
