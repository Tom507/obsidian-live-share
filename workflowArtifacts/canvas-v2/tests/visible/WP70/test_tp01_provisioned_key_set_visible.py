# WP70 / AC1 — "the provisioned key set is pinned once in `constants.py` and is exactly:
# e2eControlPort, serverUrl, roomId, token, role, permission, sharedFolder,
# excludePatterns, autoReconnect, debugLogging — every one an existing member of
# LiveShareSettings, no key invented."
#
# The oracle is the ORDERED tuple in constants.py and the bytes on disk — never the
# rig's own bookkeeping. A provisioning that writes nine of ten keys, or an eleventh,
# or the right ten in the wrong order, fails here.
#
#   ├── T1 the pinned tuple itself is exactly the ten keys, in the pinned order
#   ├── T2 gate_settings_members() produces exactly that tuple, in that order
#   ├── T3 the provisioned FILE carries exactly those ten keys, in that order
#   ├── T4 no key outside the pinned set is invented into the file
#   ├── T5 the record states the key set it provisioned, and it is the pinned one
#   └── T6 the pinned set and the credential set are disjoint by construction
#
# DATA SAFETY: synthetic fixture vault under tmp_path, asserted not to be (or be inside)
# either owner vault before a byte is written. Credential values are sentinels only.

from __future__ import annotations

import json
import sys
from pathlib import Path

# --- repo bootstrap (T3_SharedContract §0.2) --------------------------------------
# `import tools.…` resolves to the WORKSPACE `tools` regular package and never to this
# repo's namespace portion. Put <repo>/tools on sys.path and import the globally unique
# top-level package name instead.
for _parent in Path(__file__).resolve().parents:
    if (_parent / "tools").is_dir() and (_parent / "plugin").is_dir():
        _REPO = _parent
        _TOOLS = _parent / "tools"
        break
else:  # pragma: no cover - only fires if the file is moved outside the repo
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

PINNED_ORDER = (
    "e2eControlPort",
    "serverUrl",
    "roomId",
    "token",
    "role",
    "permission",
    "sharedFolder",
    "excludePatterns",
    "autoReconnect",
    "debugLogging",
)

ORIGINAL = (
    b"{\n"
    b'  "clientId": "fixture-client",\n'
    b'  "serverPassword": "SENTINEL-SERVERPW-c0ffee-DO-NOT-LEAK"\n'
    b"}\n"
)


def assert_synthetic(path: Path) -> Path:
    """Refuse to touch the owner's live vaults (D16) before a single byte is written."""
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
    run_id = "20260804T000000Z-1-a1b2c3"
    return relay.RelayRoom(
        id="11111111-2222-3333-4444-555555555555",
        token=SENTINEL_ROOM_TOKEN,
        name=f"{constants.RELAY_ROOM_NAME_PREFIX}{run_id}",
        base_url=constants.RELAY_BASE_URL,
    )


def keys_in_file_order(raw: bytes) -> list:
    """Top-level keys of the settings file, in the order the BYTES carry them.

    ``json.loads`` into a dict preserves insertion order in CPython, so this reads the
    file's own order rather than a re-sorted view of it.
    """
    return list(json.loads(raw.decode("utf-8-sig")))

def test_the_pinned_tuple_is_exactly_the_ten_keys_in_the_pinned_order() -> None:
    assert constants.PROVISIONED_SETTINGS_KEYS == PINNED_ORDER
    assert len(constants.PROVISIONED_SETTINGS_KEYS) == 10
    assert len(set(constants.PROVISIONED_SETTINGS_KEYS)) == 10


def test_gate_settings_members_produces_exactly_the_pinned_set_in_order() -> None:
    members = provisioning.gate_settings_members(role=constants.ROLE_A, room=make_room())
    assert tuple(members) == constants.PROVISIONED_SETTINGS_KEYS


def test_the_provisioned_file_carries_exactly_the_ten_keys_in_the_pinned_order(
    tmp_path: Path,
) -> None:
    vault = make_vault(tmp_path, "vault-a", ORIGINAL)
    provisioning.provision_gate_settings(vault, constants.ROLE_A, room=make_room(), control_probe=silent_control_probe)

    on_disk = keys_in_file_order((vault / constants.PLUGIN_DATA_REL).read_bytes())
    provisioned = [key for key in on_disk if key in constants.PROVISIONED_SETTINGS_KEYS]
    assert tuple(provisioned) == constants.PROVISIONED_SETTINGS_KEYS


def test_no_key_outside_the_pinned_set_is_invented(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-b", ORIGINAL)
    before = set(keys_in_file_order(ORIGINAL))

    provisioning.provision_gate_settings(vault, constants.ROLE_B, room=make_room(), control_probe=silent_control_probe)

    after = set(keys_in_file_order((vault / constants.PLUGIN_DATA_REL).read_bytes()))
    invented = after - before - set(constants.PROVISIONED_SETTINGS_KEYS)
    assert invented == set(), f"the rig invented settings keys: {sorted(invented)}"
    assert before <= after, "an owner key disappeared from the provisioned file"


def test_the_record_states_the_key_set_it_provisioned(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-record", ORIGINAL)
    record = provisioning.provision_gate_settings(vault, constants.ROLE_A, room=make_room(), control_probe=silent_control_probe)
    assert record.provisioned_keys == constants.PROVISIONED_SETTINGS_KEYS


def test_the_pinned_set_and_the_credential_set_are_disjoint_by_construction() -> None:
    # AC1's "neither read nor written" is only enforceable if the two sets can never
    # overlap. That is a property of constants.py, not of the write path.
    assert set(constants.PROVISIONED_SETTINGS_KEYS) & set(constants.CREDENTIAL_SETTINGS_KEYS) == set()
    assert constants.CREDENTIAL_SETTINGS_KEYS == (
        "encryptionPassphrase",
        "encryptionSalt",
        "jwt",
        "serverPassword",
    )
