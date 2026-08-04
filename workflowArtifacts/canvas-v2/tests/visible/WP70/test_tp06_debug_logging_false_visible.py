# WP70 / AC1 — "`debugLogging` is provisioned `false` for the duration and restored,
# because a debug log written to `debugLogPath` inside the vault is a vault write that
# the C47 AC3 fingerprint would report as a mismatch."
#
# `false` is the one provisioned value whose whole point is that it is falsy, so it is
# also the one an implementation is most likely to drop: `if value:` skips it, and a
# key-absent file reads as the plugin's own default. The assertions therefore look at
# the JSON literal in the bytes, not at truthiness.
#
#   ├── T1 the pinned value is the boolean False, not "false" and not 0
#   ├── T2 the provisioned file carries `"debugLogging": false` as a JSON literal
#   ├── T3 a vault whose owner had debugLogging TRUE is narrowed to false
#   ├── T4 the owner's true value is restored afterwards, byte-exactly
#   └── T5 the record states the debugLogging it provisioned, and it is False
#
# DATA SAFETY: synthetic fixture vaults under tmp_path, guarded against both owner
# vaults. Sentinel credential values only.

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

from obsidian_e2e import constants, provisioning, relay  # noqa: E402


def silent_control_probe(port: int) -> bool:
    """No Obsidian instance is running in a unit test — and none may be started."""
    return False

OWNER_VAULTS = (
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga"),
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie"),
)

SENTINEL_ROOM_TOKEN = "SENTINEL-ROOM-TOKEN-c0ffee-DO-NOT-LEAK"

NO_DEBUG_KEY = b'{\n  "clientId": "fixture-client"\n}\n'
DEBUG_ON = (
    b"{\n"
    b'  "clientId": "fixture-client",\n'
    b'  "debugLogging": true,\n'
    b'  "debugLogPath": "_logs/live-share.log"\n'
    b"}\n"
)


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
        name=f"{constants.RELAY_ROOM_NAME_PREFIX}20260804T000000Z-1-a1b2c3",
        base_url=constants.RELAY_BASE_URL,
    )

def test_the_pinned_value_is_the_boolean_false() -> None:
    assert constants.SETTINGS_DEBUG_LOGGING is False


def test_the_provisioned_file_carries_the_json_literal_false(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-no-key", NO_DEBUG_KEY)
    provisioning.provision_gate_settings(vault, constants.ROLE_A, room=make_room(), control_probe=silent_control_probe)

    raw = (vault / constants.PLUGIN_DATA_REL).read_bytes()
    assert b'"debugLogging": false' in raw or b'"debugLogging":false' in raw
    parsed = json.loads(raw.decode("utf-8-sig"))
    assert parsed["debugLogging"] is False
    assert "debugLogging" in parsed, "the falsy member was skipped instead of written"


def test_a_vault_with_debug_logging_on_is_narrowed_to_false(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-debug-on", DEBUG_ON)
    assert json.loads(DEBUG_ON.decode("utf-8"))["debugLogging"] is True

    provisioning.provision_gate_settings(vault, constants.ROLE_B, room=make_room(), control_probe=silent_control_probe)

    parsed = json.loads((vault / constants.PLUGIN_DATA_REL).read_bytes().decode("utf-8-sig"))
    assert parsed["debugLogging"] is False
    # The owner's debugLogPath is not the rig's to remove — only the switch is flipped.
    assert parsed["debugLogPath"] == "_logs/live-share.log"


def test_the_owners_true_value_is_restored_byte_exactly(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-debug-restore", DEBUG_ON)
    settings = vault / constants.PLUGIN_DATA_REL

    provisioning.provision_gate_settings(vault, constants.ROLE_A, room=make_room(), control_probe=silent_control_probe)
    provisioning.restore_gate_settings(vault)

    assert settings.read_bytes() == DEBUG_ON
    assert json.loads(settings.read_bytes().decode("utf-8"))["debugLogging"] is True


def test_the_record_states_the_debug_logging_it_provisioned(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-debug-record", NO_DEBUG_KEY)
    record = provisioning.provision_gate_settings(vault, constants.ROLE_A, room=make_room(), control_probe=silent_control_probe)
    assert record.debug_logging is False
