"""WP43 / AC3 (blind 2) — the liveness answer does not depend on which vaults were configured.

Angle of attack: two calls with the *same* process listing but different role sets. If liveness
were derived per vault, discovering only role a while the sole listed process names vault b would
flip the answer. It must not — and the empty-listing case must report False without any per-vault
process record appearing anywhere.

Data safety: fixtures only, under pytest's ``tmp_path``; the process listing is injected.
"""

from __future__ import annotations

import dataclasses
import json
import re
import sys
from pathlib import Path

_TOOLS = Path(__file__).resolve().parents[5] / "tools"
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, vaults  # noqa: E402

_MAIN = getattr(constants, "PLUGIN_MAIN_REL", constants.PLUGIN_DIR_REL + "/main.js")
_EXE = (
    getattr(constants, "OBSIDIAN_EXE_PATH", None)
    or getattr(constants, "OBSIDIAN_EXE", None)
    or getattr(constants, "OBSIDIAN_EXECUTABLE", None)
)


def _mapping(obj) -> dict:
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        return dataclasses.asdict(obj)
    if hasattr(obj, "_asdict"):
        return dict(obj._asdict())
    if isinstance(obj, dict):
        return dict(obj)
    own = getattr(obj, "__dict__", None)
    if own:
        return {k: v for k, v in own.items() if not k.startswith("_")}
    return {
        n: getattr(obj, n) for n in dir(obj) if not n.startswith("_") and not callable(getattr(obj, n))
    }


def _vault(root: Path) -> Path:
    (root / "Docs").mkdir(parents=True, exist_ok=True)
    (root / "Docs" / "d.md").write_text("fixture\n", encoding="utf-8")
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


def test_liveness_is_independent_of_the_configured_role_set(tmp_path: Path) -> None:
    assert _EXE, "constants.py must pin the Obsidian executable path"

    vault_a = _vault(tmp_path / "vaults" / "RoleAFixture")
    vault_b = _vault(tmp_path / "vaults" / "RoleBFixture")
    registry = _registry(
        tmp_path / "cfg" / "obsidian.json",
        {"cc00000000000001": str(vault_a), "cc00000000000002": str(vault_b)},
    )

    listing = [{"pid": 5150, "name": Path(str(_EXE)).name, "cmdline": f'"{_EXE}" "{vault_b}"'}]

    both = vaults.discover_instances(
        vault_paths={constants.ROLE_A: str(vault_a), constants.ROLE_B: str(vault_b)},
        registry_path=registry,
        process_lister=lambda: list(listing),
    )
    only_a = vaults.discover_instances(
        vault_paths={constants.ROLE_A: str(vault_a)},
        registry_path=registry,
        process_lister=lambda: list(listing),
    )

    assert both.obsidian_running is True
    assert only_a.obsidian_running is both.obsidian_running


def test_empty_listing_reports_not_running_without_per_vault_process_records(tmp_path: Path) -> None:
    vault_a = _vault(tmp_path / "vaults" / "QuietA")
    vault_b = _vault(tmp_path / "vaults" / "Quiet B")
    registry = _registry(
        tmp_path / "cfg" / "obsidian.json",
        {"cc00000000000003": str(vault_a), "cc00000000000004": str(vault_b)},
    )

    result = vaults.discover_instances(
        vault_paths={constants.ROLE_A: str(vault_a), constants.ROLE_B: str(vault_b)},
        registry_path=registry,
        process_lister=lambda: [],
    )

    assert result.obsidian_running is False
    for role in (constants.ROLE_A, constants.ROLE_B):
        blob = _mapping(result.instances[role])
        assert not [k for k in blob if re.search(r"pid|process|window", str(k), re.IGNORECASE)]
        for value in blob.values():
            # no nested process record may be carried on a per-vault descriptor
            assert not (isinstance(value, dict) and {"pid", "cmdline"} & set(value))
            if isinstance(value, (list, tuple)):
                assert not [
                    item for item in value if isinstance(item, dict) and {"pid", "cmdline"} & set(item)
                ]
