# WP70 / AC2 — blind counterpart 1 for the FALSIFICATION: "a provisioning that leaves
# `sharedFolder` empty must be refused under SHARED_SURFACE_NOT_ESTABLISHED, not silently
# accepted".
#
# Different data: near-misses rather than emptiness. A trailing slash, a leading `./`, a
# case variant, a parent of the scratch folder and a child of it are all "nearly right",
# and every one of them either widens the surface beyond the rig-owned folder or moves
# the scratch canvas outside it. None may be accepted.
#
# DATA SAFETY: synthetic fixture vaults under tmp_path, guarded against both owner vaults.

from __future__ import annotations

import hashlib
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

RUN_ID = "20260804T050505Z-17-ddeeff"
ORIGINAL = b'{\n  "clientId": "fixture-nearmiss"\n}\n'

FOLDER = constants.SETTINGS_SHARED_FOLDER
NEAR_MISSES = (
    FOLDER + "/",
    "./" + FOLDER,
    "/" + FOLDER,
    FOLDER.upper(),
    FOLDER + "-2",
    FOLDER + "/nested",
    " " + FOLDER,
    FOLDER + " ",
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


def make_room() -> relay.RelayRoom:
    return relay.RelayRoom(
        id="1b1b1b1b-2c2c-3d3d-4e4e-5f5f60607171",
        token="SENTINEL-BLIND1-TOKEN",
        name=f"{constants.RELAY_ROOM_NAME_PREFIX}{RUN_ID}",
        base_url=constants.RELAY_BASE_URL,
    )


def members_with(shared: str) -> dict:
    members = provisioning.gate_settings_members(role=constants.ROLE_A, room=make_room())
    members["sharedFolder"] = shared
    return members


def digest_dir(vault: Path) -> dict:
    return {
        p.name: hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted((vault / constants.PLUGIN_DIR_REL).iterdir())
        if p.is_file()
    }


@pytest.mark.parametrize("shared", NEAR_MISSES)
def test_a_near_miss_shared_folder_is_refused_and_writes_nothing(
    tmp_path: Path, shared: str
) -> None:
    vault = assert_synthetic(tmp_path / f"vault-{abs(hash(shared)) % 100000}")
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(ORIGINAL)
    before = digest_dir(vault)

    with pytest.raises(provisioning.SharedSurfaceNotEstablished) as excinfo:
        provisioning.provision_gate_settings(
            vault,
            constants.ROLE_A,
            room=make_room(),
            run_id=RUN_ID,
            members=members_with(shared),
            control_probe=silent_control_probe,
        )

    assert excinfo.value.reason == constants.SHARED_SURFACE_NOT_ESTABLISHED
    assert digest_dir(vault) == before
    assert (vault / constants.PLUGIN_DATA_REL).read_bytes() == ORIGINAL


@pytest.mark.parametrize("shared", NEAR_MISSES)
def test_verify_shared_surface_refuses_the_same_near_misses(shared: str) -> None:
    with pytest.raises(provisioning.SharedSurfaceNotEstablished):
        provisioning.verify_shared_surface(members_with(shared))


def test_fixture_audit_every_near_miss_really_differs_from_the_constant() -> None:
    for shared in NEAR_MISSES:
        assert shared != constants.SETTINGS_SHARED_FOLDER


def test_the_exact_constant_is_accepted(tmp_path: Path) -> None:
    # Without this, the refusals would pass for a rig that refuses every value.
    vault = assert_synthetic(tmp_path / "vault-exact")
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(ORIGINAL)
    record = provisioning.provision_gate_settings(
        vault,
        constants.ROLE_A,
        room=make_room(),
        run_id=RUN_ID,
        members=members_with(constants.SETTINGS_SHARED_FOLDER),
        control_probe=silent_control_probe,
    )
    assert record.shared_folder == constants.SETTINGS_SHARED_FOLDER
