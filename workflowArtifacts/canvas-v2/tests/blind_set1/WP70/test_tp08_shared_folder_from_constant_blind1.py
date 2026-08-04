# WP70 / AC2 — blind counterpart 1 for "`sharedFolder` is provisioned to the rig-owned
# scratch folder CONSTANT (not a re-spelled literal) and `excludePatterns` to an empty
# list".
#
# Different angle: the constant is chased through the member builder rather than through
# a file. `gate_settings_members` must take its value from `constants.SETTINGS_SHARED_FOLDER`
# and hand back a FRESH mutable list for `excludePatterns` — a caller that mutates the
# returned list must not be able to reach back into the pinned constants.
#
# DATA SAFETY: no vault is touched by most of these; the one that is, is under tmp_path.

from __future__ import annotations

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

from obsidian_e2e import constants, provisioning, relay  # noqa: E402

OWNER_VAULTS = (
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga"),
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie"),
)

RUN_IDS = (
    "20260804T000000Z-1-000000",
    "20260804T235959Z-65535-ffffff",
    "20991231T115959Z-7-0a0b0c",
)


def silent_control_probe(port: int) -> bool:
    return False


def make_room() -> relay.RelayRoom:
    return relay.RelayRoom(
        id="2b2b2b2b-3c3c-4d4d-5e5e-6f6f70708181",
        token="SENTINEL-BLIND1-TOKEN",
        name=f"{constants.RELAY_ROOM_NAME_PREFIX}{RUN_IDS[0]}",
        base_url=constants.RELAY_BASE_URL,
    )


@pytest.mark.parametrize("role", constants.ROLES)
def test_the_member_builder_takes_the_folder_from_the_constant(role: str) -> None:
    members = provisioning.gate_settings_members(role=role, room=make_room())
    assert members["sharedFolder"] == constants.SETTINGS_SHARED_FOLDER
    assert members["sharedFolder"] == constants.SCRATCH_FOLDER


def test_the_exclude_pattern_list_is_a_fresh_mutable_list_each_time() -> None:
    first = provisioning.gate_settings_members(role=constants.ROLE_A, room=make_room())
    second = provisioning.gate_settings_members(role=constants.ROLE_A, room=make_room())
    assert first["excludePatterns"] == [] == second["excludePatterns"]
    assert first["excludePatterns"] is not second["excludePatterns"]

    first["excludePatterns"].append("Privat/**")
    assert second["excludePatterns"] == []
    assert constants.SETTINGS_EXCLUDE_PATTERNS == ()


@pytest.mark.parametrize("run_id", RUN_IDS)
def test_every_run_ids_scratch_canvas_lives_inside_the_pinned_folder(run_id: str) -> None:
    scratch = constants.scratch_rel_path(run_id)
    assert scratch.startswith(constants.SETTINGS_SHARED_FOLDER + "/")
    assert scratch.endswith(constants.SCRATCH_EXT)
    assert run_id in scratch


def test_the_pinned_folder_is_not_a_vault_wide_surface() -> None:
    # `isSharedPath` returns True for EVERY path when sharedFolder is empty. Any of
    # these values would re-open the blast radius AC2 exists to close.
    assert constants.SETTINGS_SHARED_FOLDER not in ("", "/", ".", "./", "**", "*")
    assert not constants.SETTINGS_SHARED_FOLDER.endswith("/")
    assert not constants.SETTINGS_SHARED_FOLDER.startswith("/")


def test_a_provisioned_vault_agrees_with_the_member_builder(tmp_path: Path) -> None:
    import json

    vault = (tmp_path / "vault-agree").resolve()
    for owner in OWNER_VAULTS:
        assert vault != Path(owner).resolve()
        assert Path(owner).resolve() not in vault.parents
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(b'{"sharedFolder": "Alles"}\n')

    record = provisioning.provision_gate_settings(
        vault, constants.ROLE_B, room=make_room(), control_probe=silent_control_probe
    )
    parsed = json.loads((vault / constants.PLUGIN_DATA_REL).read_bytes().decode("utf-8"))
    assert parsed["sharedFolder"] == record.shared_folder == constants.SCRATCH_FOLDER
    assert parsed["excludePatterns"] == []
