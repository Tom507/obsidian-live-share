# WP70 / obsidian-git precondition (Dispatcher ruling 2026-08-04) — capture, modify,
# restore, and INDEPENDENTLY VERIFIED restore of `.obsidian/community-plugins.json`.
#
# `community-plugins.json` is Obsidian's *enabled* list, byte-identical in both vaults,
# containing exactly `["obsidian-git", "live-share"]`. It is a DIFFERENT file and a
# DIFFERENT borrow from WP44's `data.json`, so it lives in its own namespace with its own
# marker — putting a second borrow inside `ports.py`, whose whole invariant is one borrow
# over one file, is the shape AC1 exists to forbid.
#
# "Independently verified" means the test computes the oracle itself, from bytes captured
# before the rig ran, and never asks the rig whether the rig succeeded.
#
#   ├── T1 the borrow captures the original into its own backup, and marks it
#   ├── T2 the live file really changes in between — a no-op borrow must not pass
#   ├── T3 restore reproduces the bytes the TEST captured, not the ones the rig reports
#   ├── T4 the marker carries the pinned field set and no file content
#   ├── T5 the namespace is disjoint from WP44's and WP69's — three borrows, no collisions
#   └── T6 a second borrow adopts the first backup instead of overwriting it
#
# DATA SAFETY: synthetic fixture vaults under tmp_path, guarded against both owner
# vaults. The list contents are plugin ids, not credentials, but nothing is echoed.

from __future__ import annotations

import hashlib
import json
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

from obsidian_e2e import constants, provisioning  # noqa: E402

OWNER_VAULTS = (
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga"),
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie"),
)

RUN_ID = "20260804T000000Z-1-a1b2c3"

# The owner's measured shape: tab-indented, no trailing newline. Both formatting
# properties are destroyed by a json round trip, which is what makes T3 meaningful.
ORIGINAL = b'[\n\t"obsidian-git",\n\t"live-share"\n]'
ORIGINAL_SHA = hashlib.sha256(ORIGINAL).hexdigest()


def assert_synthetic(path: Path) -> Path:
    resolved = Path(path).resolve()
    for owner in OWNER_VAULTS:
        owner_resolved = Path(owner).resolve()
        assert resolved != owner_resolved, f"ABORT: {resolved} is an owner vault"
        assert owner_resolved not in resolved.parents, f"ABORT: {resolved} is inside an owner vault"
        assert resolved not in owner_resolved.parents, f"ABORT: {resolved} contains an owner vault"
    return resolved


def make_vault(tmp_path: Path, name: str, community: bytes = ORIGINAL) -> Path:
    vault = assert_synthetic(tmp_path / name)
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (vault / ".obsidian").mkdir(parents=True, exist_ok=True)
    (vault / constants.COMMUNITY_PLUGINS_REL).write_bytes(community)
    return vault


def test_the_borrow_captures_the_original_and_marks_it(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-capture")
    record = provisioning.disable_community_plugins(vault, constants.ROLE_A, run_id=RUN_ID)

    backup = vault / constants.COMMUNITY_PLUGINS_BACKUP_REL
    marker = vault / constants.COMMUNITY_PLUGINS_MARKER_REL
    assert backup.is_file() and marker.is_file()
    assert backup.read_bytes() == ORIGINAL
    assert record.had_original is True
    assert record.original_sha256 == ORIGINAL_SHA
    assert record.original_size == len(ORIGINAL)
    assert record.disabled == constants.DISABLED_PLUGIN_IDS


def test_the_live_file_really_changes_in_between(tmp_path: Path) -> None:
    # Without this, every restore assertion would pass for a do-nothing borrow.
    vault = make_vault(tmp_path, "vault-changes")
    provisioning.disable_community_plugins(vault, constants.ROLE_A, run_id=RUN_ID)
    during = (vault / constants.COMMUNITY_PLUGINS_REL).read_bytes()
    assert during != ORIGINAL
    assert b"obsidian-git" not in during


def test_restore_reproduces_the_bytes_the_test_captured(tmp_path: Path) -> None:
    # The oracle is computed here, from bytes read before the rig ran. The rig's own
    # RestoreResult is checked separately and is never the thing that proves the restore.
    vault = make_vault(tmp_path, "vault-restore")
    path = vault / constants.COMMUNITY_PLUGINS_REL
    captured = path.read_bytes()
    captured_sha = hashlib.sha256(captured).hexdigest()

    provisioning.disable_community_plugins(vault, constants.ROLE_B, run_id=RUN_ID)
    result = provisioning.restore_community_plugins(vault)

    after = path.read_bytes()
    assert len(after) == len(captured)
    assert hashlib.sha256(after).hexdigest() == captured_sha
    assert after == captured
    assert result.restored is True
    assert result.restored_sha256 == captured_sha


def test_the_marker_carries_the_pinned_field_set_and_no_file_content(
    tmp_path: Path,
) -> None:
    vault = make_vault(tmp_path, "vault-marker")
    provisioning.disable_community_plugins(vault, constants.ROLE_A, run_id=RUN_ID)

    raw = (vault / constants.COMMUNITY_PLUGINS_MARKER_REL).read_bytes().decode("utf-8")
    marker = json.loads(raw)
    assert tuple(marker) == constants.COMMUNITY_PLUGINS_MARKER_FIELDS
    assert marker["originalSha256"] == ORIGINAL_SHA
    assert marker["originalSize"] == len(ORIGINAL)
    assert marker["disabled"] == list(constants.DISABLED_PLUGIN_IDS)
    assert marker["runId"] == RUN_ID
    # A fingerprint, never a copy: the original's own bytes must not be in the marker.
    assert ORIGINAL.decode("utf-8") not in raw


def test_the_namespace_is_disjoint_from_the_other_two_borrows() -> None:
    paths = {
        constants.SETTINGS_BACKUP_REL,
        constants.PROVISION_MARKER_REL,
        constants.BUNDLE_BACKUP_REL,
        constants.INSTALL_MARKER_REL,
        constants.COMMUNITY_PLUGINS_BACKUP_REL,
        constants.COMMUNITY_PLUGINS_MARKER_REL,
    }
    assert len(paths) == 6, "two borrow namespaces collide"
    assert constants.COMMUNITY_PLUGINS_BACKUP_REL.startswith(".obsidian/")
    assert not constants.COMMUNITY_PLUGINS_BACKUP_REL.startswith(constants.PLUGIN_DIR_REL)
    assert constants.COMMUNITY_PLUGINS_BACKUP_REL == ".obsidian/community-plugins.json.e2e-original"
    assert constants.COMMUNITY_PLUGINS_MARKER_REL == ".obsidian/.e2e-community-plugins.json"


def test_a_second_borrow_adopts_the_first_backup(tmp_path: Path) -> None:
    # Same idempotence rule as WP44 §4 and WP69 §4.1: the backup IS the original and is
    # never overwritten by the already-modified state.
    vault = make_vault(tmp_path, "vault-twice")
    provisioning.disable_community_plugins(vault, constants.ROLE_A, run_id=RUN_ID)
    second = provisioning.disable_community_plugins(vault, constants.ROLE_A, run_id=RUN_ID)

    assert (vault / constants.COMMUNITY_PLUGINS_BACKUP_REL).read_bytes() == ORIGINAL
    assert second.original_sha256 == ORIGINAL_SHA
    provisioning.restore_community_plugins(vault)
    assert (vault / constants.COMMUNITY_PLUGINS_REL).read_bytes() == ORIGINAL
