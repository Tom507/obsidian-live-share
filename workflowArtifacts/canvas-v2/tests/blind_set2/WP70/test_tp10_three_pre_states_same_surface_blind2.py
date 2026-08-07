# WP70 / AC2 — blind counterpart 2 for "the rig does not assume the two vaults' stored
# values agree, are empty, or are equal — provisioning succeeds from three different
# pre-states and lands the same narrowed surface".
#
# Different angle: the two vaults differ in FILE SHAPE as well as in value — one is
# tab-indented CRLF, the other is minified — and one of them has no settings file at all.
# The narrowed surface must be identical across all three shapes while each vault's own
# bytes come back untouched.
#
# DATA SAFETY: synthetic fixture vaults under tmp_path, guarded against both owner vaults.

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

RUN_ID = "20260804T060606Z-16-ccddee"

SHAPE_A = b'{\r\n\t"sharedFolder": "Alles/Geteilt",\r\n\t"excludePatterns": ["*.pdf"]\r\n}'
SHAPE_B = b'{"sharedFolder":"","excludePatterns":[],"clientId":"min"}'


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


def make_vault(tmp_path: Path, name: str, raw) -> Path:
    vault = assert_synthetic(tmp_path / name)
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    if raw is not None:
        (vault / constants.PLUGIN_DATA_REL).write_bytes(raw)
    return vault


def make_room() -> relay.RelayRoom:
    return relay.RelayRoom(
        id="7a7a7a7a-8b8b-9c9c-adad-bebecfcfd0d0",
        token="SENTINEL-BLIND2-TOKEN",
        name=f"{constants.RELAY_ROOM_NAME_PREFIX}{RUN_ID}",
        base_url=constants.RELAY_BASE_URL,
    )


def read(vault: Path) -> dict:
    return json.loads((vault / constants.PLUGIN_DATA_REL).read_bytes().decode("utf-8-sig"))


def test_three_differently_shaped_vaults_land_one_identical_surface(
    tmp_path: Path,
) -> None:
    room = make_room()
    crlf = make_vault(tmp_path, "crlf-vault", SHAPE_A)
    mini = make_vault(tmp_path, "mini-vault - Kopie", SHAPE_B)
    absent = make_vault(tmp_path, "absent-vault", None)

    provisioning.provision_gate_settings(
        crlf, constants.ROLE_A, room=room, run_id=RUN_ID, control_probe=silent_control_probe
    )
    provisioning.provision_gate_settings(
        mini, constants.ROLE_B, room=room, run_id=RUN_ID, control_probe=silent_control_probe
    )
    provisioning.provision_gate_settings(
        absent, constants.ROLE_A, room=room, run_id=RUN_ID, control_probe=silent_control_probe
    )

    surfaces = {
        (read(v)["sharedFolder"], tuple(read(v)["excludePatterns"]))
        for v in (crlf, mini, absent)
    }
    assert surfaces == {(constants.SCRATCH_FOLDER, ())}


def test_each_shape_comes_back_untouched(tmp_path: Path) -> None:
    room = make_room()
    crlf = make_vault(tmp_path, "crlf-restore", SHAPE_A)
    mini = make_vault(tmp_path, "mini-restore", SHAPE_B)
    absent = make_vault(tmp_path, "absent-restore", None)

    for vault, role in ((crlf, constants.ROLE_A), (mini, constants.ROLE_B), (absent, constants.ROLE_A)):
        provisioning.provision_gate_settings(
            vault, role, room=room, run_id=RUN_ID, control_probe=silent_control_probe
        )
        provisioning.restore_gate_settings(vault)

    assert (crlf / constants.PLUGIN_DATA_REL).read_bytes() == SHAPE_A
    assert (mini / constants.PLUGIN_DATA_REL).read_bytes() == SHAPE_B
    assert not (absent / constants.PLUGIN_DATA_REL).exists()


def test_the_two_roles_still_differ_in_exactly_the_role_dependent_members(
    tmp_path: Path,
) -> None:
    room = make_room()
    a = make_vault(tmp_path, "role-a", SHAPE_A)
    b = make_vault(tmp_path, "role-b", SHAPE_A)
    provisioning.provision_gate_settings(
        a, constants.ROLE_A, room=room, run_id=RUN_ID, control_probe=silent_control_probe
    )
    provisioning.provision_gate_settings(
        b, constants.ROLE_B, room=room, run_id=RUN_ID, control_probe=silent_control_probe
    )

    left, right = read(a), read(b)
    differing = {k for k in constants.PROVISIONED_SETTINGS_KEYS if left[k] != right[k]}
    assert differing == {"e2eControlPort", "role"}
    assert left["role"] == constants.SETTINGS_ROLE_HOST
    assert right["role"] == constants.SETTINGS_ROLE_GUEST


def test_fixture_audit_the_two_shapes_really_differ(tmp_path: Path) -> None:
    assert b"\r\n" in SHAPE_A and b"\r\n" not in SHAPE_B
    assert b"\t" in SHAPE_A and b"\t" not in SHAPE_B
    assert json.loads(SHAPE_A.decode("utf-8"))["sharedFolder"] != json.loads(
        SHAPE_B.decode("utf-8")
    )["sharedFolder"]
