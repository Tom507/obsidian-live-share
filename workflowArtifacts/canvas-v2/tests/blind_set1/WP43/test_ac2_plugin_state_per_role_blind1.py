"""WP43 / AC2 (blind 1) — installed-but-not-listed reports the disabled state, per role and
independently of the other role.

Angle of attack: the roles are inverted relative to the visible test — role a is installed but
``community-plugins.json`` lists only *other* plugins, role b is fully enabled. One role being
degraded must not colour the other role's report.

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

_MAIN_REL = getattr(constants, "PLUGIN_MAIN_REL", constants.PLUGIN_DIR_REL + "/main.js")


def _vault(root: Path, *, install: bool, enabled_ids: list[str]) -> Path:
    (root / "Cards").mkdir(parents=True, exist_ok=True)
    (root / "Cards" / "c.md").write_text("fixture\n", encoding="utf-8")
    if install:
        main_js = root / Path(_MAIN_REL)
        main_js.parent.mkdir(parents=True, exist_ok=True)
        main_js.write_text(f"//{constants.SETTINGS_PORT_KEY}\n", encoding="utf-8")
    community = root / Path(constants.COMMUNITY_PLUGINS_REL)
    community.parent.mkdir(parents=True, exist_ok=True)
    community.write_text(json.dumps(enabled_ids), encoding="utf-8")
    return root


def test_installed_but_unlisted_is_reported_as_present_but_disabled(tmp_path: Path) -> None:
    vault_a = _vault(tmp_path / "v" / "Disabled Vault", install=True, enabled_ids=["templater", "dataview"])
    vault_b = _vault(tmp_path / "v" / "Enabled Vault", install=True, enabled_ids=[constants.PLUGIN_ID])

    registry = tmp_path / "appdata" / "obsidian.json"
    registry.parent.mkdir(parents=True, exist_ok=True)
    registry.write_text(
        json.dumps(
            {
                "vaults": {
                    "b100000000000001": {"path": str(vault_a)},
                    "b100000000000002": {"path": str(vault_b)},
                }
            }
        ),
        encoding="utf-8",
    )

    result = vaults.discover_instances(
        vault_paths={constants.ROLE_A: str(vault_a), constants.ROLE_B: str(vault_b)},
        registry_path=registry,
    )

    disabled = result.instances[constants.ROLE_A]
    assert disabled.plugin_present is True
    assert disabled.plugin_enabled is False
    assert disabled.plugin_state == constants.PLUGIN_PRESENT_BUT_DISABLED

    enabled = result.instances[constants.ROLE_B]
    assert enabled.plugin_present is True
    assert enabled.plugin_enabled is True
    assert enabled.plugin_state != constants.PLUGIN_PRESENT_BUT_DISABLED
    assert enabled.plugin_state != constants.PLUGIN_MISSING
