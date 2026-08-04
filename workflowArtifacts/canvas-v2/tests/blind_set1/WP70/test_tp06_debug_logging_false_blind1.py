# WP70 / AC1 — blind counterpart 1 for "`debugLogging` is provisioned `false`".
#
# Different data: the owner's file carries `debugLogging` as the STRING "true" (an
# Obsidian settings file is hand-editable and this is what a hand edit looks like), and
# a second fixture carries the number 1. Both are truthy-but-not-boolean, and both must
# come out as the JSON literal `false`.
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

FIXTURES = {
    "string_true": b'{\n  "debugLogging": "true",\n  "clientId": "f1"\n}\n',
    "number_one": b'{\n  "debugLogging": 1,\n  "clientId": "f2"\n}\n',
    "null": b'{\n  "debugLogging": null,\n  "clientId": "f3"\n}\n',
    "absent": b'{\n  "clientId": "f4"\n}\n',
}


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
        id="1a2b3c4d-5e6f-7081-92a3-b4c5d6e7f809",
        token="SENTINEL-BLIND1-TOKEN",
        name=f"{constants.RELAY_ROOM_NAME_PREFIX}20260804T171717Z-1-eeff00",
        base_url=constants.RELAY_BASE_URL,
    )


def provision(tmp_path: Path, label: str, role: str) -> Path:
    vault = assert_synthetic(tmp_path / f"vault-{label}")
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(FIXTURES[label])
    provisioning.provision_gate_settings(
        vault, role, room=make_room(), control_probe=silent_control_probe
    )
    return vault


@pytest.mark.parametrize("label", sorted(FIXTURES))
def test_every_prior_shape_is_narrowed_to_the_boolean_false(
    tmp_path: Path, label: str
) -> None:
    vault = provision(tmp_path, label, constants.ROLE_A)
    parsed = json.loads((vault / constants.PLUGIN_DATA_REL).read_bytes().decode("utf-8-sig"))
    assert parsed["debugLogging"] is False
    assert parsed["debugLogging"] != "false"
    assert parsed["debugLogging"] != 0 or parsed["debugLogging"] is False


@pytest.mark.parametrize("label", sorted(FIXTURES))
def test_the_bytes_carry_a_json_false_literal(tmp_path: Path, label: str) -> None:
    vault = provision(tmp_path, label, constants.ROLE_B)
    raw = (vault / constants.PLUGIN_DATA_REL).read_bytes()
    assert b'"debugLogging": false' in raw or b'"debugLogging":false' in raw
    assert b'"debugLogging": "false"' not in raw


@pytest.mark.parametrize("label", sorted(FIXTURES))
def test_the_prior_shape_is_restored_byte_exactly(tmp_path: Path, label: str) -> None:
    vault = provision(tmp_path, label, constants.ROLE_A)
    provisioning.restore_gate_settings(vault)
    assert (vault / constants.PLUGIN_DATA_REL).read_bytes() == FIXTURES[label]


def test_fixture_audit_every_prior_shape_really_differs_from_false() -> None:
    for label, raw in FIXTURES.items():
        parsed = json.loads(raw.decode("utf-8"))
        assert parsed.get("debugLogging") is not False, f"{label} was already false"
