# WP70 / AC1 — blind counterpart 2 for "every byte outside the spliced members survives:
# indentation, line endings, key order, encoding".
#
# Different data and a different angle: a MINIFIED single-line document with no
# whitespace at all — the shape with no indentation to preserve, where a re-serialiser
# produces something that still parses and is visibly not the owner's file — plus a
# UTF-8 file whose non-ASCII is raw rather than escaped.
#
# DATA SAFETY: synthetic fixture vaults under tmp_path, guarded against both owner vaults.

from __future__ import annotations

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

MINIFIED = b'{"clientId":"fixture-min","prefs":{"a":[1,2,3],"b":null},"z":true}'
RAW_UTF8 = (
    "{\n"
    '  "vaultLabel": "Ordnerübersicht — 日本語 ✓",\n'
    '  "emoji": "🙂",\n'
    '  "clientId": "fixture-utf8"\n'
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
        id="cafebabe-0000-1111-2222-333344445555",
        token="SENTINEL-BLIND2-TOKEN",
        name=f"{constants.RELAY_ROOM_NAME_PREFIX}20260804T141414Z-4-bbccdd",
        base_url=constants.RELAY_BASE_URL,
    )


def provision(tmp_path: Path, name: str, original: bytes, role: str) -> Path:
    vault = assert_synthetic(tmp_path / name)
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(original)
    provisioning.provision_gate_settings(
        vault, role, room=make_room(), control_probe=silent_control_probe
    )
    return vault


def test_a_minified_document_stays_minified(tmp_path: Path) -> None:
    vault = provision(tmp_path, "vault-min", MINIFIED, constants.ROLE_A)
    produced = (vault / constants.PLUGIN_DATA_REL).read_bytes()
    assert b"\n" not in produced, "the splice introduced line breaks the owner did not have"
    assert produced.endswith(b"}")
    assert b'"prefs":{"a":[1,2,3],"b":null}' in produced
    assert b'"clientId":"fixture-min"' in produced
    assert b'"z":true' in produced


def test_a_minified_document_restores_byte_exactly(tmp_path: Path) -> None:
    vault = provision(tmp_path, "vault-min-restore", MINIFIED, constants.ROLE_B)
    provisioning.restore_gate_settings(vault)
    assert (vault / constants.PLUGIN_DATA_REL).read_bytes() == MINIFIED


def test_raw_utf8_is_not_escaped_by_the_splice(tmp_path: Path) -> None:
    vault = provision(tmp_path, "vault-utf8", RAW_UTF8, constants.ROLE_A)
    produced = (vault / constants.PLUGIN_DATA_REL).read_bytes()
    assert "Ordnerübersicht — 日本語 ✓".encode("utf-8") in produced
    assert "🙂".encode("utf-8") in produced
    assert b"\\u" not in produced, "the splice escaped non-ASCII the owner had raw"


@pytest.mark.parametrize("original", [MINIFIED, RAW_UTF8])
def test_the_owner_bytes_survive_a_full_cycle(tmp_path: Path, original: bytes) -> None:
    vault = provision(tmp_path, f"cycle-{len(original)}", original, constants.ROLE_A)
    provisioning.restore_gate_settings(vault)
    assert (vault / constants.PLUGIN_DATA_REL).read_bytes() == original
