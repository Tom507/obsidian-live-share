# WP70 / AC1 — blind counterpart 1 for "the provisioned key set is exactly the ten pinned
# keys, in the pinned order, and no key is invented".
#
# Different angle: the vault has NO settings file at all, so the whole document is the
# rig's own fresh one — the case where an implementation is most likely to emit its own
# idea of the key set — and the order is read out of the raw BYTES by scanning member
# positions, not out of a parsed dict.
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


def empty_vault(tmp_path: Path, name: str) -> Path:
    vault = assert_synthetic(tmp_path / name)
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    return vault


def make_room(token: str = "SENTINEL-BLIND1-TOKEN") -> relay.RelayRoom:
    return relay.RelayRoom(
        id="aaaabbbb-cccc-dddd-eeee-ffff00001111",
        token=token,
        name=f"{constants.RELAY_ROOM_NAME_PREFIX}20260804T101010Z-99-ffeedd",
        base_url=constants.RELAY_BASE_URL,
    )


def byte_order_of_keys(raw: bytes, keys) -> list:
    text = raw.decode("utf-8-sig")
    found = []
    for key in keys:
        needle = f'"{key}"'
        index = text.find(needle)
        if index >= 0:
            found.append((index, key))
    return [key for _index, key in sorted(found)]


def test_a_fresh_document_carries_the_pinned_keys_in_the_pinned_byte_order(
    tmp_path: Path,
) -> None:
    vault = empty_vault(tmp_path, "fresh-vault")
    provisioning.provision_gate_settings(
        vault, constants.ROLE_B, room=make_room(), control_probe=silent_control_probe
    )

    raw = (vault / constants.PLUGIN_DATA_REL).read_bytes()
    assert byte_order_of_keys(raw, constants.PROVISIONED_SETTINGS_KEYS) == list(
        constants.PROVISIONED_SETTINGS_KEYS
    )


def test_a_fresh_document_carries_nothing_but_the_pinned_keys(tmp_path: Path) -> None:
    vault = empty_vault(tmp_path, "fresh-only")
    provisioning.provision_gate_settings(
        vault, constants.ROLE_A, room=make_room(), control_probe=silent_control_probe
    )

    parsed = json.loads((vault / constants.PLUGIN_DATA_REL).read_bytes().decode("utf-8-sig"))
    assert set(parsed) == set(constants.PROVISIONED_SETTINGS_KEYS)
    assert len(parsed) == 10


def test_no_credential_key_is_ever_a_member_of_the_written_set(tmp_path: Path) -> None:
    vault = empty_vault(tmp_path, "fresh-no-creds")
    provisioning.provision_gate_settings(
        vault, constants.ROLE_A, room=make_room(), control_probe=silent_control_probe
    )
    parsed = json.loads((vault / constants.PLUGIN_DATA_REL).read_bytes().decode("utf-8-sig"))
    for key in constants.CREDENTIAL_SETTINGS_KEYS:
        assert key not in parsed, f"the rig wrote the credential key {key}"


def test_the_member_builder_is_order_stable_across_roles_and_rooms() -> None:
    first = provisioning.gate_settings_members(role=constants.ROLE_A, room=make_room("t1"))
    second = provisioning.gate_settings_members(role=constants.ROLE_B, room=make_room("t2"))
    assert tuple(first) == tuple(second) == constants.PROVISIONED_SETTINGS_KEYS
    # Only the role-dependent members may differ.
    differing = {k for k in first if first[k] != second[k]}
    assert differing <= {"e2eControlPort", "role", "token"}
