# WP70 / AC1 + S4 — blind counterpart 1 for "the four credential keys are neither read
# nor written, and their bytes survive the round trip".
#
# Different angle: the credential values contain characters that a re-serialiser would
# re-escape (raw non-ASCII, an embedded quote, a backslash, a newline escape), and the
# leak surfaces checked are the AC2 run record and the AC4 gate record rather than the
# provisioning record.
#
# DATA SAFETY: synthetic fixture vault under tmp_path, guarded against both owner vaults;
# synthetic sentinel credential values only.

from __future__ import annotations

import hashlib
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

SENTINELS = (
    "SENTINEL-PASS-ünïcødé-c0ffee",
    "SENTINEL-SALT-with\\\\backslash-c0ffee",
    "SENTINEL-JWT-with\\\"quote-c0ffee",
    "SENTINEL-PW-with\\nescape-c0ffee",
)
ROOM_TOKEN = "SENTINEL-ROOM-TOKEN-blind1-c0ffee"

ORIGINAL = (
    "{\n"
    '  "clientId": "fixture",\n'
    f'  "encryptionPassphrase": "{SENTINELS[0]}",\n'
    f'  "encryptionSalt": "{SENTINELS[1]}",\n'
    f'  "jwt": "{SENTINELS[2]}",\n'
    f'  "serverPassword": "{SENTINELS[3]}"\n'
    "}\n"
).encode("utf-8")


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
        id="12341234-5678-9abc-def0-0fedcba98765",
        token=ROOM_TOKEN,
        name=f"{constants.RELAY_ROOM_NAME_PREFIX}20260804T111111Z-5-abcdef",
        base_url=constants.RELAY_BASE_URL,
    )


def test_escape_heavy_credential_members_survive_the_splice(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-escapes")
    provisioning.provision_gate_settings(
        vault, constants.ROLE_A, room=make_room(), control_probe=silent_control_probe
    )
    raw = (vault / constants.PLUGIN_DATA_REL).read_bytes().decode("utf-8")
    for sentinel in SENTINELS:
        assert sentinel in raw, "a credential value was re-escaped by the splice"


def test_the_round_trip_is_byte_exact_for_escape_heavy_values(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-escapes-restore")
    provisioning.provision_gate_settings(
        vault, constants.ROLE_B, room=make_room(), control_probe=silent_control_probe
    )
    provisioning.restore_gate_settings(vault)
    restored = (vault / constants.PLUGIN_DATA_REL).read_bytes()
    assert hashlib.sha256(restored).hexdigest() == hashlib.sha256(ORIGINAL).hexdigest()
    assert restored == ORIGINAL


def test_no_sentinel_reaches_the_shared_surface_or_gate_records(tmp_path: Path) -> None:
    room = make_room()
    vault_a = make_vault(tmp_path, "vault-a")
    vault_b = make_vault(tmp_path, "vault-b - Kopie")
    records = [
        provisioning.provision_gate_settings(
            vault_a, constants.ROLE_A, room=room, control_probe=silent_control_probe
        ),
        provisioning.provision_gate_settings(
            vault_b, constants.ROLE_B, room=room, control_probe=silent_control_probe
        ),
    ]
    sequence = provisioning.GateSequence(run_id="20260804T111111Z-5-abcdef")
    for step in provisioning.GateSequence.STEPS[:7]:
        sequence.begin(step)
        sequence.complete(step)

    blob = json.dumps(provisioning.shared_surface_record(records)) + json.dumps(sequence.record())
    for sentinel in (*SENTINELS, ROOM_TOKEN):
        assert sentinel not in blob, "a credential sentinel reached a run record"
