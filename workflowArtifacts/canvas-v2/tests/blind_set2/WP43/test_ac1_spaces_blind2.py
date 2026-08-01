"""WP43 / AC1 (blind 2) — a space-bearing name that is a prefix of another entry must not
be resolved by prefix matching.

Angle of attack: two registry entries where one recorded path is a strict prefix of the other
("Vault One" vs "Vault One Extra"). Space handling must not degrade into a startswith() match,
and a name that is merely a prefix of a real entry must not resolve at all.

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


def _same(a, b) -> bool:
    return os.path.normcase(os.path.normpath(os.path.abspath(str(a)))) == os.path.normcase(
        os.path.normpath(os.path.abspath(str(b)))
    )


def _vault(root: Path) -> Path:
    (root / "Inbox").mkdir(parents=True, exist_ok=True)
    (root / "Inbox" / "capture.md").write_text("fixture\n", encoding="utf-8")
    main_js = root / Path(_MAIN_REL)
    main_js.parent.mkdir(parents=True, exist_ok=True)
    main_js.write_text(f"/*{constants.SETTINGS_PORT_KEY}*/", encoding="utf-8")
    plugins = root / Path(constants.COMMUNITY_PLUGINS_REL)
    plugins.parent.mkdir(parents=True, exist_ok=True)
    plugins.write_text(json.dumps([constants.PLUGIN_ID]), encoding="utf-8")
    return root


def _registry_file(path: Path, mapping: dict[str, str]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"vaults": {k: {"path": v, "ts": 7, "open": False} for k, v in mapping.items()}}),
        encoding="utf-8",
    )
    return path


def test_prefix_sharing_space_names_resolve_to_their_own_entries(tmp_path: Path) -> None:
    short_vault = _vault(tmp_path / "store" / "Vault One")
    long_vault = _vault(tmp_path / "store" / "Vault One Extra")

    registry = _registry_file(
        tmp_path / "cfg" / "obsidian.json",
        {"00000000000000aa": str(short_vault), "00000000000000bb": str(long_vault)},
    )

    short_resolution = vaults.resolve_vault(str(short_vault), registry_path=registry)
    long_resolution = vaults.resolve_vault(str(long_vault), registry_path=registry)

    assert short_resolution.registry_id == "00000000000000aa"
    assert long_resolution.registry_id == "00000000000000bb"
    assert _same(short_resolution.resolved_path, short_vault)
    assert _same(long_resolution.resolved_path, long_vault)
    assert short_resolution.vault_name == "Vault One"
    assert long_resolution.vault_name == "Vault One Extra"


def test_partial_name_that_is_only_a_prefix_does_not_resolve(tmp_path: Path) -> None:
    real_vault = _vault(tmp_path / "store" / "Vault One Extra")
    registry = _registry_file(tmp_path / "cfg" / "obsidian.json", {"00000000000000bb": str(real_vault)})

    truncated = str(tmp_path / "store" / "Vault One")
    resolution = vaults.resolve_vault(truncated, registry_path=registry)

    assert resolution.ok is False
    assert resolution.failure == constants.VAULT_NOT_IN_REGISTRY
    assert resolution.registry_id is None
