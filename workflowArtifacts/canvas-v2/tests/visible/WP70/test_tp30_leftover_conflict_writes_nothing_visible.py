# WP70 / obsidian-git precondition — "a contradictory leftover borrow is
# `COMMUNITY_PLUGINS_CONFLICT` with nothing written."
#
# Same discipline as WP44 AC3: the backup and the marker are two halves of ONE statement
# about what the owner had. When they disagree, the original is unknown, and guessing
# there is how data gets destroyed. Every case below fingerprints the whole `.obsidian`
# directory before the attempt and asserts it is unchanged afterwards.
#
#   ├── T1 a backup with no marker is a conflict, nothing written
#   ├── T2 a marker claiming an original whose backup is gone is a conflict
#   ├── T3 a backup whose sha256 disagrees with the marker is a conflict
#   ├── T4 a marker with the wrong field set is a conflict, not a missing marker
#   ├── T5 an unreadable marker is a conflict, not "no borrow in progress"
#   └── T6 a consistent leftover from a crashed run is ADOPTED, not refused
#
# DATA SAFETY: synthetic fixture vaults under tmp_path, guarded against both owner
# vaults.

from __future__ import annotations

import hashlib
import json
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

from obsidian_e2e import constants, provisioning  # noqa: E402

OWNER_VAULTS = (
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga"),
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie"),
)

RUN_ID = "20260804T000000Z-1-a1b2c3"
ORIGINAL = b'[\n\t"obsidian-git",\n\t"live-share"\n]'
ORIGINAL_SHA = hashlib.sha256(ORIGINAL).hexdigest()
DISABLED = b'[\n\t"live-share"\n]'


def assert_synthetic(path: Path) -> Path:
    resolved = Path(path).resolve()
    for owner in OWNER_VAULTS:
        owner_resolved = Path(owner).resolve()
        assert resolved != owner_resolved, f"ABORT: {resolved} is an owner vault"
        assert owner_resolved not in resolved.parents, f"ABORT: {resolved} is inside an owner vault"
        assert resolved not in owner_resolved.parents, f"ABORT: {resolved} contains an owner vault"
    return resolved


def make_vault(tmp_path: Path, name: str, live: bytes = ORIGINAL) -> Path:
    vault = assert_synthetic(tmp_path / name)
    (vault / ".obsidian").mkdir(parents=True, exist_ok=True)
    (vault / constants.COMMUNITY_PLUGINS_REL).write_bytes(live)
    return vault


def marker_blob(**overrides) -> bytes:
    marker = {
        "runId": RUN_ID,
        "role": constants.ROLE_A,
        "hadOriginal": True,
        "originalSha256": ORIGINAL_SHA,
        "originalSize": len(ORIGINAL),
        "disabled": list(constants.DISABLED_PLUGIN_IDS),
        "pid": 4242,
        "createdAt": "2026-08-04T00:00:00+00:00",
    }
    marker.update(overrides)
    return json.dumps(marker, indent=2).encode("utf-8") + b"\n"


def fingerprint(vault: Path) -> dict:
    return {
        p.relative_to(vault).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted((vault / ".obsidian").rglob("*"))
        if p.is_file()
    }


def refuse(vault: Path) -> provisioning.CommunityPluginsConflict:
    before = fingerprint(vault)
    with pytest.raises(provisioning.CommunityPluginsConflict) as excinfo:
        provisioning.disable_community_plugins(vault, constants.ROLE_A, run_id=RUN_ID)
    assert fingerprint(vault) == before, "the refusal wrote something"
    assert excinfo.value.reason == constants.COMMUNITY_PLUGINS_CONFLICT
    return excinfo.value


def test_a_backup_with_no_marker_is_a_conflict(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-orphan-backup")
    (vault / constants.COMMUNITY_PLUGINS_BACKUP_REL).write_bytes(ORIGINAL)
    refuse(vault)


def test_a_marker_whose_backup_is_gone_is_a_conflict(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-lost-backup", DISABLED)
    (vault / constants.COMMUNITY_PLUGINS_MARKER_REL).write_bytes(marker_blob())
    refuse(vault)


def test_a_backup_whose_sha_disagrees_with_the_marker_is_a_conflict(
    tmp_path: Path,
) -> None:
    vault = make_vault(tmp_path, "vault-sha-mismatch", DISABLED)
    (vault / constants.COMMUNITY_PLUGINS_BACKUP_REL).write_bytes(ORIGINAL + b"\n")
    (vault / constants.COMMUNITY_PLUGINS_MARKER_REL).write_bytes(marker_blob())
    refuse(vault)


def test_a_marker_with_the_wrong_field_set_is_a_conflict(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-bad-fields", DISABLED)
    (vault / constants.COMMUNITY_PLUGINS_BACKUP_REL).write_bytes(ORIGINAL)
    (vault / constants.COMMUNITY_PLUGINS_MARKER_REL).write_bytes(
        json.dumps({"runId": RUN_ID, "role": constants.ROLE_A}).encode("utf-8")
    )
    refuse(vault)


def test_an_unreadable_marker_is_a_conflict_not_a_missing_marker(tmp_path: Path) -> None:
    # "No borrow in progress" and "a borrow whose record is damaged" are exactly the
    # difference between proceeding and refusing.
    vault = make_vault(tmp_path, "vault-unreadable", DISABLED)
    (vault / constants.COMMUNITY_PLUGINS_BACKUP_REL).write_bytes(ORIGINAL)
    (vault / constants.COMMUNITY_PLUGINS_MARKER_REL).write_bytes(b"\x00\x01 not json {")
    refuse(vault)


def test_a_consistent_leftover_from_a_crashed_run_is_adopted(tmp_path: Path) -> None:
    # Without this, "refuse on leftovers" would make a crashed run unrecoverable —
    # the opposite of what the marker exists for.
    vault = make_vault(tmp_path, "vault-crashed", DISABLED)
    (vault / constants.COMMUNITY_PLUGINS_BACKUP_REL).write_bytes(ORIGINAL)
    (vault / constants.COMMUNITY_PLUGINS_MARKER_REL).write_bytes(marker_blob())

    record = provisioning.disable_community_plugins(vault, constants.ROLE_A, run_id="new-run")
    assert record.original_sha256 == ORIGINAL_SHA
    assert (vault / constants.COMMUNITY_PLUGINS_BACKUP_REL).read_bytes() == ORIGINAL

    provisioning.restore_community_plugins(vault)
    assert (vault / constants.COMMUNITY_PLUGINS_REL).read_bytes() == ORIGINAL
