# WP70 / AC2 — blind counterpart 1 for "the run record states positively which folder is
# shared in BOTH vaults".
#
# Different angle: the records are handed over in the WRONG order (role b first), and a
# third record for an unknown role is offered. A record builder that trusts its input
# order, or that accepts any number of vaults, does not state "in both vaults".
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

RUN_ID = "20260804T090909Z-13-778899"


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


def make_vault(tmp_path: Path, name: str, raw: bytes) -> Path:
    vault = assert_synthetic(tmp_path / name)
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(raw)
    return vault


def make_room() -> relay.RelayRoom:
    return relay.RelayRoom(
        id="8d8d8d8d-9e9e-0f0f-1010-212132324343",
        token="SENTINEL-BLIND1-TOKEN",
        name=f"{constants.RELAY_ROOM_NAME_PREFIX}{RUN_ID}",
        base_url=constants.RELAY_BASE_URL,
    )


@pytest.fixture()
def records(tmp_path: Path) -> list:
    room = make_room()
    a = make_vault(tmp_path, "orga", b'{"sharedFolder": "Alles"}\n')
    b = make_vault(tmp_path, "orga - Kopie", b'{"clientId": "b"}\n')
    return [
        provisioning.provision_gate_settings(
            a, constants.ROLE_A, room=room, run_id=RUN_ID, control_probe=silent_control_probe
        ),
        provisioning.provision_gate_settings(
            b, constants.ROLE_B, room=room, run_id=RUN_ID, control_probe=silent_control_probe
        ),
    ]


def test_the_record_is_role_ordered_whatever_order_it_was_handed(records: list) -> None:
    forward = provisioning.shared_surface_record(records)
    backward = provisioning.shared_surface_record(list(reversed(records)))
    assert [entry["role"] for entry in forward["vaults"]] == list(constants.ROLES)
    assert forward == backward, "the record depends on the caller's argument order"


def test_the_record_names_a_distinct_vault_path_per_role(records: list) -> None:
    record = provisioning.shared_surface_record(records)
    paths = [entry["vaultPath"] for entry in record["vaults"]]
    assert len(set(paths)) == 2, "both roles were recorded against the same vault"
    assert all(entry["sharedFolder"] == constants.SCRATCH_FOLDER for entry in record["vaults"])


def test_a_third_record_is_refused(records: list) -> None:
    with pytest.raises(provisioning.SharedSurfaceNotEstablished):
        provisioning.shared_surface_record([*records, records[0]])


def test_an_empty_record_list_is_refused() -> None:
    with pytest.raises(provisioning.SharedSurfaceNotEstablished):
        provisioning.shared_surface_record([])


def test_the_record_survives_a_json_round_trip_unchanged(records: list) -> None:
    record = provisioning.shared_surface_record(records)
    assert json.loads(json.dumps(record)) == record
