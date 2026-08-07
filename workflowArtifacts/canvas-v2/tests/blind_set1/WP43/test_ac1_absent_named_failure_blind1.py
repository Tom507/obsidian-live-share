"""WP43 / AC1 (blind 1) — an empty registry yields named failures for both roles and no exception.

Angle of attack: the degenerate registry (``{"vaults": {}}``) via full discovery. The module must
still return a result object naming the failure per role rather than raising, and neither role may
end up carrying any registry identity.

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

_MAIN_REL = getattr(constants, "PLUGIN_MAIN_REL", constants.PLUGIN_DIR_REL + "/main.js")


def _failure_names(instance) -> tuple:
    """Named failure reasons of a descriptor, tolerant of a tuple or a single-value field."""
    value = getattr(instance, "failures", None)
    if value is None:
        value = getattr(instance, "failure", None)
    if value is None:
        return ()
    return (value,) if isinstance(value, str) else tuple(value)


def _vault(root: Path) -> Path:
    (root / "Zettel").mkdir(parents=True, exist_ok=True)
    (root / "Zettel" / "z1.md").write_text("fixture\n", encoding="utf-8")
    main_js = root / Path(_MAIN_REL)
    main_js.parent.mkdir(parents=True, exist_ok=True)
    main_js.write_text(f"//{constants.SETTINGS_PORT_KEY}\n", encoding="utf-8")
    community = root / Path(constants.COMMUNITY_PLUGINS_REL)
    community.parent.mkdir(parents=True, exist_ok=True)
    community.write_text(json.dumps([constants.PLUGIN_ID]), encoding="utf-8")
    return root


def test_empty_registry_names_the_failure_for_every_role(tmp_path: Path) -> None:
    vault_a = _vault(tmp_path / "v" / "Alpha")
    vault_b = _vault(tmp_path / "v" / "Beta Vault")

    registry = tmp_path / "appdata" / "obsidian.json"
    registry.parent.mkdir(parents=True, exist_ok=True)
    registry.write_text(json.dumps({"vaults": {}}), encoding="utf-8")

    result = vaults.discover_instances(
        vault_paths={constants.ROLE_A: str(vault_a), constants.ROLE_B: str(vault_b)},
        registry_path=registry,
    )

    for role in (constants.ROLE_A, constants.ROLE_B):
        instance = result.instances[role]
        failures = _failure_names(instance)
        assert constants.VAULT_NOT_IN_REGISTRY in failures
        assert instance.registry_id is None
        assert instance.resolved_path is None

    # The reason must be the pinned constant, not an ad-hoc or empty string.
    assert isinstance(constants.VAULT_NOT_IN_REGISTRY, str)
    assert constants.VAULT_NOT_IN_REGISTRY.strip() == constants.VAULT_NOT_IN_REGISTRY
    assert constants.VAULT_NOT_IN_REGISTRY != ""
