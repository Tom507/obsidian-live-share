# WP70 / obsidian-git precondition — blind counterpart 1 for "capture -> modify ->
# restore -> independently verified restore of `community-plugins.json`".
#
# Different data: a vault whose enabled list contains ONLY `obsidian-git`, so the
# disabled state is the empty list — the shape where "write the filtered list" and "write
# nothing" look the same. The verification oracle is a copy of the bytes taken by the test
# into its own tmp directory before the rig ran.
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

from obsidian_e2e import constants, provisioning  # noqa: E402

OWNER_VAULTS = (
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga"),
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie"),
)

RUN_ID = "20260803T075959Z-39-334455"
ONLY_GIT = b'[\n  "obsidian-git"\n]\n'


def assert_synthetic(path: Path) -> Path:
    resolved = Path(path).resolve()
    for owner in OWNER_VAULTS:
        owner_resolved = Path(owner).resolve()
        assert resolved != owner_resolved, f"ABORT: {resolved} is an owner vault"
        assert owner_resolved not in resolved.parents, f"ABORT: {resolved} is inside an owner vault"
        assert resolved not in owner_resolved.parents, f"ABORT: {resolved} contains an owner vault"
    return resolved


def make_vault(tmp_path: Path, name: str, raw: bytes = ONLY_GIT) -> Path:
    vault = assert_synthetic(tmp_path / name)
    (vault / ".obsidian").mkdir(parents=True, exist_ok=True)
    (vault / constants.COMMUNITY_PLUGINS_REL).write_bytes(raw)
    return vault


def test_a_single_entry_list_becomes_an_empty_list(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "only-git")
    provisioning.disable_community_plugins(vault, constants.ROLE_A, run_id=RUN_ID)
    parsed = json.loads((vault / constants.COMMUNITY_PLUGINS_REL).read_bytes().decode("utf-8"))
    assert parsed == []


def test_the_independent_copy_is_reproduced_byte_for_byte(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "independent")
    # The oracle: a copy the TEST takes, in a place the rig knows nothing about.
    oracle = tmp_path / "oracle" / "community-plugins.json"
    oracle.parent.mkdir(parents=True, exist_ok=True)
    oracle.write_bytes((vault / constants.COMMUNITY_PLUGINS_REL).read_bytes())

    provisioning.disable_community_plugins(vault, constants.ROLE_B, run_id=RUN_ID)
    provisioning.restore_community_plugins(vault)

    after = (vault / constants.COMMUNITY_PLUGINS_REL).read_bytes()
    assert after == oracle.read_bytes()
    assert hashlib.sha256(after).hexdigest() == hashlib.sha256(oracle.read_bytes()).hexdigest()


def test_the_record_reports_the_empty_enabled_list(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "record")
    record = provisioning.disable_community_plugins(vault, constants.ROLE_A, run_id=RUN_ID)
    assert tuple(record.enabled_after) == ()
    assert record.disabled == ("obsidian-git",)
    assert record.had_original is True


def test_a_vault_with_no_community_plugins_file_is_handled(tmp_path: Path) -> None:
    vault = assert_synthetic(tmp_path / "no-file")
    (vault / ".obsidian").mkdir(parents=True, exist_ok=True)

    record = provisioning.disable_community_plugins(vault, constants.ROLE_A, run_id=RUN_ID)
    assert record.had_original is False
    assert record.original_sha256 is None

    provisioning.restore_community_plugins(vault)
    assert not (vault / constants.COMMUNITY_PLUGINS_REL).exists(), (
        "teardown left a file where the owner had none"
    )
    assert not (vault / constants.COMMUNITY_PLUGINS_MARKER_REL).exists()


def test_the_borrow_leaves_exactly_two_rig_artefacts_and_removes_both(
    tmp_path: Path,
) -> None:
    vault = make_vault(tmp_path, "artefacts")
    before = sorted(p.name for p in (vault / ".obsidian").iterdir())

    provisioning.disable_community_plugins(vault, constants.ROLE_A, run_id=RUN_ID)
    during = sorted(p.name for p in (vault / ".obsidian").iterdir())
    assert len(during) == len(before) + 2

    provisioning.restore_community_plugins(vault)
    assert sorted(p.name for p in (vault / ".obsidian").iterdir()) == before
