"""WP43 / AC1 (visible) — a configured vault absent from the registry produces an explicit named
failure, not a fallback guess.

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


def _make_vault(root: Path) -> Path:
    (root / "Notes").mkdir(parents=True, exist_ok=True)
    (root / "Notes" / "n.md").write_text("# fixture\n", encoding="utf-8")
    main_js = root / Path(PLUGIN_MAIN_REL)
    main_js.parent.mkdir(parents=True, exist_ok=True)
    main_js.write_text(f"/* {constants.SETTINGS_PORT_KEY} */\n", encoding="utf-8")
    community = root / Path(constants.COMMUNITY_PLUGINS_REL)
    community.parent.mkdir(parents=True, exist_ok=True)
    community.write_text(json.dumps([constants.PLUGIN_ID]), encoding="utf-8")
    return root


def _write_registry(path: Path, entries: dict[str, str]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"vaults": {k: {"path": v, "ts": 99} for k, v in entries.items()}}), encoding="utf-8"
    )
    return path


def test_vault_absent_from_registry_fails_by_name_without_guessing(tmp_path: Path) -> None:
    known_one = _make_vault(tmp_path / "vaults" / "KnownOne")
    known_two = _make_vault(tmp_path / "vaults" / "KnownTwo")
    unregistered = _make_vault(tmp_path / "vaults" / "Unregistered")

    registry = _write_registry(
        tmp_path / "appdata" / "obsidian.json",
        {"7777000000000001": str(known_one), "7777000000000002": str(known_two)},
    )

    resolution = vaults.resolve_vault(str(unregistered), registry_path=registry)

    assert resolution.ok is False
    assert resolution.failure == constants.VAULT_NOT_IN_REGISTRY
    # No fallback guess: nothing from the registry may be attributed to it.
    assert resolution.registry_id is None
    assert resolution.vault_name is None
    assert resolution.resolved_path is None
