# WP70 / AC2 — "`sharedFolder` is provisioned to the rig-owned scratch folder WP47
# already owns … `excludePatterns` is provisioned empty so no owner-side pattern can
# exclude the scratch folder from a surface that now contains only it."
#
# The important half of this is that the value is the CONSTANT and not a re-spelling of
# it. Hard-won rule 10: a second spelling of `_e2e-rig` in `provisioning.py` would make
# a later rename of `SCRATCH_FOLDER` silently produce a shared surface that does not
# contain the scratch canvas — a vacuous green in the gate itself.
#
#   ├── T1 SETTINGS_SHARED_FOLDER *is* SCRATCH_FOLDER, by identity, not by equality
#   ├── T2 the provisioned file's sharedFolder equals the constant
#   ├── T3 excludePatterns is provisioned as an EMPTY JSON list, not absent, not null
#   ├── T4 the scratch canvas path for the run is inside the provisioned shared folder
#   ├── T5 no module under tools/obsidian_e2e/ re-spells the folder literal
#   └── T6 the record states the shared folder and the empty pattern list
#
# DATA SAFETY: synthetic fixture vaults under tmp_path, guarded against both owner
# vaults. Sentinel credential values only.

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

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

# The owner has a real, non-empty shared surface and their own exclude patterns.
ORIGINAL = (
    b"{\n"
    b'  "sharedFolder": "Projekte/Team",\n'
    b'  "excludePatterns": ["*.tmp", "Archiv/**"],\n'
    b'  "clientId": "fixture-client"\n'
    b"}\n"
)


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
        name=f"{constants.RELAY_ROOM_NAME_PREFIX}{RUN_ID}",
        base_url=constants.RELAY_BASE_URL,
    )


def provisioned_settings(tmp_path: Path, name: str, role: str) -> dict:
    vault = make_vault(tmp_path, name, ORIGINAL)
    provisioning.provision_gate_settings(vault, role, room=make_room(), run_id=RUN_ID, control_probe=silent_control_probe)
    return json.loads((vault / constants.PLUGIN_DATA_REL).read_bytes().decode("utf-8-sig"))

def test_the_pinned_shared_folder_is_the_scratch_folder_constant_itself() -> None:
    # `is` and not `==`: an equal-but-separately-spelled string is exactly the drift
    # this assertion exists to catch.
    assert constants.SETTINGS_SHARED_FOLDER is constants.SCRATCH_FOLDER


def test_the_provisioned_shared_folder_equals_the_constant(tmp_path: Path) -> None:
    parsed = provisioned_settings(tmp_path, "vault-a", constants.ROLE_A)
    assert parsed["sharedFolder"] == constants.SCRATCH_FOLDER
    assert parsed["sharedFolder"] != "", "an empty sharedFolder means the WHOLE vault is shared"
    assert parsed["sharedFolder"] != "Projekte/Team", "the owner's surface was not narrowed"


def test_exclude_patterns_is_provisioned_as_an_empty_list(tmp_path: Path) -> None:
    parsed = provisioned_settings(tmp_path, "vault-b", constants.ROLE_B)
    assert "excludePatterns" in parsed, "the empty list was skipped rather than written"
    assert parsed["excludePatterns"] == []
    assert isinstance(parsed["excludePatterns"], list)
    assert parsed["excludePatterns"] is not None


def test_the_runs_scratch_canvas_is_inside_the_provisioned_shared_folder(
    tmp_path: Path,
) -> None:
    parsed = provisioned_settings(tmp_path, "vault-scratch", constants.ROLE_A)
    scratch = constants.scratch_rel_path(RUN_ID)
    assert scratch.startswith(parsed["sharedFolder"] + "/"), (
        "the scratch canvas is outside the shared surface — every matrix case would "
        "converge trivially"
    )


def test_no_rig_module_re_spells_the_scratch_folder_literal() -> None:
    package = _TOOLS / "obsidian_e2e"
    literal = re.compile(re.escape(f'"{constants.SCRATCH_FOLDER}"'))
    literal_single = re.compile(re.escape(f"'{constants.SCRATCH_FOLDER}'"))
    offenders = []
    for module in sorted(package.glob("*.py")):
        if module.name == "constants.py":
            continue
        text = module.read_text(encoding="utf-8")
        if literal.search(text) or literal_single.search(text):
            offenders.append(module.name)
    assert offenders == [], f"the scratch folder literal is re-spelled in {offenders}"


def test_the_record_states_the_shared_folder_and_the_empty_pattern_list(
    tmp_path: Path,
) -> None:
    vault = make_vault(tmp_path, "vault-record", ORIGINAL)
    record = provisioning.provision_gate_settings(
        vault, constants.ROLE_A, room=make_room(), run_id=RUN_ID
    , control_probe=silent_control_probe)
    assert record.shared_folder == constants.SCRATCH_FOLDER
    assert tuple(record.exclude_patterns) == ()
