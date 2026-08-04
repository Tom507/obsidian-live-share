# WP70 / AC2 — blind counterpart 2 for the FALSIFICATION: "a provisioning that leaves
# `sharedFolder` empty must be refused under SHARED_SURFACE_NOT_ESTABLISHED, not silently
# accepted".
#
# Different angle: the EXCLUDE side of the same criterion, and wrong TYPES. An
# `excludePatterns` that is a string, a dict, `null`, or a list containing an empty
# pattern is not "an empty list", and every one of them can exclude the scratch folder
# from a surface that now contains only it — a shared surface containing nothing.
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

RUN_ID = "20260804T040404Z-18-eeff00"
ORIGINAL = b'{\n  "clientId": "fixture-excludes"\n}\n'

BAD_EXCLUDES = (
    ["*"],
    ["_e2e-rig/**"],
    [""],
    "",
    "none",
    None,
    {},
    ["a", "b"],
)
BAD_SHARED = (None, 0, False, [], {}, "   ")


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
        id="5c5c5c5c-6d6d-7e7e-8f8f-909001011212",
        token="SENTINEL-BLIND2-TOKEN",
        name=f"{constants.RELAY_ROOM_NAME_PREFIX}{RUN_ID}",
        base_url=constants.RELAY_BASE_URL,
    )


def doctored(**overrides) -> dict:
    members = provisioning.gate_settings_members(role=constants.ROLE_B, room=make_room())
    members.update(overrides)
    return members


def make_vault(tmp_path: Path, name: str) -> Path:
    vault = assert_synthetic(tmp_path / name)
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(ORIGINAL)
    return vault


def digest_dir(vault: Path) -> dict:
    return {
        p.name: hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted((vault / constants.PLUGIN_DIR_REL).iterdir())
        if p.is_file()
    }


@pytest.mark.parametrize("value", BAD_EXCLUDES, ids=lambda v: repr(v)[:24])
def test_a_non_empty_or_wrongly_typed_exclude_list_is_refused(value) -> None:
    with pytest.raises(provisioning.SharedSurfaceNotEstablished):
        provisioning.verify_shared_surface(doctored(excludePatterns=value))


@pytest.mark.parametrize("value", BAD_SHARED, ids=lambda v: repr(v)[:24])
def test_a_wrongly_typed_shared_folder_is_refused(value) -> None:
    with pytest.raises(provisioning.SharedSurfaceNotEstablished):
        provisioning.verify_shared_surface(doctored(sharedFolder=value))


def test_the_refusal_writes_nothing_through_the_provisioning_path(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-excludes")
    before = digest_dir(vault)
    with pytest.raises(provisioning.SharedSurfaceNotEstablished) as excinfo:
        provisioning.provision_gate_settings(
            vault,
            constants.ROLE_B,
            room=make_room(),
            run_id=RUN_ID,
            members=doctored(excludePatterns=["*"]),
            control_probe=silent_control_probe,
        )
    assert excinfo.value.reason == constants.SHARED_SURFACE_NOT_ESTABLISHED
    assert digest_dir(vault) == before
    assert (vault / constants.PLUGIN_DATA_REL).read_bytes() == ORIGINAL


def test_the_pinned_empty_list_is_accepted() -> None:
    # Without this, the refusals would pass for a validator that refuses everything.
    assert provisioning.verify_shared_surface(doctored(excludePatterns=[])) is None
    assert provisioning.verify_shared_surface(doctored()) is None


def test_the_refusal_is_a_named_reason_not_a_bare_exception() -> None:
    with pytest.raises(provisioning.SharedSurfaceNotEstablished) as excinfo:
        provisioning.verify_shared_surface(doctored(sharedFolder=""))
    assert excinfo.value.reason in constants.FAILURE_REASONS
    assert type(excinfo.value) is not RuntimeError
