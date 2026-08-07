# WP70 / obsidian-git precondition — "after disabling, the enabled list no longer
# contains `obsidian-git` and still contains `live-share`, and no other entry moved."
#
# Three separate claims, and the third is the one that catches a lazy implementation:
# rewriting the list from a filtered set is easy, and it silently reorders or drops
# entries the rig knows nothing about. `community-plugins.json` is the owner's enabled
# list; the rig removes exactly one id from it and touches nothing else.
#
#   ├── T1 obsidian-git is gone from the enabled list
#   ├── T2 live-share is still in the enabled list — the gate needs it
#   ├── T3 every other entry survives, in its original relative order
#   ├── T4 a vault that does not have obsidian-git enabled is a clean no-op removal
#   ├── T5 removing is by exact id — a plugin whose id merely CONTAINS the name survives
#   └── T6 the record states what was disabled and what the list became
#
# DATA SAFETY: synthetic fixture vaults under tmp_path, guarded against both owner
# vaults.

from __future__ import annotations

import json
import sys
from pathlib import Path

# --- repo bootstrap (T3_SharedContract §0.2) --------------------------------------
for _parent in Path(__file__).resolve().parents:
    if (_parent / "tools").is_dir() and (_parent / "plugin").is_dir():
        _REPO = _parent
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

RUN_ID = "20260804T000000Z-1-a1b2c3"

MANY = [
    "dataview",
    "obsidian-git",
    "templater-obsidian",
    "live-share",
    "obsidian-excalidraw-plugin",
    "lan-vault-sync",
]


def assert_synthetic(path: Path) -> Path:
    resolved = Path(path).resolve()
    for owner in OWNER_VAULTS:
        owner_resolved = Path(owner).resolve()
        assert resolved != owner_resolved, f"ABORT: {resolved} is an owner vault"
        assert owner_resolved not in resolved.parents, f"ABORT: {resolved} is inside an owner vault"
        assert resolved not in owner_resolved.parents, f"ABORT: {resolved} contains an owner vault"
    return resolved


def make_vault(tmp_path: Path, name: str, enabled: list) -> Path:
    vault = assert_synthetic(tmp_path / name)
    (vault / ".obsidian").mkdir(parents=True, exist_ok=True)
    (vault / constants.COMMUNITY_PLUGINS_REL).write_bytes(
        json.dumps(enabled, indent=2).encode("utf-8") + b"\n"
    )
    return vault


def enabled_list(vault: Path) -> list:
    return json.loads((vault / constants.COMMUNITY_PLUGINS_REL).read_bytes().decode("utf-8-sig"))


def test_obsidian_git_is_gone_from_the_enabled_list(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-many", MANY)
    provisioning.disable_community_plugins(vault, constants.ROLE_A, run_id=RUN_ID)
    assert "obsidian-git" not in enabled_list(vault)
    assert constants.DISABLED_PLUGIN_IDS == ("obsidian-git",)


def test_live_share_is_still_in_the_enabled_list(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-liveshare", MANY)
    provisioning.disable_community_plugins(vault, constants.ROLE_A, run_id=RUN_ID)
    assert constants.PLUGIN_ID in enabled_list(vault)
    assert constants.PLUGIN_ID not in constants.DISABLED_PLUGIN_IDS


def test_every_other_entry_survives_in_its_original_relative_order(
    tmp_path: Path,
) -> None:
    vault = make_vault(tmp_path, "vault-order", MANY)
    provisioning.disable_community_plugins(vault, constants.ROLE_B, run_id=RUN_ID)

    after = enabled_list(vault)
    expected = [name for name in MANY if name != "obsidian-git"]
    assert after == expected, "an entry the rig does not own moved, vanished or appeared"
    assert len(after) == len(MANY) - 1


def test_a_vault_without_obsidian_git_enabled_is_a_clean_no_op_removal(
    tmp_path: Path,
) -> None:
    without = [name for name in MANY if name != "obsidian-git"]
    vault = make_vault(tmp_path, "vault-absent", without)
    record = provisioning.disable_community_plugins(vault, constants.ROLE_A, run_id=RUN_ID)

    assert enabled_list(vault) == without
    assert record.disabled == constants.DISABLED_PLUGIN_IDS
    assert list(record.enabled_after) == without
    # The borrow is still established, so the restore path is still exercised.
    provisioning.restore_community_plugins(vault)
    assert enabled_list(vault) == without


def test_removal_is_by_exact_id(tmp_path: Path) -> None:
    # A substring or prefix match would disable the owner's unrelated plugins.
    lookalikes = ["obsidian-git-sync", "my-obsidian-git", "obsidian-git", "live-share"]
    vault = make_vault(tmp_path, "vault-lookalike", lookalikes)
    provisioning.disable_community_plugins(vault, constants.ROLE_A, run_id=RUN_ID)

    assert enabled_list(vault) == ["obsidian-git-sync", "my-obsidian-git", "live-share"]


def test_the_record_states_what_was_disabled_and_what_the_list_became(
    tmp_path: Path,
) -> None:
    vault = make_vault(tmp_path, "vault-record", MANY)
    record = provisioning.disable_community_plugins(vault, constants.ROLE_A, run_id=RUN_ID)

    assert record.disabled == ("obsidian-git",)
    assert list(record.enabled_after) == [name for name in MANY if name != "obsidian-git"]
    assert record.role == constants.ROLE_A
    assert Path(record.vault_path).name == "vault-record"
