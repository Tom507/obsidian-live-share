# WP70 / AC1 + S4 — blind counterpart 2 for "the four credential keys are neither read
# nor written, and their bytes survive the round trip".
#
# Different angle: the credential members sit AFTER the insertion point with unusual
# spacing around the colon, and the room token — a credential the RIG mints — is the
# thing chased. The token must live only in memory and in the provisioned file: never in
# a repr, never in a marker, never in a `RelayRoom` repr.
#
# DATA SAFETY: synthetic fixture vault under tmp_path, guarded against both owner vaults;
# synthetic sentinel credential values only.

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

ROOM_TOKEN = "SENTINEL-MINTED-ROOM-TOKEN-blind2-c0ffee"
OWNER_SECRET = "SENTINEL-OWNER-SERVERPW-blind2-c0ffee"

# Spacing is deliberately irregular: `"key"   :   value` is legal JSON and is exactly
# what a re-serialising implementation normalises away.
ORIGINAL = (
    b"{\n"
    b'  "clientId"   :   "fixture-spacing",\n'
    b'  "encryptionPassphrase"\t: "",\n'
    b'  "encryptionSalt" :"",\n'
    b'  "jwt"  : null,\n'
    b'  "serverPassword"    : "' + OWNER_SECRET.encode("utf-8") + b'"\n'
    b"}\n"
)


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
    (vault / constants.PLUGIN_DATA_REL).write_bytes(ORIGINAL)
    return vault


def make_room() -> relay.RelayRoom:
    return relay.RelayRoom(
        id="0f0f0f0f-1e1e-2d2d-3c3c-4b4b5a5a6969",
        token=ROOM_TOKEN,
        name=f"{constants.RELAY_ROOM_NAME_PREFIX}20260804T121212Z-8-fedcba",
        base_url=constants.RELAY_BASE_URL,
    )


def test_irregular_spacing_around_credential_members_survives(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-spacing")
    provisioning.provision_gate_settings(
        vault, constants.ROLE_A, room=make_room(), control_probe=silent_control_probe
    )
    raw = (vault / constants.PLUGIN_DATA_REL).read_bytes()
    assert b'"encryptionPassphrase"\t: ""' in raw
    assert b'"encryptionSalt" :""' in raw
    assert b'"jwt"  : null' in raw
    assert OWNER_SECRET.encode("utf-8") in raw
    provisioning.restore_gate_settings(vault)
    assert (vault / constants.PLUGIN_DATA_REL).read_bytes() == ORIGINAL


def test_the_minted_room_token_is_redacted_in_the_rooms_own_repr() -> None:
    room = make_room()
    assert ROOM_TOKEN not in repr(room)
    assert ROOM_TOKEN not in str(room)
    assert relay.REDACTED in repr(room)
    # …and it is still available to the code that needs it.
    assert room.token == ROOM_TOKEN


def test_the_minted_token_reaches_the_settings_file_and_nothing_else(
    tmp_path: Path,
) -> None:
    vault = make_vault(tmp_path, "vault-token")
    record = provisioning.provision_gate_settings(
        vault, constants.ROLE_B, room=make_room(), control_probe=silent_control_probe
    )

    settings = (vault / constants.PLUGIN_DATA_REL).read_bytes().decode("utf-8")
    assert ROOM_TOKEN in settings, "the room token never reached the vault it configures"

    marker = (vault / constants.PROVISION_MARKER_REL).read_bytes().decode("utf-8")
    assert ROOM_TOKEN not in marker
    assert ROOM_TOKEN not in repr(record)
    for name in dir(record):
        if not name.startswith("_"):
            assert ROOM_TOKEN not in repr(getattr(record, name))


def test_no_credential_value_is_read_into_the_member_builder() -> None:
    members = provisioning.gate_settings_members(role=constants.ROLE_A, room=make_room())
    values = json.dumps(members)
    assert OWNER_SECRET not in values
    for key in constants.CREDENTIAL_SETTINGS_KEYS:
        assert key not in members
