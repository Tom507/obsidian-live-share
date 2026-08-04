# WP70 / AC1 — blind counterpart 1 for "every byte outside the spliced members survives:
# indentation, line endings, key order, encoding".
#
# Different data and a different angle: a four-space-indented LF file with a trailing
# newline, checked by reconstructing the ORIGINAL from the provisioned bytes — every
# spliced member is removed by name and what remains must be the original, byte for byte.
#
# DATA SAFETY: synthetic fixture vault under tmp_path, guarded against both owner vaults.

from __future__ import annotations

import json
import re
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

ORIGINAL = (
    b"{\n"
    b'    "clientId": "fixture-4space",\n'
    b'    "reconnectDelayMs": 1500,\n'
    b'    "theme": "obsidian-dark",\n'
    b'    "nestedPrefs": {\n'
    b'        "showGutter": true,\n'
    b'        "fontSize": 14\n'
    b"    }\n"
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


def provisioned_bytes(tmp_path: Path, name: str, role: str) -> bytes:
    vault = make_vault(tmp_path, name)
    provisioning.provision_gate_settings(
        vault, role, room=relay.RelayRoom(
            id="deadbeef-0000-1111-2222-333344445555",
            token="SENTINEL-BLIND1-TOKEN",
            name=f"{constants.RELAY_ROOM_NAME_PREFIX}20260804T131313Z-3-aabbcc",
            base_url=constants.RELAY_BASE_URL,
        ),
        control_probe=silent_control_probe,
    )
    return (vault / constants.PLUGIN_DATA_REL).read_bytes()


def test_removing_the_spliced_members_reconstructs_the_original_exactly(
    tmp_path: Path,
) -> None:
    produced = provisioned_bytes(tmp_path, "vault-reconstruct", constants.ROLE_A).decode("utf-8")
    stripped = produced
    for key in constants.PROVISIONED_SETTINGS_KEYS:
        # Remove the member together with the whitespace the splice reused and the comma.
        stripped = re.sub(
            r'\s*"' + re.escape(key) + r'"\s*:\s*(?:\[[^\]]*\]|"[^"]*"|[^,}\s]+)\s*,?',
            "",
            stripped,
            count=1,
        )
    assert stripped.encode("utf-8") == ORIGINAL, "bytes outside the spliced members changed"


def test_four_space_indentation_and_lf_endings_survive(tmp_path: Path) -> None:
    produced = provisioned_bytes(tmp_path, "vault-indent", constants.ROLE_B)
    assert b"\r\n" not in produced, "LF endings were converted to CRLF"
    assert b'\n    "clientId": "fixture-4space",' in produced
    assert b'\n        "showGutter": true,' in produced
    assert produced.endswith(b"}\n")


def test_the_nested_object_is_carried_over_verbatim(tmp_path: Path) -> None:
    produced = provisioned_bytes(tmp_path, "vault-nested", constants.ROLE_A)
    block = (
        b'    "nestedPrefs": {\n'
        b'        "showGutter": true,\n'
        b'        "fontSize": 14\n'
        b"    }\n"
    )
    assert block in produced


def test_the_owner_key_order_is_unchanged(tmp_path: Path) -> None:
    produced = provisioned_bytes(tmp_path, "vault-order", constants.ROLE_A)
    parsed = list(json.loads(produced.decode("utf-8")))
    owner_keys = [key for key in parsed if key not in constants.PROVISIONED_SETTINGS_KEYS]
    assert owner_keys == ["clientId", "reconnectDelayMs", "theme", "nestedPrefs"]
