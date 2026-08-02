"""WP43 / AC1 (blind 2) — mixed trailing separators on both roles at once must not cross-match.

Angle of attack: full discovery rather than single resolution; role a gets a native trailing
separator, role b gets a POSIX one *and* a space-bearing name, and the assertion is that the two
roles land on their own distinct registry entries rather than collapsing onto one.

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

_MAIN = getattr(constants, "PLUGIN_MAIN_REL", constants.PLUGIN_DIR_REL + "/main.js")


def _failure_names(instance) -> tuple:
    """Named failure reasons of a descriptor, tolerant of a tuple or a single-value field."""
    value = getattr(instance, "failures", None)
    if value is None:
        value = getattr(instance, "failure", None)
    if value is None:
        return ()
    return (value,) if isinstance(value, str) else tuple(value)


def _key(value) -> str:
    return os.path.normcase(os.path.normpath(os.path.abspath(str(value))))


def _vault(root: Path) -> Path:
    (root / "Boards").mkdir(parents=True, exist_ok=True)
    (root / "Boards" / "plan.canvas").write_text('{"nodes":[],"edges":[]}', encoding="utf-8")
    main_js = root / Path(_MAIN)
    main_js.parent.mkdir(parents=True, exist_ok=True)
    main_js.write_text(f"/*{constants.SETTINGS_PORT_KEY}*/", encoding="utf-8")
    community = root / Path(constants.COMMUNITY_PLUGINS_REL)
    community.parent.mkdir(parents=True, exist_ok=True)
    community.write_text(json.dumps(["dataview", constants.PLUGIN_ID]), encoding="utf-8")
    return root


def _registry(path: Path, mapping: dict[str, str]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"vaults": {k: {"path": v} for k, v in mapping.items()}}), encoding="utf-8")
    return path


def test_both_roles_with_different_trailing_separators_keep_distinct_identities(tmp_path: Path) -> None:
    vault_a = _vault(tmp_path / "workspace" / "OrgaFixture")
    vault_b = _vault(tmp_path / "workspace" / "OrgaFixture - Kopie")

    registry = _registry(
        tmp_path / "cfg" / "obsidian.json",
        {"aa00000000000001": str(vault_a), "aa00000000000002": str(vault_b)},
    )

    result = vaults.discover_instances(
        vault_paths={
            constants.ROLE_A: str(vault_a) + os.sep,
            constants.ROLE_B: vault_b.as_posix() + "/",
        },
        registry_path=registry,
    )

    instance_a = result.instances[constants.ROLE_A]
    instance_b = result.instances[constants.ROLE_B]

    assert instance_a.registry_id == "aa00000000000001"
    assert instance_b.registry_id == "aa00000000000002"
    assert _key(instance_a.resolved_path) != _key(instance_b.resolved_path)
    assert constants.VAULT_NOT_IN_REGISTRY not in _failure_names(instance_a)
    assert constants.VAULT_NOT_IN_REGISTRY not in _failure_names(instance_b)
