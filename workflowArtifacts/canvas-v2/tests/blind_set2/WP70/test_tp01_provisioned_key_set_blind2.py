# WP70 / AC1 — blind counterpart 2 for "the provisioned key set is exactly the ten pinned
# keys, in the pinned order, and no key is invented".
#
# Different angle: the owner's file ALREADY carries five of the ten pinned keys, with
# their own values and in a scrambled order. An implementation that appends only the
# missing ones would leave the pinned order unsatisfied; one that rewrites the document
# would break AC1's byte clause. The vault also has a decoy key whose name contains a
# pinned key as a substring.
#
# DATA SAFETY: synthetic fixture vault under tmp_path, guarded against both owner vaults.

from __future__ import annotations

import json
import sys
from pathlib import Path

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

PREPOPULATED = (
    b"{\n"
    b'  "autoReconnect": false,\n'
    b'  "roleDescription": "not a pinned key",\n'
    b'  "permission": "read-only",\n'
    b'  "serverUrl": "https://liveshare.example.invalid",\n'
    b'  "excludePatterns": ["Privat/**"],\n'
    b'  "roomId": "an-old-room",\n'
    b'  "clientId": "fixture-prepopulated"\n'
    b"}\n"
)
DECOYS = ("roleDescription", "clientId")


def silent_control_probe(port: int) -> bool:
    return False


def assert_synthetic(path: Path) -> Path:
    resolved = Path(path).resolve()
    for owner in OWNER_VAULTS:
        owner_resolved = Path(owner).resolve()
        assert resolved != owner_resolved, f"ABORT: {resolved} is an owner vault"
        assert owner_resolved not in resolved.parents, f"ABORT: {resolved} is inside an owner vault"
        assert resolved not in owner_resolved.parents, f"ABORT: {resolved} contains an owner vault"
    return resolved


def make_vault(tmp_path: Path, name: str) -> Path:
    vault = assert_synthetic(tmp_path / name)
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(PREPOPULATED)
    return vault


def make_room() -> relay.RelayRoom:
    return relay.RelayRoom(
        id="99998888-7777-6666-5555-444433332222",
        token="SENTINEL-BLIND2-TOKEN",
        name=f"{constants.RELAY_ROOM_NAME_PREFIX}20260804T202020Z-7-001122",
        base_url=constants.RELAY_BASE_URL,
    )


def provisioned(tmp_path: Path, name: str, role: str) -> dict:
    vault = make_vault(tmp_path, name)
    provisioning.provision_gate_settings(
        vault, role, room=make_room(), control_probe=silent_control_probe
    )
    return json.loads((vault / constants.PLUGIN_DATA_REL).read_bytes().decode("utf-8-sig"))


def test_pre_existing_pinned_keys_are_overwritten_not_duplicated(tmp_path: Path) -> None:
    parsed = provisioned(tmp_path, "prepop-a", constants.ROLE_A)
    assert parsed["autoReconnect"] is constants.SETTINGS_AUTO_RECONNECT
    assert parsed["permission"] == constants.SETTINGS_PERMISSION
    assert parsed["excludePatterns"] == []
    assert parsed["roomId"] == make_room().id
    assert parsed["serverUrl"] == constants.RELAY_BASE_URL


def test_the_written_set_is_still_exactly_ten_pinned_keys(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "prepop-count")
    before = set(json.loads(PREPOPULATED.decode("utf-8")))
    provisioning.provision_gate_settings(
        vault, constants.ROLE_B, room=make_room(), control_probe=silent_control_probe
    )
    after = set(json.loads((vault / constants.PLUGIN_DATA_REL).read_bytes().decode("utf-8-sig")))
    assert after - before == set(constants.PROVISIONED_SETTINGS_KEYS) - before
    assert after - before - set(constants.PROVISIONED_SETTINGS_KEYS) == set()


def test_decoy_keys_are_untouched(tmp_path: Path) -> None:
    parsed = provisioned(tmp_path, "prepop-decoy", constants.ROLE_A)
    assert parsed["roleDescription"] == "not a pinned key"
    assert parsed["clientId"] == "fixture-prepopulated"
    for decoy in DECOYS:
        assert decoy not in constants.PROVISIONED_SETTINGS_KEYS


def test_a_duplicate_provisioning_does_not_grow_the_key_set(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "prepop-twice")
    for _ in range(3):
        provisioning.provision_gate_settings(
            vault, constants.ROLE_A, room=make_room(), control_probe=silent_control_probe
        )
    raw = (vault / constants.PLUGIN_DATA_REL).read_bytes().decode("utf-8-sig")
    for key in constants.PROVISIONED_SETTINGS_KEYS:
        assert raw.count(f'"{key}"') == 1, f"{key} was spliced more than once"
