# WP70 / AC1 — blind counterpart 2 for "`debugLogging` is provisioned `false`".
#
# Different angle: the REASON the criterion exists. "a debug log written to
# `debugLogPath` inside the vault is a vault write that the C47 AC3 fingerprint would
# report as a mismatch." So the assertion here is that the rig narrows the switch while
# leaving the owner's `debugLogPath` — the thing the fingerprint would see — untouched,
# and that the narrowing is not achieved by deleting or rewriting that path.
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

from obsidian_e2e import constants, provisioning, relay  # noqa: E402

OWNER_VAULTS = (
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga"),
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie"),
)

DEBUG_PATH = "Logs/live-share-debug.md"
ORIGINAL = (
    "{\n"
    '  "debugLogging": true,\n'
    f'  "debugLogPath": "{DEBUG_PATH}",\n'
    '  "debugVerbosity": "trace",\n'
    '  "clientId": "fixture-debug"\n'
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


def make_room() -> relay.RelayRoom:
    return relay.RelayRoom(
        id="9f8e7d6c-5b4a-3928-1706-fedcba987654",
        token="SENTINEL-BLIND2-TOKEN",
        name=f"{constants.RELAY_ROOM_NAME_PREFIX}20260804T181818Z-9-001122",
        base_url=constants.RELAY_BASE_URL,
    )


@pytest.fixture()
def vault(tmp_path: Path) -> Path:
    root = assert_synthetic(tmp_path / "vault-debug-path")
    (root / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (root / constants.PLUGIN_DATA_REL).write_bytes(ORIGINAL)
    # A pre-existing note at the debug path, so a debug write would be visible.
    (root / "Logs").mkdir(parents=True, exist_ok=True)
    (root / DEBUG_PATH).write_bytes(b"# owner note\n")
    return root


def test_the_switch_is_narrowed_and_the_path_is_left_alone(vault: Path) -> None:
    provisioning.provision_gate_settings(
        vault, constants.ROLE_A, room=make_room(), control_probe=silent_control_probe
    )
    parsed = json.loads((vault / constants.PLUGIN_DATA_REL).read_bytes().decode("utf-8"))
    assert parsed["debugLogging"] is False
    assert parsed["debugLogPath"] == DEBUG_PATH
    assert parsed["debugVerbosity"] == "trace"


def test_the_rig_writes_nothing_at_the_debug_path(vault: Path) -> None:
    before = (vault / DEBUG_PATH).read_bytes()
    provisioning.provision_gate_settings(
        vault, constants.ROLE_B, room=make_room(), control_probe=silent_control_probe
    )
    provisioning.restore_gate_settings(vault)
    assert (vault / DEBUG_PATH).read_bytes() == before
    assert sorted(p.name for p in (vault / "Logs").iterdir()) == ["live-share-debug.md"]


def test_debug_logging_is_not_in_the_credential_set_but_is_in_the_pinned_set() -> None:
    assert "debugLogging" in constants.PROVISIONED_SETTINGS_KEYS
    assert "debugLogPath" not in constants.PROVISIONED_SETTINGS_KEYS
    assert "debugLogging" not in constants.CREDENTIAL_SETTINGS_KEYS


def test_the_owners_true_value_comes_back_and_the_vault_is_untouched(vault: Path) -> None:
    provisioning.provision_gate_settings(
        vault, constants.ROLE_A, room=make_room(), control_probe=silent_control_probe
    )
    provisioning.restore_gate_settings(vault)
    assert (vault / constants.PLUGIN_DATA_REL).read_bytes() == ORIGINAL
