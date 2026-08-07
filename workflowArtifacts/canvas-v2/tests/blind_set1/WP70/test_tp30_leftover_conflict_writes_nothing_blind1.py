# WP70 / obsidian-git precondition — blind counterpart 1 for "a contradictory leftover
# borrow of `community-plugins.json` is COMMUNITY_PLUGINS_CONFLICT with nothing written."
#
# Different angle from the visible set. The visible cases falsify the *presence* pairing
# (backup without marker, marker without backup, a whole marker that is unreadable). This
# one attacks the marker **field by field** and attacks the two numeric halves of the
# record **independently**:
#
#   ├── each pinned field of COMMUNITY_PLUGINS_MARKER_FIELDS removed in turn
#   ├── an extra field the pinned set does not name
#   ├── a size-only lie: the sha256 agrees, the byte length does not
#   ├── a sha-only lie: the byte length agrees, one hex digit does not
#   ├── a sha that agrees except in case — hex is not case-insensitive here
#   ├── `hadOriginal: false` contradicted by a present backup, and by a carried sha
#   ├── per-field type damage (runId, role, disabled, pid, createdAt)
#   └── a positive control: a CONSISTENT leftover is adopted and restores byte-exactly
#
# The fixture original is CRLF + four-space indent + a trailing CRLF, so the adoption
# control also proves the adopted bytes are not silently reserialised.
#
# DATA SAFETY: synthetic fixture vaults under tmp_path, guarded against both owner vaults.
# Every refusal is checked against a sha256 map of the WHOLE vault (files and directories),
# so a stray temp file or an empty directory counts as "something was written".

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

RUN_ID = "20260804T081500Z-70-b1f30a"

#: CRLF, four-space indent, trailing CRLF — none of it survives a parse-and-rewrite.
ORIGINAL = b'[\r\n    "obsidian-git",\r\n    "quickadd",\r\n    "live-share"\r\n]\r\n'
ORIGINAL_SHA = hashlib.sha256(ORIGINAL).hexdigest()

#: What the live file looks like mid-borrow (obsidian-git gone, reserialised by the rig).
MODIFIED = json.dumps(["quickadd", "live-share"], indent=2).encode("utf-8") + b"\n"

#: Never a real credential. If this string reaches a record, a marker or a message, the
#: S4 rule that no owner value leaves data.json has been broken.
SENTINEL = "s3nt1nel-blind1-tp30-do-not-leak"


def assert_synthetic(path: Path) -> Path:
    resolved = Path(path).resolve()
    for owner in OWNER_VAULTS:
        owner_resolved = Path(owner).resolve()
        assert resolved != owner_resolved, f"ABORT: {resolved} is an owner vault"
        assert owner_resolved not in resolved.parents, f"ABORT: {resolved} is inside an owner vault"
        assert resolved not in owner_resolved.parents, f"ABORT: {resolved} contains an owner vault"
    return resolved


def make_vault(tmp_path: Path, name: str, live: bytes = MODIFIED) -> Path:
    """A vault mid-borrow by default: the live list is the already-modified one."""
    vault = assert_synthetic(tmp_path / name)
    (vault / ".obsidian").mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(
        json.dumps({"serverPassword": SENTINEL, "jwt": SENTINEL}, indent=2).encode("utf-8")
    )
    (vault / constants.COMMUNITY_PLUGINS_REL).write_bytes(live)
    return vault


def base_marker() -> dict:
    return {
        "runId": RUN_ID,
        "role": constants.ROLE_B,
        "hadOriginal": True,
        "originalSha256": ORIGINAL_SHA,
        "originalSize": len(ORIGINAL),
        "disabled": list(constants.DISABLED_PLUGIN_IDS),
        "pid": 31337,
        "createdAt": "2026-08-04T08:15:00+00:00",
    }


def write_marker(vault: Path, marker) -> None:
    (vault / constants.COMMUNITY_PLUGINS_MARKER_REL).write_bytes(
        json.dumps(marker, indent=2).encode("utf-8") + b"\n"
    )


def write_backup(vault: Path, raw: bytes = ORIGINAL) -> None:
    (vault / constants.COMMUNITY_PLUGINS_BACKUP_REL).write_bytes(raw)


def fingerprint(vault: Path) -> dict:
    """Whole vault, files and directories — a stray temp file is also "something written"."""
    return {
        p.relative_to(vault).as_posix(): (
            "<dir>" if p.is_dir() else hashlib.sha256(p.read_bytes()).hexdigest()
        )
        for p in sorted(vault.rglob("*"))
    }


def refuse(vault: Path) -> provisioning.CommunityPluginsConflict:
    before = fingerprint(vault)
    with pytest.raises(provisioning.CommunityPluginsConflict) as excinfo:
        provisioning.disable_community_plugins(vault, constants.ROLE_B, run_id="run-after-crash")
    assert fingerprint(vault) == before, "the refusal wrote something"
    assert excinfo.value.reason == constants.COMMUNITY_PLUGINS_CONFLICT
    assert SENTINEL not in str(excinfo.value)
    return excinfo.value


# --- the pinned field set, one field at a time -------------------------------------


@pytest.mark.parametrize("field", constants.COMMUNITY_PLUGINS_MARKER_FIELDS)
def test_a_marker_missing_any_pinned_field_is_a_conflict(tmp_path: Path, field: str) -> None:
    vault = make_vault(tmp_path, f"vault-without-{field}")
    write_backup(vault)
    marker = base_marker()
    del marker[field]
    write_marker(vault, marker)
    refuse(vault)


def test_a_marker_carrying_a_field_the_pinned_set_does_not_name_is_a_conflict(
    tmp_path: Path,
) -> None:
    # A superset is as much "not the pinned record" as a subset: it was written by
    # something other than this rig, and what it means is unknown.
    vault = make_vault(tmp_path, "vault-extra-field")
    write_backup(vault)
    marker = base_marker()
    marker["restoredBy"] = "some other tool"
    write_marker(vault, marker)
    refuse(vault)


def test_a_marker_that_is_not_an_object_is_a_conflict(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-array-marker")
    write_backup(vault)
    write_marker(vault, [base_marker()])
    refuse(vault)


def test_a_json_null_marker_is_a_conflict_not_an_absent_marker(tmp_path: Path) -> None:
    # `json.loads(b"null")` is a successful parse producing None. "Parsed fine" and
    # "there is no borrow" are different statements.
    vault = make_vault(tmp_path, "vault-null-marker")
    write_backup(vault)
    (vault / constants.COMMUNITY_PLUGINS_MARKER_REL).write_bytes(b"null\n")
    refuse(vault)


def test_an_empty_marker_file_is_a_conflict_not_an_absent_marker(tmp_path: Path) -> None:
    # A zero-byte marker is the signature of a crash between create and write.
    vault = make_vault(tmp_path, "vault-empty-marker")
    write_backup(vault)
    (vault / constants.COMMUNITY_PLUGINS_MARKER_REL).write_bytes(b"")
    refuse(vault)


# --- the two numeric halves, falsified independently -------------------------------


def test_a_size_only_lie_is_a_conflict(tmp_path: Path) -> None:
    """sha256 agrees, byte length does not — an implementation that checks only the hash
    accepts this and then reports a length it never verified."""
    vault = make_vault(tmp_path, "vault-size-lie")
    write_backup(vault)
    marker = base_marker()
    marker["originalSize"] = len(ORIGINAL) + 1
    write_marker(vault, marker)
    refuse(vault)


def test_a_sha_only_lie_is_a_conflict(tmp_path: Path) -> None:
    """Byte length agrees, one hex digit does not — the mirror image of the above."""
    vault = make_vault(tmp_path, "vault-sha-lie")
    write_backup(vault)
    marker = base_marker()
    head = "0" if ORIGINAL_SHA[0] != "0" else "1"
    marker["originalSha256"] = head + ORIGINAL_SHA[1:]
    assert len(marker["originalSha256"]) == 64
    write_marker(vault, marker)
    refuse(vault)


def test_a_sha_that_differs_only_in_case_is_a_conflict(tmp_path: Path) -> None:
    # hexdigest() is lower case. An upper-case digest is a record this rig did not write,
    # and "close enough" is not a category the borrow has.
    vault = make_vault(tmp_path, "vault-sha-case")
    marker = base_marker()
    marker["originalSha256"] = ORIGINAL_SHA.upper()
    if marker["originalSha256"] == ORIGINAL_SHA:  # pragma: no cover - all-digit digest
        pytest.skip("this fixture's digest has no hex letters to re-case")
    write_backup(vault)
    write_marker(vault, marker)
    refuse(vault)


def test_a_truncated_sha_is_a_conflict(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-sha-short")
    write_backup(vault)
    marker = base_marker()
    marker["originalSha256"] = ORIGINAL_SHA[:63]
    write_marker(vault, marker)
    refuse(vault)


# --- `hadOriginal: false` contradicted -----------------------------------------------


def test_no_original_claimed_but_a_backup_is_present_is_a_conflict(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-none-yet-backup")
    write_backup(vault)
    marker = base_marker()
    marker.update(hadOriginal=False, originalSha256=None, originalSize=None)
    write_marker(vault, marker)
    refuse(vault)


def test_no_original_claimed_yet_a_sha_is_carried_is_a_conflict(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-none-yet-sha")
    marker = base_marker()
    marker.update(hadOriginal=False, originalSize=None)
    write_marker(vault, marker)
    refuse(vault)


@pytest.mark.parametrize("value", [1, 0, "true", "false", None, [], {}])
def test_a_non_boolean_hadOriginal_is_a_conflict(tmp_path: Path, value) -> None:
    vault = make_vault(tmp_path, f"vault-hadoriginal-{type(value).__name__}-{value!r:.6}")
    write_backup(vault)
    marker = base_marker()
    marker["hadOriginal"] = value
    write_marker(vault, marker)
    refuse(vault)


# --- per-field type damage ------------------------------------------------------------

TYPE_DAMAGE = {
    "runId_null": ("runId", None),
    "runId_number": ("runId", 20260804),
    "role_null": ("role", None),
    "role_object": ("role", {"role": constants.ROLE_A}),
    "disabled_as_bare_string": ("disabled", "obsidian-git"),
    "disabled_null": ("disabled", None),
    "disabled_nested": ("disabled", [["obsidian-git"]]),
    "pid_as_string": ("pid", "31337"),
    "pid_null": ("pid", None),
    "createdAt_null": ("createdAt", None),
    "createdAt_number": ("createdAt", 1785000000),
    "originalSize_as_string": ("originalSize", str(len(ORIGINAL))),
    "originalSize_null_with_original": ("originalSize", None),
    "originalSize_negative": ("originalSize", -len(ORIGINAL)),
}


@pytest.mark.parametrize("label", sorted(TYPE_DAMAGE))
def test_a_marker_field_with_the_wrong_type_is_a_conflict(tmp_path: Path, label: str) -> None:
    """The pinned field *set* is not the whole record — a field of the wrong type is a
    damaged record, and a damaged record is not a statement about what the owner had."""
    field, value = TYPE_DAMAGE[label]
    vault = make_vault(tmp_path, f"vault-{label}")
    write_backup(vault)
    marker = base_marker()
    marker[field] = value
    write_marker(vault, marker)
    refuse(vault)


# --- the refusal is not indiscriminate ------------------------------------------------


def test_a_consistent_leftover_is_adopted_and_its_exotic_bytes_survive(tmp_path: Path) -> None:
    """Without this, "refuse on leftovers" would make a crashed run unrecoverable — and
    the adopted backup must be handed back byte for byte, CRLFs and all."""
    vault = make_vault(tmp_path, "vault-consistent")
    write_backup(vault)
    write_marker(vault, base_marker())

    record = provisioning.disable_community_plugins(
        vault, constants.ROLE_A, run_id="a-later-run"
    )
    assert record.had_original is True
    assert record.original_sha256 == ORIGINAL_SHA
    assert record.original_size == len(ORIGINAL)
    assert record.adopted_existing_backup is True
    assert (vault / constants.COMMUNITY_PLUGINS_BACKUP_REL).read_bytes() == ORIGINAL

    result = provisioning.restore_community_plugins(vault)
    assert result.restored is True
    restored = (vault / constants.COMMUNITY_PLUGINS_REL).read_bytes()
    assert len(restored) == len(ORIGINAL)
    assert hashlib.sha256(restored).hexdigest() == ORIGINAL_SHA
    assert restored == ORIGINAL
    assert not (vault / constants.COMMUNITY_PLUGINS_MARKER_REL).exists()
    assert not (vault / constants.COMMUNITY_PLUGINS_BACKUP_REL).exists()


def test_the_adopted_run_leaks_no_sentinel_into_record_or_marker(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-noleak")
    write_backup(vault)
    write_marker(vault, base_marker())

    record = provisioning.disable_community_plugins(vault, constants.ROLE_A, run_id="quiet-run")
    assert SENTINEL not in repr(record)
    marker_raw = (vault / constants.COMMUNITY_PLUGINS_MARKER_REL).read_bytes()
    assert SENTINEL.encode("utf-8") not in marker_raw
    assert b"obsidian-git" not in (vault / constants.COMMUNITY_PLUGINS_REL).read_bytes()
    assert (vault / constants.PLUGIN_DATA_REL).read_bytes().count(SENTINEL.encode("utf-8")) == 2


def test_fixture_audit_the_fixtures_really_are_contradictory() -> None:
    assert ORIGINAL != MODIFIED
    assert hashlib.sha256(MODIFIED).hexdigest() != ORIGINAL_SHA
    assert b"\r\n" in ORIGINAL and not ORIGINAL.endswith(b"]")
    assert json.dumps(json.loads(ORIGINAL.decode("utf-8")), indent=2).encode("utf-8") != ORIGINAL
    assert base_marker()["originalSize"] == len(ORIGINAL)
    assert set(base_marker()) == set(constants.COMMUNITY_PLUGINS_MARKER_FIELDS)
