# WP70 / obsidian-git precondition — blind counterpart 2 for "a contradictory leftover
# borrow of `community-plugins.json` is COMMUNITY_PLUGINS_CONFLICT with nothing written."
#
# Different angle again. Counterpart 1 damages the marker's *fields*; the visible set
# falsifies the *presence* pairing. This one builds whole leftover **situations** a crashed
# or half-repaired run actually leaves behind, and then asserts each of them is refused
# from BOTH doors — `disable_community_plugins` and `restore_community_plugins` — with the
# vault byte-identical after either attempt. A guard on only the entry door still lets a
# teardown restore from a file nobody can attribute.
#
#   ├── the backup was overwritten by the already-modified list (the classic crash bug)
#   ├── an orphan backup that is empty, and one whose live file is gone entirely
#   ├── a marker recording no original while a backup sits next to it
#   ├── a marker recording an original whose backup AND live file are both gone
#   └── a marker naming a `disabled` set this rig never writes — adopted or refused?
#
# plus two positive controls (a consistent leftover from the *other* role is adopted; a
# consistent `hadOriginal: false` leftover is adopted too) and a cross-vault independence
# check: refusing in one vault must not touch the vault next to it.
#
# The fixture list is single-line, space-padded, with no trailing newline — a shape a
# parse-and-rewrite destroys, so "adopted" and "reserialised" cannot be confused.
#
# DATA SAFETY: synthetic fixture vaults under tmp_path, guarded against both owner vaults.

from __future__ import annotations

import hashlib
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

from obsidian_e2e import constants, provisioning  # noqa: E402

OWNER_VAULTS = (
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga"),
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie"),
)

RUN_ID = "20260804T093000Z-70-2c9d1e"

#: One line, padded, no trailing newline. Nothing about this survives json.dumps().
ORIGINAL = b'[ "obsidian-git" ,  "periodic-notes" ,  "live-share" ]'
ORIGINAL_SHA = hashlib.sha256(ORIGINAL).hexdigest()

#: What the rig leaves in the live file while the borrow is open.
MODIFIED = json.dumps(["periodic-notes", "live-share"], indent=2).encode("utf-8") + b"\n"
MODIFIED_SHA = hashlib.sha256(MODIFIED).hexdigest()

SENTINEL = "s3nt1nel-blind2-tp30-do-not-leak"

WP70_REASONS = (
    constants.COMMUNITY_PLUGINS_CONFLICT,
    constants.COMMUNITY_PLUGINS_RESTORE_MISMATCH,
)


def assert_synthetic(path: Path) -> Path:
    resolved = Path(path).resolve()
    for owner in OWNER_VAULTS:
        owner_resolved = Path(owner).resolve()
        assert resolved != owner_resolved, f"ABORT: {resolved} is an owner vault"
        assert owner_resolved not in resolved.parents, f"ABORT: {resolved} is inside an owner vault"
        assert resolved not in owner_resolved.parents, f"ABORT: {resolved} contains an owner vault"
    return resolved


def marker_dict(**overrides) -> dict:
    marker = {
        "runId": RUN_ID,
        "role": constants.ROLE_A,
        "hadOriginal": True,
        "originalSha256": ORIGINAL_SHA,
        "originalSize": len(ORIGINAL),
        "disabled": list(constants.DISABLED_PLUGIN_IDS),
        "pid": 909090,
        "createdAt": "2026-08-04T09:30:00+00:00",
    }
    marker.update(overrides)
    return marker


def skeleton(tmp_path: Path, name: str) -> Path:
    """An .obsidian tree with a note, a plugin dir and a sentinel-only data.json."""
    vault = assert_synthetic(tmp_path / name)
    (vault / ".obsidian").mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(
        json.dumps({"encryptionPassphrase": SENTINEL, "jwt": SENTINEL}).encode("utf-8")
    )
    (vault / ".obsidian" / "appearance.json").write_bytes(b'{\n  "theme": "obsidian"\n}\n')
    (vault / "a note.md").write_bytes(b"# owner content\r\n")
    return vault


def put(vault: Path, *, live=None, backup=None, marker=None) -> Path:
    if live is not None:
        (vault / constants.COMMUNITY_PLUGINS_REL).write_bytes(live)
    if backup is not None:
        (vault / constants.COMMUNITY_PLUGINS_BACKUP_REL).write_bytes(backup)
    if marker is not None:
        (vault / constants.COMMUNITY_PLUGINS_MARKER_REL).write_bytes(
            json.dumps(marker, indent=2).encode("utf-8") + b"\n"
        )
    return vault


# --- the leftover situations ----------------------------------------------------------
#
# Each builder returns a vault in one contradictory state. Nothing about these is derivable
# from the visible fixtures by renaming: they differ in which of the three files exist, in
# what the backup *contains*, and in what the marker claims about it.

def state_backup_overwritten_by_the_modified_list(tmp_path: Path) -> Path:
    # The failure mode the "write the backup once, never again" rule exists to prevent:
    # a re-entrant run saved the already-disabled list over the owner's original. The
    # marker still records the original, so the two halves disagree and the original is
    # gone — the one situation where guessing destroys the owner's list for good.
    vault = skeleton(tmp_path, "vault-backup-clobbered")
    return put(vault, live=MODIFIED, backup=MODIFIED, marker=marker_dict())


def state_orphan_empty_backup(tmp_path: Path) -> Path:
    # A zero-byte backup with no marker: a crash between create and write. "Empty" is not
    # "absent", and it is certainly not "the owner had no plugins enabled".
    vault = skeleton(tmp_path, "vault-orphan-empty")
    return put(vault, live=ORIGINAL, backup=b"")


def state_orphan_backup_and_no_live_file(tmp_path: Path) -> Path:
    # A backup, no marker, and no live list at all. Copying the backup into place would be
    # a guess about a file whose provenance nothing states.
    vault = skeleton(tmp_path, "vault-orphan-no-live")
    return put(vault, backup=ORIGINAL)


def state_marker_says_none_but_a_backup_exists(tmp_path: Path) -> Path:
    vault = skeleton(tmp_path, "vault-none-with-backup")
    return put(
        vault,
        live=MODIFIED,
        backup=ORIGINAL,
        marker=marker_dict(hadOriginal=False, originalSha256=None, originalSize=None),
    )


def state_marker_with_neither_backup_nor_live_file(tmp_path: Path) -> Path:
    vault = skeleton(tmp_path, "vault-nothing-left")
    return put(vault, marker=marker_dict())


CONTRADICTORY = {
    "backup_overwritten_by_the_modified_list": state_backup_overwritten_by_the_modified_list,
    "orphan_empty_backup": state_orphan_empty_backup,
    "orphan_backup_and_no_live_file": state_orphan_backup_and_no_live_file,
    "marker_says_none_but_a_backup_exists": state_marker_says_none_but_a_backup_exists,
    "marker_with_neither_backup_nor_live_file": state_marker_with_neither_backup_nor_live_file,
}


def fingerprint(vault: Path) -> dict:
    return {
        p.relative_to(vault).as_posix(): (
            "<dir>" if p.is_dir() else hashlib.sha256(p.read_bytes()).hexdigest()
        )
        for p in sorted(vault.rglob("*"))
    }


@pytest.mark.parametrize("label", sorted(CONTRADICTORY))
def test_the_entry_door_refuses_every_contradictory_leftover(tmp_path: Path, label: str) -> None:
    vault = CONTRADICTORY[label](tmp_path)
    before = fingerprint(vault)

    with pytest.raises(provisioning.CommunityPluginsConflict) as excinfo:
        provisioning.disable_community_plugins(vault, constants.ROLE_B, run_id="the-next-run")

    assert excinfo.value.reason == constants.COMMUNITY_PLUGINS_CONFLICT
    assert fingerprint(vault) == before, f"{label}: the refusal wrote something"


@pytest.mark.parametrize("label", sorted(CONTRADICTORY))
def test_the_teardown_door_refuses_every_contradictory_leftover(
    tmp_path: Path, label: str
) -> None:
    """A guard on `disable` alone still lets a teardown restore from an unattributable
    file. Both doors see the same contradiction, so both must refuse — and neither may
    write on the way out."""
    vault = CONTRADICTORY[label](tmp_path)
    before = fingerprint(vault)

    with pytest.raises(provisioning.ProvisionError) as excinfo:
        provisioning.restore_community_plugins(vault)

    assert excinfo.value.reason in WP70_REASONS
    assert fingerprint(vault) == before, f"{label}: the refused restore wrote something"


@pytest.mark.parametrize("label", sorted(CONTRADICTORY))
def test_no_refusal_message_carries_owner_content_or_the_sentinel(
    tmp_path: Path, label: str
) -> None:
    vault = CONTRADICTORY[label](tmp_path)
    with pytest.raises(provisioning.CommunityPluginsConflict) as excinfo:
        provisioning.disable_community_plugins(vault, constants.ROLE_A, run_id="quiet-run")
    message = str(excinfo.value)
    assert SENTINEL not in message
    assert "periodic-notes" not in message


# --- a marker this rig never wrote ------------------------------------------------------

FOREIGN_DISABLED = {
    "names_a_plugin_the_rig_never_disables": ["dataview"],
    "names_nothing_at_all": [],
    "names_more_than_the_rig_disables": ["obsidian-git", "dataview"],
    "is_a_bare_string": "obsidian-git",
}


@pytest.mark.parametrize("label", sorted(FOREIGN_DISABLED))
def test_a_leftover_whose_disabled_set_is_not_the_rigs_is_a_conflict(
    tmp_path: Path, label: str
) -> None:
    """Adoption means trusting a record about what the owner had. The rig only ever writes
    `DISABLED_PLUGIN_IDS`, so a marker naming a different set was written by something
    else — adopting it is guessing, not recovering."""
    vault = skeleton(tmp_path, f"vault-foreign-{label}")
    put(vault, live=MODIFIED, backup=ORIGINAL, marker=marker_dict(disabled=FOREIGN_DISABLED[label]))
    before = fingerprint(vault)

    with pytest.raises(provisioning.CommunityPluginsConflict) as excinfo:
        provisioning.disable_community_plugins(vault, constants.ROLE_A, run_id="the-next-run")

    assert excinfo.value.reason == constants.COMMUNITY_PLUGINS_CONFLICT
    assert fingerprint(vault) == before, f"{label}: the refusal wrote something"


# --- the refusal is not indiscriminate ---------------------------------------------------


def test_a_consistent_leftover_from_the_other_role_is_adopted(tmp_path: Path) -> None:
    """A crashed host run must be recoverable by the next run, whichever role it takes —
    otherwise the marker makes crashes permanent instead of survivable."""
    vault = skeleton(tmp_path, "vault-crashed-host")
    put(vault, live=MODIFIED, backup=ORIGINAL, marker=marker_dict(role=constants.ROLE_A))

    record = provisioning.disable_community_plugins(vault, constants.ROLE_B, run_id="run-two")
    assert record.role == constants.ROLE_B
    assert record.had_original is True
    assert record.original_sha256 == ORIGINAL_SHA
    assert record.adopted_existing_backup is True
    assert (vault / constants.COMMUNITY_PLUGINS_BACKUP_REL).read_bytes() == ORIGINAL

    result = provisioning.restore_community_plugins(vault)
    assert result.restored is True
    assert result.restored_size == len(ORIGINAL)
    assert (vault / constants.COMMUNITY_PLUGINS_REL).read_bytes() == ORIGINAL


def test_a_consistent_leftover_that_records_no_original_is_adopted(tmp_path: Path) -> None:
    """The other consistent leftover: the owner had no enabled-plugin list at all when the
    crashed run started. Nothing to back up, nothing to restore — and still not a conflict."""
    vault = skeleton(tmp_path, "vault-crashed-no-list")
    put(vault, marker=marker_dict(hadOriginal=False, originalSha256=None, originalSize=None))

    record = provisioning.disable_community_plugins(vault, constants.ROLE_A, run_id="run-two")
    assert record.had_original is False
    assert record.original_sha256 is None
    assert not (vault / constants.COMMUNITY_PLUGINS_BACKUP_REL).exists()

    result = provisioning.restore_community_plugins(vault)
    assert result.restored is True
    assert result.had_original is False
    assert not (vault / constants.COMMUNITY_PLUGINS_REL).exists()
    assert not (vault / constants.COMMUNITY_PLUGINS_MARKER_REL).exists()


def test_a_refusal_in_one_vault_does_not_touch_the_vault_beside_it(tmp_path: Path) -> None:
    """Both vaults are the owner's live working vaults. A refusal is about one of them."""
    broken = state_backup_overwritten_by_the_modified_list(tmp_path)
    intact = skeleton(tmp_path, "vault-intact")
    put(intact, live=ORIGINAL)
    before_intact = fingerprint(intact)
    before_broken = fingerprint(broken)

    with pytest.raises(provisioning.CommunityPluginsConflict):
        provisioning.disable_community_plugins(broken, constants.ROLE_A, run_id="the-next-run")

    assert fingerprint(intact) == before_intact
    assert fingerprint(broken) == before_broken
    assert (intact / constants.COMMUNITY_PLUGINS_REL).read_bytes() == ORIGINAL


def test_fixture_audit_each_situation_really_is_contradictory(tmp_path: Path) -> None:
    assert ORIGINAL != MODIFIED and ORIGINAL_SHA != MODIFIED_SHA
    assert json.dumps(json.loads(ORIGINAL.decode("utf-8")), indent=2).encode("utf-8") != ORIGINAL
    assert not ORIGINAL.endswith(b"\n")

    clobbered = state_backup_overwritten_by_the_modified_list(tmp_path)
    backup = (clobbered / constants.COMMUNITY_PLUGINS_BACKUP_REL).read_bytes()
    assert hashlib.sha256(backup).hexdigest() != marker_dict()["originalSha256"]

    for label, builder in sorted(CONTRADICTORY.items()):
        vault = builder(tmp_path / f"audit-{label}")
        present = {
            "live": (vault / constants.COMMUNITY_PLUGINS_REL).exists(),
            "backup": (vault / constants.COMMUNITY_PLUGINS_BACKUP_REL).exists(),
            "marker": (vault / constants.COMMUNITY_PLUGINS_MARKER_REL).exists(),
        }
        assert present["backup"] or present["marker"], f"{label}: nothing left over to refuse"
