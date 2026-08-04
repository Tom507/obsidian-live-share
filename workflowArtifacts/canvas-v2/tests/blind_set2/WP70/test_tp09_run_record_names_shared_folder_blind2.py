# WP70 / AC2 — blind counterpart 2 for "the run record states positively which folder is
# shared in BOTH vaults".
#
# Different angle: the record must be a POSITIVE STATEMENT, not an inference. C50 AC5 is
# the independent detector and "satisfying it must require the instances' own view of
# what they share — never a read-back of the file this criterion wrote". So the record is
# built from the provisioning records alone, and a doctored record that disagrees with
# the pinned surface is refused rather than reported.
#
# DATA SAFETY: the records here are constructed with `dataclasses.replace` from one real
# provisioning against a synthetic fixture vault under tmp_path.

from __future__ import annotations

import json
import sys
from dataclasses import replace
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

RUN_ID = "20260804T080808Z-14-99aabb"


def silent_control_probe(port: int) -> bool:
    return False


def make_room() -> relay.RelayRoom:
    return relay.RelayRoom(
        id="4e4e4e4e-5f5f-6060-7171-82829393a4a4",
        token="SENTINEL-BLIND2-TOKEN",
        name=f"{constants.RELAY_ROOM_NAME_PREFIX}{RUN_ID}",
        base_url=constants.RELAY_BASE_URL,
    )


@pytest.fixture()
def pair(tmp_path: Path) -> list:
    room = make_room()
    out = []
    for name, role in (("v-a", constants.ROLE_A), ("v-b - Kopie", constants.ROLE_B)):
        vault = (tmp_path / name).resolve()
        for owner in OWNER_VAULTS:
            assert vault != Path(owner).resolve()
            assert Path(owner).resolve() not in vault.parents
        (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
        (vault / constants.PLUGIN_DATA_REL).write_bytes(b"{}\n")
        out.append(
            provisioning.provision_gate_settings(
                vault, role, room=room, run_id=RUN_ID, control_probe=silent_control_probe
            )
        )
    return out


def test_an_empty_shared_folder_in_one_record_is_refused(pair: list) -> None:
    doctored = [pair[0], replace(pair[1], shared_folder="")]
    with pytest.raises(provisioning.SharedSurfaceNotEstablished) as excinfo:
        provisioning.shared_surface_record(doctored)
    assert excinfo.value.reason == constants.SHARED_SURFACE_NOT_ESTABLISHED


def test_a_non_empty_exclude_pattern_list_in_one_record_is_refused(pair: list) -> None:
    doctored = [replace(pair[0], exclude_patterns=("Privat/**",)), pair[1]]
    with pytest.raises(provisioning.SharedSurfaceNotEstablished):
        provisioning.shared_surface_record(doctored)


def test_two_records_for_the_same_role_are_refused(pair: list) -> None:
    with pytest.raises(provisioning.SharedSurfaceNotEstablished):
        provisioning.shared_surface_record([pair[0], replace(pair[1], role=constants.ROLE_A)])


def test_the_record_states_the_folder_rather_than_a_verdict(pair: list) -> None:
    record = provisioning.shared_surface_record(pair)
    blob = json.dumps(record)
    assert constants.SCRATCH_FOLDER in blob
    assert record["sharedFolder"] == constants.SCRATCH_FOLDER
    # The record is about configuration; it must not claim anything was observed.
    assert "observed" not in blob and "propagat" not in blob.lower()


def test_the_record_carries_both_vault_paths_and_no_token(pair: list) -> None:
    record = provisioning.shared_surface_record(pair)
    blob = json.dumps(record)
    assert "SENTINEL-BLIND2-TOKEN" not in blob
    assert len({entry["vaultPath"] for entry in record["vaults"]}) == 2
