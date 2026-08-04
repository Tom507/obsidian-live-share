# WP70 / AC1 — blind counterpart 2 for "the marker's pinned field set is unchanged, and
# the restore path is byte-unchanged".
#
# Different angle: adopting a borrow left by a CRASHED run. The marker is the statement
# "this is what the owner had", so a second provisioning must adopt the existing backup
# and never overwrite it with the already-provisioned ten-member state — the failure
# mode that would silently make the restore reproduce the RIG's file, not the owner's.
#
# DATA SAFETY: synthetic fixture vaults under tmp_path, guarded against both owner vaults.

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

ORIGINAL = b'{\r\n  "clientId": "fixture-crlf",\r\n  "sharedFolder": "Team"\r\n}'
ORIGINAL_SHA = hashlib.sha256(ORIGINAL).hexdigest()


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
        id="5a5a5a5a-6b6b-7c7c-8d8d-9e9e0f0f1010",
        token="SENTINEL-BLIND2-TOKEN",
        name=f"{constants.RELAY_ROOM_NAME_PREFIX}20260804T161616Z-6-ddeeff",
        base_url=constants.RELAY_BASE_URL,
    )


def provision(vault: Path, role: str, run_id: str):
    return provisioning.provision_gate_settings(
        vault, role, room=make_room(), run_id=run_id, control_probe=silent_control_probe
    )


def test_a_crashed_run_leaves_a_backup_the_next_run_adopts(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-crashed")
    provision(vault, constants.ROLE_A, "run-one")  # "crashes" — no restore

    second = provision(vault, constants.ROLE_A, "run-two")
    assert second.provision.adopted_existing_backup is True
    assert (vault / constants.SETTINGS_BACKUP_REL).read_bytes() == ORIGINAL


def test_the_adopted_backup_is_never_overwritten_by_the_provisioned_state(
    tmp_path: Path,
) -> None:
    vault = make_vault(tmp_path, "vault-no-overwrite")
    for run in ("run-one", "run-two", "run-three"):
        provision(vault, constants.ROLE_B, run)
        backup = (vault / constants.SETTINGS_BACKUP_REL).read_bytes()
        assert hashlib.sha256(backup).hexdigest() == ORIGINAL_SHA

    provisioning.restore_gate_settings(vault)
    assert (vault / constants.PLUGIN_DATA_REL).read_bytes() == ORIGINAL


def test_the_marker_field_set_is_the_same_after_an_adoption(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-marker-adopt")
    provision(vault, constants.ROLE_A, "run-one")
    provision(vault, constants.ROLE_A, "run-two")

    marker = json.loads((vault / constants.PROVISION_MARKER_REL).read_bytes().decode("utf-8"))
    assert tuple(marker) == constants.PROVISION_MARKER_FIELDS
    assert marker["runId"] == "run-two"
    assert marker["originalSha256"] == ORIGINAL_SHA


def test_only_one_backup_and_one_marker_ever_exist(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-one-borrow")
    provision(vault, constants.ROLE_A, "run-one")
    provision(vault, constants.ROLE_A, "run-two")

    names = sorted(p.name for p in (vault / constants.PLUGIN_DIR_REL).iterdir())
    assert names == [".e2e-provision.json", "data.json", "data.json.e2e-original"]
