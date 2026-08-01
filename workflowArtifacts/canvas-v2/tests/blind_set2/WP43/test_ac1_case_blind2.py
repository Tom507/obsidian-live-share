"""WP43 / AC1 (blind 2) — case differences in an intermediate path component resolve, and the
reported identity keeps the registry's casing rather than the caller's.

Angle of attack: only the *parent* directory and the leaf are re-cased in the caller's input,
and the assertion is about identity leakage (``vault_name``) rather than about the match itself.

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


def _vault(root: Path) -> Path:
    (root / "Sources").mkdir(parents=True, exist_ok=True)
    (root / "Sources" / "ref.md").write_text("fixture\n", encoding="utf-8")
    main_js = root / Path(_MAIN)
    main_js.parent.mkdir(parents=True, exist_ok=True)
    main_js.write_text(f"/*{constants.SETTINGS_PORT_KEY}*/", encoding="utf-8")
    community = root / Path(constants.COMMUNITY_PLUGINS_REL)
    community.parent.mkdir(parents=True, exist_ok=True)
    community.write_text(json.dumps([constants.PLUGIN_ID]), encoding="utf-8")
    return root


def _registry(path: Path, mapping: dict[str, str]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"vaults": {k: {"path": v} for k, v in mapping.items()}}), encoding="utf-8")
    return path


def test_intermediate_component_case_resolves_and_identity_uses_registry_casing(tmp_path: Path) -> None:
    parent = tmp_path / "VaultParent"
    vault = _vault(parent / "MixedCaseVault")
    registry = _registry(tmp_path / "cfg" / "obsidian.json", {"beef000000000009": str(vault)})

    recased = os.path.join(str(tmp_path), "VAULTPARENT", "mixedcasevault")
    assert recased != str(vault)

    resolution = vaults.resolve_vault(recased, registry_path=registry)

    assert resolution.ok is True
    assert resolution.registry_id == "beef000000000009"
    # Identity must come from the registry entry, never from the caller's spelling.
    assert resolution.vault_name == "MixedCaseVault"
    assert Path(str(resolution.resolved_path)).name == "MixedCaseVault"
