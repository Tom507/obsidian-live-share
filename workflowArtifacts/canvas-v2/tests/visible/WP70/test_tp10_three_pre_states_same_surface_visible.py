# WP70 / AC2 — "The two vaults' stored values have never been read and the rig must not
# assume they agree, are empty, or are equal to each other; it establishes the state and
# records what it established."
#
# Three assumptions are named in that sentence, so three pre-states are exercised, and
# all three must land the SAME narrowed surface: empty in both, differing non-empty, and
# equal non-empty. An implementation that reads the current value and "merges" or
# "keeps the owner's if set" fails on the second and third.
#
#   ├── T1 empty in both vaults        -> both narrowed to the scratch folder
#   ├── T2 differing non-empty values  -> both narrowed to the scratch folder
#   ├── T3 equal non-empty values      -> both narrowed to the scratch folder
#   ├── T4 all three pre-states also land excludePatterns == []
#   ├── T5 the pre-state is genuinely different in each case (fixture audit)
#   └── T6 every pre-state restores byte-exactly, including the empty-string one
#
# DATA SAFETY: synthetic fixture vaults under tmp_path, guarded against both owner
# vaults. Sentinel credential values only.

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

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

from obsidian_e2e import constants, provisioning, relay  # noqa: E402


def silent_control_probe(port: int) -> bool:
    """No Obsidian instance is running in a unit test — and none may be started."""
    return False

OWNER_VAULTS = (
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga"),
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie"),
)

SENTINEL_ROOM_TOKEN = "SENTINEL-ROOM-TOKEN-c0ffee-DO-NOT-LEAK"
RUN_ID = "20260804T000000Z-1-a1b2c3"


def settings(shared: str, patterns: list) -> bytes:
    return (
        json.dumps(
            {"sharedFolder": shared, "excludePatterns": patterns, "clientId": "fixture"},
            indent=2,
        ).encode("utf-8")
        + b"\n"
    )


PRE_STATES = {
    # label: (vault A bytes, vault B bytes)
    "empty_in_both": (settings("", []), settings("", [])),
    "differing_non_empty": (
        settings("Projekte/Team", ["*.tmp"]),
        settings("Notizen/Geteilt", ["Archiv/**", "*.bak"]),
    ),
    "equal_non_empty": (
        settings("Gemeinsam", ["*.png"]),
        settings("Gemeinsam", ["*.png"]),
    ),
}


def assert_synthetic(path: Path) -> Path:
    resolved = Path(path).resolve()
    for owner in OWNER_VAULTS:
        owner_resolved = Path(owner).resolve()
        assert resolved != owner_resolved, f"ABORT: {resolved} is an owner vault"
        assert owner_resolved not in resolved.parents, f"ABORT: {resolved} is inside an owner vault"
        assert resolved not in owner_resolved.parents, f"ABORT: {resolved} contains an owner vault"
    return resolved


def make_vault(tmp_path: Path, name: str, data_json: bytes) -> Path:
    vault = assert_synthetic(tmp_path / name)
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(data_json)
    return vault


def make_room() -> relay.RelayRoom:
    return relay.RelayRoom(
        id="11111111-2222-3333-4444-555555555555",
        token=SENTINEL_ROOM_TOKEN,
        name=f"{constants.RELAY_ROOM_NAME_PREFIX}{RUN_ID}",
        base_url=constants.RELAY_BASE_URL,
    )


def provision_pair(tmp_path: Path, label: str) -> dict:
    raw_a, raw_b = PRE_STATES[label]
    room = make_room()
    vault_a = make_vault(tmp_path, f"{label}-a", raw_a)
    vault_b = make_vault(tmp_path, f"{label}-b - Kopie", raw_b)
    provisioning.provision_gate_settings(vault_a, constants.ROLE_A, room=room, run_id=RUN_ID, control_probe=silent_control_probe)
    provisioning.provision_gate_settings(vault_b, constants.ROLE_B, room=room, run_id=RUN_ID, control_probe=silent_control_probe)
    return {
        constants.ROLE_A: (vault_a, raw_a),
        constants.ROLE_B: (vault_b, raw_b),
    }


def read_settings(vault: Path) -> dict:
    return json.loads((vault / constants.PLUGIN_DATA_REL).read_bytes().decode("utf-8-sig"))


@pytest.mark.parametrize("label", sorted(PRE_STATES))
def test_every_pre_state_lands_the_same_narrowed_shared_folder(
    tmp_path: Path, label: str
) -> None:
    pair = provision_pair(tmp_path, label)
    for vault, _raw in pair.values():
        assert read_settings(vault)["sharedFolder"] == constants.SCRATCH_FOLDER


@pytest.mark.parametrize("label", sorted(PRE_STATES))
def test_every_pre_state_lands_an_empty_exclude_pattern_list(
    tmp_path: Path, label: str
) -> None:
    pair = provision_pair(tmp_path, label)
    for vault, _raw in pair.values():
        assert read_settings(vault)["excludePatterns"] == []


def test_fixture_audit_the_three_pre_states_are_genuinely_different() -> None:
    empty_a, empty_b = PRE_STATES["empty_in_both"]
    diff_a, diff_b = PRE_STATES["differing_non_empty"]
    equal_a, equal_b = PRE_STATES["equal_non_empty"]
    assert empty_a == empty_b
    assert diff_a != diff_b
    assert equal_a == equal_b
    assert json.loads(empty_a)["sharedFolder"] == ""
    assert json.loads(equal_a)["sharedFolder"] != ""
    assert json.loads(diff_a)["sharedFolder"] != json.loads(diff_b)["sharedFolder"]


@pytest.mark.parametrize("label", sorted(PRE_STATES))
def test_every_pre_state_restores_byte_exactly(tmp_path: Path, label: str) -> None:
    pair = provision_pair(tmp_path, label)
    for vault, raw in pair.values():
        provisioning.restore_gate_settings(vault)
        assert (vault / constants.PLUGIN_DATA_REL).read_bytes() == raw


def test_the_two_vaults_agree_after_provisioning_even_when_they_disagreed_before(
    tmp_path: Path,
) -> None:
    pair = provision_pair(tmp_path, "differing_non_empty")
    a = read_settings(pair[constants.ROLE_A][0])
    b = read_settings(pair[constants.ROLE_B][0])
    assert a["sharedFolder"] == b["sharedFolder"] == constants.SCRATCH_FOLDER
    assert a["roomId"] == b["roomId"]
    assert a["serverUrl"] == b["serverUrl"]
    # The roles must NOT agree — one host, one guest.
    assert a["role"] == constants.SETTINGS_ROLE_HOST
    assert b["role"] == constants.SETTINGS_ROLE_GUEST
