# WP70 / AC1 — "every byte outside the spliced members survives the round trip — the
# file keeps its own indentation, line endings, key order and encoding."
#
# Ten spliced members instead of one is exactly where a splice degrades into a
# re-serialisation, so the fixture is built out of members whose raw text is uniquely
# identifiable, and the assertions are made on the BYTES: each owner member's raw slice
# must appear verbatim, in its original relative order, and the tail after the last
# owner member must still be a suffix of the file.
#
#   ├── T1 every owner member's raw byte slice survives the ten-member splice verbatim
#   ├── T2 the owner members keep their original relative order
#   ├── T3 the byte tail after the last owner member survives as a suffix
#   ├── T4 the file's own indentation style and line endings are still present
#   ├── T5 the encoding survives: a BOM file is still BOM-prefixed and still parses
#   └── T6 the full cycle is byte-exact — the only assertion that cannot be faked
#
# DATA SAFETY: synthetic fixture vaults under tmp_path, guarded against both owner
# vaults. Sentinel credential values only.

from __future__ import annotations

import hashlib
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

# Tab-indented, CRLF, no trailing newline: three formatting properties a JSON
# round-trip destroys, in one file. Every member's raw text is unique.
OWNER_MEMBERS = (
    b'\t"clientId": "fixture-client-7f3a"',
    b'\t"serverPassword": "SENTINEL-SERVERPW-c0ffee-DO-NOT-LEAK"',
    b'\t"vaultLabel": "Ordner\\u00fcbersicht"',
    b'\t"nested": {"a": [1, 2, 3], "b": null}',
    b'\t"trailingNumberStyle": 1.50',
)
ORIGINAL = b"{\r\n" + b",\r\n".join(OWNER_MEMBERS) + b"\r\n}"

BOM_ORIGINAL = "\ufeff" + '{\n  "clientId": "fixture-bom"\n}\n'


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


@pytest.fixture()
def provisioned(tmp_path: Path) -> bytes:
    vault = make_vault(tmp_path, "vault-surround", ORIGINAL)
    provisioning.provision_gate_settings(vault, constants.ROLE_A, room=make_room(), control_probe=silent_control_probe)
    return (vault / constants.PLUGIN_DATA_REL).read_bytes()


@pytest.mark.parametrize("member", OWNER_MEMBERS)
def test_every_owner_member_survives_the_ten_member_splice_verbatim(
    provisioned: bytes, member: bytes
) -> None:
    assert member in provisioned, "an owner member was rewritten rather than carried over"


def test_the_owner_members_keep_their_original_relative_order(provisioned: bytes) -> None:
    positions = [provisioned.index(member) for member in OWNER_MEMBERS]
    assert positions == sorted(positions), "the splice reordered the owner's keys"


def test_the_byte_tail_after_the_last_owner_member_survives(provisioned: bytes) -> None:
    tail_start = ORIGINAL.index(OWNER_MEMBERS[-1])
    tail = ORIGINAL[tail_start:]
    assert provisioned.endswith(tail), "the file's tail — including its missing trailing newline — changed"


def test_the_files_own_indentation_and_line_endings_are_still_present(
    provisioned: bytes,
) -> None:
    assert b"\t" in provisioned, "tab indentation was replaced"
    assert b"\r\n" in provisioned, "CRLF line endings were normalised away"
    # A lone LF would mean the splice emitted its own line ending style.
    assert provisioned.count(b"\n") == provisioned.count(b"\r\n")


def test_the_encoding_survives_a_bom_prefixed_file(tmp_path: Path) -> None:
    raw = BOM_ORIGINAL.encode("utf-8")
    vault = make_vault(tmp_path, "vault-bom", raw)
    provisioning.provision_gate_settings(vault, constants.ROLE_B, room=make_room(), control_probe=silent_control_probe)

    produced = (vault / constants.PLUGIN_DATA_REL).read_bytes()
    assert produced.startswith(b"\xef\xbb\xbf"), "the BOM was stripped"
    parsed = json.loads(produced.decode("utf-8-sig"))
    assert parsed["clientId"] == "fixture-bom"
    assert parsed[constants.SETTINGS_PORT_KEY] == constants.REAL_CONTROL_PORT_B


def test_the_full_cycle_is_byte_exact(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-cycle", ORIGINAL)
    settings = vault / constants.PLUGIN_DATA_REL
    digest = hashlib.sha256(ORIGINAL).hexdigest()

    provisioning.provision_gate_settings(vault, constants.ROLE_A, room=make_room(), control_probe=silent_control_probe)
    provisioning.restore_gate_settings(vault)

    restored = settings.read_bytes()
    assert len(restored) == len(ORIGINAL)
    assert hashlib.sha256(restored).hexdigest() == digest
    assert restored == ORIGINAL
