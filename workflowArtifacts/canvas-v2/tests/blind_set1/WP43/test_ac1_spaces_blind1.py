"""WP43 / AC1 (blind 1) — space-bearing paths recorded with POSIX separators still resolve.

Angle of attack differs from the visible test: the registry records forward-slash paths while
the caller supplies native Windows paths, both roles are resolved in one discovery call, and the
parent directory also contains a space.

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

_PLUGIN_MAIN_REL = getattr(constants, "PLUGIN_MAIN_REL", constants.PLUGIN_DIR_REL + "/main.js")


def _failure_names(instance) -> tuple:
    """Named failure reasons of a descriptor, tolerant of a tuple or a single-value field."""
    value = getattr(instance, "failures", None)
    if value is None:
        value = getattr(instance, "failure", None)
    if value is None:
        return ()
    return (value,) if isinstance(value, str) else tuple(value)


def _canonical(value) -> str:
    return os.path.normcase(os.path.normpath(os.path.abspath(str(value))))


def _build_vault(root: Path) -> Path:
    (root / "Projekte").mkdir(parents=True, exist_ok=True)
    (root / "Projekte" / "board.canvas").write_text('{"nodes":[],"edges":[]}', encoding="utf-8")
    main_js = root / Path(_PLUGIN_MAIN_REL)
    main_js.parent.mkdir(parents=True, exist_ok=True)
    main_js.write_text(f"// {constants.SETTINGS_PORT_KEY}\n", encoding="utf-8")
    community = root / Path(constants.COMMUNITY_PLUGINS_REL)
    community.parent.mkdir(parents=True, exist_ok=True)
    community.write_text(json.dumps([constants.PLUGIN_ID, "dataview"]), encoding="utf-8")
    return root


def _registry(path: Path, mapping: dict[str, str]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"vaults": {k: {"path": v, "ts": 1, "open": True} for k, v in mapping.items()}}),
        encoding="utf-8",
    )
    return path


def test_both_roles_resolve_when_registry_uses_posix_separators(tmp_path: Path) -> None:
    base = tmp_path / "My Vault Collection"
    vault_a = _build_vault(base / "Team Vault")
    vault_b = _build_vault(base / "Team Vault - Kopie")

    registry = _registry(
        tmp_path / "roaming" / "obsidian" / "obsidian.json",
        {
            "9f00000000000011": vault_a.as_posix(),
            "9f00000000000022": vault_b.as_posix(),
        },
    )

    result = vaults.discover_instances(
        vault_paths={constants.ROLE_A: str(vault_a), constants.ROLE_B: str(vault_b)},
        registry_path=registry,
    )

    instance_a = result.instances[constants.ROLE_A]
    instance_b = result.instances[constants.ROLE_B]

    assert instance_a.registry_id == "9f00000000000011"
    assert instance_b.registry_id == "9f00000000000022"
    assert instance_a.registry_id != instance_b.registry_id
    assert constants.VAULT_NOT_IN_REGISTRY not in _failure_names(instance_a)
    assert constants.VAULT_NOT_IN_REGISTRY not in _failure_names(instance_b)
    assert _canonical(instance_a.resolved_path) == _canonical(vault_a)
    assert _canonical(instance_b.resolved_path) == _canonical(vault_b)
    assert instance_b.vault_name == "Team Vault - Kopie"
