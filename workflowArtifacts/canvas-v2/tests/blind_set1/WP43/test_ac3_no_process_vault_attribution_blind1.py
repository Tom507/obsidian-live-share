"""WP43 / AC3 (blind 1) — a listing that names only one vault must not downgrade the other role.

Angle of attack: asymmetric temptation. Exactly one fake Obsidian process exists and its command
line quotes vault B only. If the module attributed processes to vaults, role a would come back
marked as "not running" or degraded. It must not: liveness is a single host-level fact and both
descriptors must remain structurally identical in shape.

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

_MAIN_REL = getattr(constants, "PLUGIN_MAIN_REL", constants.PLUGIN_DIR_REL + "/main.js")
_EXE = (
    getattr(constants, "OBSIDIAN_EXE_PATH", None)
    or getattr(constants, "OBSIDIAN_EXE", None)
    or getattr(constants, "OBSIDIAN_EXECUTABLE", None)
)


def _as_mapping(obj) -> dict:
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
    (root / "Sync").mkdir(parents=True, exist_ok=True)
    (root / "Sync" / "s.md").write_text("fixture\n", encoding="utf-8")
    main_js = root / Path(_MAIN_REL)
    main_js.parent.mkdir(parents=True, exist_ok=True)
    main_js.write_text(f"//{constants.SETTINGS_PORT_KEY}\n", encoding="utf-8")
    community = root / Path(constants.COMMUNITY_PLUGINS_REL)
    community.parent.mkdir(parents=True, exist_ok=True)
    community.write_text(json.dumps([constants.PLUGIN_ID]), encoding="utf-8")
    return root


def test_single_process_naming_one_vault_does_not_degrade_the_other_role(tmp_path: Path) -> None:
    assert _EXE, "constants.py must pin the Obsidian executable path"

    vault_a = _vault(tmp_path / "store" / "Primary Fixture")
    vault_b = _vault(tmp_path / "store" / "Primary Fixture - Kopie")

    registry = tmp_path / "roaming" / "obsidian.json"
    registry.parent.mkdir(parents=True, exist_ok=True)
    registry.write_text(
        json.dumps(
            {
                "vaults": {
                    "1a2b000000000001": {"path": str(vault_a)},
                    "1a2b000000000002": {"path": str(vault_b)},
                }
            }
        ),
        encoding="utf-8",
    )

    only_b = [{"pid": 987654, "name": Path(str(_EXE)).name, "cmdline": f'"{_EXE}" --open "{vault_b}"'}]

    result = vaults.discover_instances(
        vault_paths={constants.ROLE_A: str(vault_a), constants.ROLE_B: str(vault_b)},
        registry_path=registry,
        process_lister=lambda: list(only_b),
    )

    assert result.obsidian_running is True

    blob_a = _as_mapping(result.instances[constants.ROLE_A])
    blob_b = _as_mapping(result.instances[constants.ROLE_B])

    # same shape for both roles: liveness is not a per-vault attribute
    assert set(blob_a) == set(blob_b)
    assert not [k for k in blob_a if re.search(r"pid|process|running|attached", str(k), re.IGNORECASE)]

    # role a keeps a fully resolved identity despite no process naming it
    assert result.instances[constants.ROLE_A].registry_id == "1a2b000000000001"
    assert constants.VAULT_NOT_IN_REGISTRY not in tuple(result.instances[constants.ROLE_A].failures)
    assert constants.VAULT_PATH_MISSING not in tuple(result.instances[constants.ROLE_A].failures)

    for blob in (blob_a, blob_b):
        assert "987654" not in json.dumps(blob, default=str)
