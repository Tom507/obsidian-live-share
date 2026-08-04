# WP70 / AC2 — FALSIFICATION. "`isSharedPath` treats an empty `sharedFolder` as *the
# whole vault shared*, `resumeSession` publishes the host's manifest with `purge: true`,
# and the guest's `cleanupStaleFiles` **trashes every shared local file absent from that
# manifest** — so a run against an unconstrained shared surface can destroy the owner's
# files in the second vault."
#
# AC2 is a SAFETY criterion. The tests that show it working are worth little without the
# one that shows it cannot be bypassed: a provisioning whose member set would leave
# `sharedFolder` empty must be REFUSED under `SHARED_SURFACE_NOT_ESTABLISHED`, with the
# vault byte-identical afterwards — not written and then complained about.
#
#   ├── T1 an empty sharedFolder in the member set is refused, and nothing is written
#   ├── T2 a whitespace-only / "/" / "." sharedFolder is refused the same way
#   ├── T3 a non-empty excludePatterns is refused — it can exclude the scratch folder
#   ├── T4 a member set missing `sharedFolder` entirely is refused
#   ├── T5 verify_shared_surface accepts exactly the pinned surface and nothing else
#   └── T6 the refusal names SHARED_SURFACE_NOT_ESTABLISHED and leaks no settings value
#
# DATA SAFETY: synthetic fixture vaults under tmp_path, guarded against both owner
# vaults. Sentinel credential values only.

from __future__ import annotations

import hashlib
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
RUN_ID = "20260804T000000Z-1-a1b2c3"
ORIGINAL = b'{\n  "sharedFolder": "Projekte/Team",\n  "clientId": "fixture-client"\n}\n'


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
        id="11111111-2222-3333-4444-555555555555",
        token=SENTINEL_ROOM_TOKEN,
        name=f"{constants.RELAY_ROOM_NAME_PREFIX}{RUN_ID}",
        base_url=constants.RELAY_BASE_URL,
    )


def doctored(**overrides) -> dict:
    members = provisioning.gate_settings_members(role=constants.ROLE_A, room=make_room())
    members.update(overrides)
    return members


def plugin_dir_fingerprint(vault: Path) -> dict:
    directory = vault / constants.PLUGIN_DIR_REL
    return {
        path.name: hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(directory.iterdir())
        if path.is_file()
    }


def refuse(tmp_path: Path, name: str, members: dict) -> provisioning.SharedSurfaceNotEstablished:
    vault = make_vault(tmp_path, name)
    before = plugin_dir_fingerprint(vault)
    with pytest.raises(provisioning.SharedSurfaceNotEstablished) as excinfo:
        provisioning.provision_gate_settings(
            vault, constants.ROLE_A, room=make_room(), run_id=RUN_ID, members=members
        , control_probe=silent_control_probe)
    assert plugin_dir_fingerprint(vault) == before, "the refused provisioning wrote anyway"
    assert (vault / constants.PLUGIN_DATA_REL).read_bytes() == ORIGINAL
    assert not (vault / constants.SETTINGS_BACKUP_REL).exists()
    assert not (vault / constants.PROVISION_MARKER_REL).exists()
    assert excinfo.value.reason == constants.SHARED_SURFACE_NOT_ESTABLISHED
    return excinfo.value

def test_an_empty_shared_folder_is_refused_and_nothing_is_written(tmp_path: Path) -> None:
    refuse(tmp_path, "vault-empty", doctored(sharedFolder=""))


@pytest.mark.parametrize("value", ["   ", "\t", "/", ".", "./", "**"])
def test_a_degenerate_shared_folder_is_refused_the_same_way(
    tmp_path: Path, value: str
) -> None:
    # Each of these is "the whole vault" or "unbounded" in `isSharedPath` terms; none of
    # them is the rig-owned scratch folder, and all of them re-open the blast radius.
    refuse(tmp_path, f"vault-degenerate-{abs(hash(value)) % 10_000}", doctored(sharedFolder=value))


def test_a_non_empty_exclude_pattern_list_is_refused(tmp_path: Path) -> None:
    # An owner-side pattern can exclude the scratch folder from a surface that now
    # contains only it — which is a shared surface containing nothing.
    refuse(tmp_path, "vault-excludes", doctored(excludePatterns=["_e2e-rig/**"]))


def test_a_member_set_missing_shared_folder_entirely_is_refused(tmp_path: Path) -> None:
    members = doctored()
    members.pop("sharedFolder")
    vault = make_vault(tmp_path, "vault-missing-key")
    with pytest.raises(Exception) as excinfo:
        provisioning.provision_gate_settings(
            vault, constants.ROLE_A, room=make_room(), run_id=RUN_ID, members=members
        , control_probe=silent_control_probe)
    assert not (vault / constants.PROVISION_MARKER_REL).exists()
    assert (vault / constants.PLUGIN_DATA_REL).read_bytes() == ORIGINAL
    assert isinstance(excinfo.value, (provisioning.SharedSurfaceNotEstablished, ValueError))


def test_verify_shared_surface_accepts_exactly_the_pinned_surface() -> None:
    good = provisioning.gate_settings_members(role=constants.ROLE_B, room=make_room())
    assert provisioning.verify_shared_surface(good) is None

    for bad in ({"sharedFolder": ""}, {"sharedFolder": "Notizen"}, {"excludePatterns": ["*"]}):
        members = provisioning.gate_settings_members(role=constants.ROLE_B, room=make_room())
        members.update(bad)
        with pytest.raises(provisioning.SharedSurfaceNotEstablished):
            provisioning.verify_shared_surface(members)


def test_the_refusal_leaks_no_settings_value(tmp_path: Path) -> None:
    error = refuse(tmp_path, "vault-quiet-refusal", doctored(sharedFolder=""))
    message = f"{error}{error!r}"
    assert SENTINEL_ROOM_TOKEN not in message
    assert "fixture-client" not in message
    assert "Projekte/Team" not in message
