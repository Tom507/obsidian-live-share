"""WP43 / AC2 (blind 1) — three plugin situations must produce three pairwise-distinct reports,
and no cheap normalisation may collapse the two "not usable" ones into one.

Angle of attack: three fixtures (enabled / installed-but-not-listed / not installed) probed in two
discovery calls, plus a normalisation-collapse check (casefold, underscore stripping, prefix
truncation) on the two named states.

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


def _vault(root: Path, *, install: bool, listed: list[str]) -> Path:
    (root / "Ideas").mkdir(parents=True, exist_ok=True)
    (root / "Ideas" / "i.md").write_text("fixture\n", encoding="utf-8")
    if install:
        main_js = root / Path(_MAIN_REL)
        main_js.parent.mkdir(parents=True, exist_ok=True)
        main_js.write_text(f"//{constants.SETTINGS_PORT_KEY}\n", encoding="utf-8")
    community = root / Path(constants.COMMUNITY_PLUGINS_REL)
    community.parent.mkdir(parents=True, exist_ok=True)
    community.write_text(json.dumps(listed), encoding="utf-8")
    return root


def _registry(path: Path, mapping: dict[str, str]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"vaults": {k: {"path": v} for k, v in mapping.items()}}), encoding="utf-8")
    return path


def test_three_situations_produce_three_distinct_reports(tmp_path: Path) -> None:
    good = _vault(tmp_path / "v" / "Good", install=True, listed=[constants.PLUGIN_ID, "dataview"])
    dormant = _vault(tmp_path / "v" / "Dormant", install=True, listed=["dataview"])
    empty = _vault(tmp_path / "v" / "Empty", install=False, listed=["dataview"])

    registry = _registry(
        tmp_path / "appdata" / "obsidian.json",
        {"f0000000000000a1": str(good), "f0000000000000a2": str(dormant), "f0000000000000a3": str(empty)},
    )

    first = vaults.discover_instances(
        vault_paths={constants.ROLE_A: str(good), constants.ROLE_B: str(dormant)},
        registry_path=registry,
    )
    second = vaults.discover_instances(
        vault_paths={constants.ROLE_A: str(dormant), constants.ROLE_B: str(empty)},
        registry_path=registry,
    )

    good_state = first.instances[constants.ROLE_A].plugin_state
    dormant_state = first.instances[constants.ROLE_B].plugin_state
    empty_state = second.instances[constants.ROLE_B].plugin_state

    assert second.instances[constants.ROLE_A].plugin_state == dormant_state
    assert dormant_state == constants.PLUGIN_PRESENT_BUT_DISABLED
    assert empty_state == constants.PLUGIN_MISSING
    assert len({good_state, dormant_state, empty_state}) == 3


def test_no_normalisation_collapses_the_two_named_states() -> None:
    a = constants.PLUGIN_PRESENT_BUT_DISABLED
    b = constants.PLUGIN_MISSING
    assert a != b
    assert a.casefold() != b.casefold()
    assert a.replace("_", "") != b.replace("_", "")
    assert a.strip().lower().rstrip("s") != b.strip().lower().rstrip("s")
