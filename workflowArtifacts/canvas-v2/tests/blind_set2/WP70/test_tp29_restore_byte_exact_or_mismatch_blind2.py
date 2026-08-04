# WP70 / obsidian-git precondition — blind counterpart 2 for "restore is byte-exact
# (sha256 + byte length) and a non-byte-exact restore is
# COMMUNITY_PLUGINS_RESTORE_MISMATCH".
#
# Different angle: BOTH halves of the oracle are falsified independently. A backup that is
# one byte shorter, one byte longer, and one of the same length with one byte changed —
# a length check alone misses the third, a hash check alone would be enough but the
# criterion names both, so both are exercised.
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

from obsidian_e2e import constants, provisioning  # noqa: E402

OWNER_VAULTS = (
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga"),
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie"),
)

RUN_ID = "20260803T025959Z-44-8899aa"
ORIGINAL = b'[\n\t"obsidian-git",\n\t"dataview",\n\t"live-share"\n]'

TAMPERED = {
    "one_byte_shorter": ORIGINAL[:-1],
    "one_byte_longer": ORIGINAL + b"\n",
    "same_length_one_byte_changed": ORIGINAL.replace(b"dataview", b"datavieW"),
    "empty": b"",
    "reordered_same_length": ORIGINAL.replace(
        b'"dataview",\n\t"live-share"', b'"live-share",\n\t"dataview"'
    ),
}


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
    (vault / ".obsidian").mkdir(parents=True, exist_ok=True)
    (vault / constants.COMMUNITY_PLUGINS_REL).write_bytes(ORIGINAL)
    return vault


@pytest.mark.parametrize("label", sorted(TAMPERED))
def test_every_tampered_backup_is_refused(tmp_path: Path, label: str) -> None:
    vault = make_vault(tmp_path, f"vault-{label}")
    provisioning.disable_community_plugins(vault, constants.ROLE_A, run_id=RUN_ID)
    during = (vault / constants.COMMUNITY_PLUGINS_REL).read_bytes()
    (vault / constants.COMMUNITY_PLUGINS_BACKUP_REL).write_bytes(TAMPERED[label])

    with pytest.raises(provisioning.CommunityPluginsRestoreMismatch) as excinfo:
        provisioning.restore_community_plugins(vault)

    assert excinfo.value.reason == constants.COMMUNITY_PLUGINS_RESTORE_MISMATCH
    assert (vault / constants.COMMUNITY_PLUGINS_REL).read_bytes() == during, (
        f"{label}: the refused restore wrote anyway"
    )


def test_fixture_audit_the_tampered_copies_differ_in_the_right_ways() -> None:
    assert len(TAMPERED["one_byte_shorter"]) == len(ORIGINAL) - 1
    assert len(TAMPERED["one_byte_longer"]) == len(ORIGINAL) + 1
    assert len(TAMPERED["same_length_one_byte_changed"]) == len(ORIGINAL)
    assert len(TAMPERED["reordered_same_length"]) == len(ORIGINAL)
    for label, raw in TAMPERED.items():
        assert hashlib.sha256(raw).hexdigest() != hashlib.sha256(ORIGINAL).hexdigest(), label


def test_an_untampered_backup_restores_cleanly(tmp_path: Path) -> None:
    # Without this, "every backup is refused" would pass for a restore that never works.
    vault = make_vault(tmp_path, "vault-clean")
    provisioning.disable_community_plugins(vault, constants.ROLE_B, run_id=RUN_ID)
    result = provisioning.restore_community_plugins(vault)
    assert result.restored is True
    assert result.restored_sha256 == hashlib.sha256(ORIGINAL).hexdigest()
    assert (vault / constants.COMMUNITY_PLUGINS_REL).read_bytes() == ORIGINAL


def test_the_refusal_message_names_sizes_and_hashes_not_content(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-message")
    provisioning.disable_community_plugins(vault, constants.ROLE_A, run_id=RUN_ID)
    (vault / constants.COMMUNITY_PLUGINS_BACKUP_REL).write_bytes(TAMPERED["empty"])

    with pytest.raises(provisioning.CommunityPluginsRestoreMismatch) as excinfo:
        provisioning.restore_community_plugins(vault)
    message = str(excinfo.value)
    assert "obsidian-git" not in message
    assert "dataview" not in message
    assert str(len(ORIGINAL)) in message or "sha256" in message.lower()


def test_the_backup_and_marker_survive_a_refused_restore(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-evidence")
    provisioning.disable_community_plugins(vault, constants.ROLE_A, run_id=RUN_ID)
    (vault / constants.COMMUNITY_PLUGINS_BACKUP_REL).write_bytes(TAMPERED["one_byte_longer"])

    with pytest.raises(provisioning.CommunityPluginsRestoreMismatch):
        provisioning.restore_community_plugins(vault)
    assert (vault / constants.COMMUNITY_PLUGINS_BACKUP_REL).is_file()
    assert (vault / constants.COMMUNITY_PLUGINS_MARKER_REL).is_file()
