"""WP43 / AC2 (blind 2) — filtering by "missing" must never catch the disabled vault, and the
named states of the whole plugin family stay pairwise distinct.

Angle of attack: consumer-side. A caller that selects the vaults it cannot drive by comparing
against ``PLUGIN_MISSING`` must get exactly one vault back, and the boolean presence flag must
still separate the two. Also covers the third named plugin state from the shared contract.

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


def _vault(root: Path, *, install: bool, listed: list[str]) -> Path:
    (root / "Log").mkdir(parents=True, exist_ok=True)
    (root / "Log" / "l.md").write_text("fixture\n", encoding="utf-8")
    if install:
        main_js = root / Path(_MAIN)
        main_js.parent.mkdir(parents=True, exist_ok=True)
        main_js.write_text(f"/*{constants.SETTINGS_PORT_KEY}*/", encoding="utf-8")
    community = root / Path(constants.COMMUNITY_PLUGINS_REL)
    community.parent.mkdir(parents=True, exist_ok=True)
    community.write_text(json.dumps(listed), encoding="utf-8")
    return root


def test_selecting_missing_vaults_never_returns_the_disabled_one(tmp_path: Path) -> None:
    dormant = _vault(tmp_path / "vaults" / "Dormant Copy", install=True, listed=[])
    absent = _vault(tmp_path / "vaults" / "Absent Copy", install=False, listed=[])

    registry = tmp_path / "cfg" / "obsidian.json"
    registry.parent.mkdir(parents=True, exist_ok=True)
    registry.write_text(
        json.dumps(
            {
                "vaults": {
                    "9900000000000001": {"path": str(dormant)},
                    "9900000000000002": {"path": str(absent)},
                }
            }
        ),
        encoding="utf-8",
    )

    result = vaults.discover_instances(
        vault_paths={constants.ROLE_A: str(dormant), constants.ROLE_B: str(absent)},
        registry_path=registry,
    )

    missing_roles = [
        role
        for role, instance in result.instances.items()
        if instance.plugin_state == constants.PLUGIN_MISSING
    ]
    assert missing_roles == [constants.ROLE_B]

    disabled_roles = [
        role
        for role, instance in result.instances.items()
        if instance.plugin_state == constants.PLUGIN_PRESENT_BUT_DISABLED
    ]
    assert disabled_roles == [constants.ROLE_A]

    assert result.instances[constants.ROLE_A].plugin_present is True
    assert result.instances[constants.ROLE_B].plugin_present is False


def test_plugin_state_family_is_pairwise_distinct() -> None:
    family = (
        constants.PLUGIN_MISSING,
        constants.PLUGIN_PRESENT_BUT_DISABLED,
        constants.PLUGIN_NOT_E2E_CAPABLE,
    )
    assert len(set(family)) == len(family)
    assert all(isinstance(value, str) and value for value in family)
