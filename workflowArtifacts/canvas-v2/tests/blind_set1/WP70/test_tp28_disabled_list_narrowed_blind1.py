# WP70 / obsidian-git precondition — blind counterpart 1 for "after disabling, the
# enabled list no longer contains obsidian-git and still contains live-share, and no
# other entry moved".
#
# Different data: `obsidian-git` at the FIRST, LAST and both positions of the list, plus a
# list where it appears twice. Position is where an implementation that pops by index, or
# that removes only the first match, gets it wrong.
#
# DATA SAFETY: synthetic fixture vaults under tmp_path, guarded against both owner vaults.

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

# --- repo bootstrap (T3_SharedContract §0.2) --------------------------------------
for _parent in Path(__file__).resolve().parents:
    if (_parent / "tools").is_dir() and (_parent / "plugin").is_dir():
        _TOOLS = _parent / "tools"
        break
else:  # pragma: no cover
    raise RuntimeError(f"obsidian-live-share repo root not found from {__file__}")
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, provisioning  # noqa: E402

OWNER_VAULTS = (
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga"),
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie"),
)

RUN_ID = "20260803T055959Z-41-556677"
GIT = "obsidian-git"

LISTS = {
    "first": [GIT, "dataview", "live-share"],
    "last": ["dataview", "live-share", GIT],
    "middle": ["dataview", GIT, "live-share"],
    "twice": [GIT, "dataview", GIT, "live-share"],
    "only_other_plugins": ["dataview", "live-share", "templater-obsidian"],
}


def assert_synthetic(path: Path) -> Path:
    resolved = Path(path).resolve()
    for owner in OWNER_VAULTS:
        owner_resolved = Path(owner).resolve()
        assert resolved != owner_resolved, f"ABORT: {resolved} is an owner vault"
        assert owner_resolved not in resolved.parents, f"ABORT: {resolved} is inside an owner vault"
        assert resolved not in owner_resolved.parents, f"ABORT: {resolved} contains an owner vault"
    return resolved


def make_vault(tmp_path: Path, label: str) -> Path:
    vault = assert_synthetic(tmp_path / f"vault-{label}")
    (vault / ".obsidian").mkdir(parents=True, exist_ok=True)
    (vault / constants.COMMUNITY_PLUGINS_REL).write_bytes(
        json.dumps(LISTS[label], indent=2).encode("utf-8") + b"\n"
    )
    return vault


def enabled(vault: Path) -> list:
    return json.loads((vault / constants.COMMUNITY_PLUGINS_REL).read_bytes().decode("utf-8-sig"))


@pytest.mark.parametrize("label", sorted(LISTS))
def test_obsidian_git_is_gone_from_every_position(tmp_path: Path, label: str) -> None:
    vault = make_vault(tmp_path, label)
    provisioning.disable_community_plugins(vault, constants.ROLE_A, run_id=RUN_ID)
    assert GIT not in enabled(vault)


@pytest.mark.parametrize("label", sorted(LISTS))
def test_every_other_entry_survives_in_order(tmp_path: Path, label: str) -> None:
    vault = make_vault(tmp_path, label)
    provisioning.disable_community_plugins(vault, constants.ROLE_B, run_id=RUN_ID)
    assert enabled(vault) == [name for name in LISTS[label] if name != GIT]


@pytest.mark.parametrize("label", sorted(LISTS))
def test_live_share_is_still_enabled_where_it_was(tmp_path: Path, label: str) -> None:
    if constants.PLUGIN_ID not in LISTS[label]:
        pytest.skip("this fixture has no live-share entry")
    vault = make_vault(tmp_path, label)
    provisioning.disable_community_plugins(vault, constants.ROLE_A, run_id=RUN_ID)
    assert constants.PLUGIN_ID in enabled(vault)


def test_a_duplicated_entry_is_removed_entirely(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "twice")
    provisioning.disable_community_plugins(vault, constants.ROLE_A, run_id=RUN_ID)
    after = enabled(vault)
    assert after.count(GIT) == 0
    assert after == ["dataview", "live-share"]


@pytest.mark.parametrize("label", sorted(LISTS))
def test_every_list_restores_byte_exactly(tmp_path: Path, label: str) -> None:
    vault = make_vault(tmp_path, label)
    original = (vault / constants.COMMUNITY_PLUGINS_REL).read_bytes()
    provisioning.disable_community_plugins(vault, constants.ROLE_A, run_id=RUN_ID)
    provisioning.restore_community_plugins(vault)
    assert (vault / constants.COMMUNITY_PLUGINS_REL).read_bytes() == original
