# WP44 / AC2 (blind 1) — the mismatch seen from the marker's side.
#
# Angle: the visible set damages the backup. Here the recorded fingerprint is what
# drifts — a marker whose originalSha256 was written wrong, truncated, upper-cased
# or nulled while the backup is perfectly intact. The verdict must be the same
# named refusal: the rig cannot prove the bytes it is about to write are the
# owner's bytes, so it does not write them.

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import pytest

# T3_SharedContract import rule: `import tools.…` resolves to the WORKSPACE `tools`
# package (a regular package always beats a namespace portion), never to this repo's.
# Put <repo>/tools on sys.path and import by the globally unique package name.
_TOOLS = Path(__file__).resolve().parents[5] / "tools"
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, ports  # noqa: E402

ORIGINAL = (
    '{\n\t"serverPassword": "FAKE-PW-BLIND1-6666",\n\t"roomId": "blind-room"\n}\n'
).encode("utf-8")
GOOD_SHA = hashlib.sha256(ORIGINAL).hexdigest()


def provision_then_edit_marker(tmp_path: Path, name: str, patch: dict) -> Path:
    vault = tmp_path / name
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(ORIGINAL)
    ports.provision_port(vault, constants.ROLE_A)

    marker_path = vault / constants.PROVISION_MARKER_REL
    marker = json.loads(marker_path.read_bytes().decode("utf-8"))
    marker.update(patch)
    marker_path.write_bytes(json.dumps(marker, indent=2).encode("utf-8"))
    return vault


# A well-formed fingerprint that simply does not describe the backup is a CONTENT
# failure — the restore would not be byte-exact, which is AC2's own named reason.
WELL_FORMED_BUT_WRONG = {
    "wrong_hash": {"originalSha256": "0" * 64},
    "uppercased_hash": {"originalSha256": GOOD_SHA.upper()},
}

# A fingerprint that is not a fingerprint at all is a STRUCTURAL failure: half the
# borrow record is unusable. Either named reason is defensible there, so the
# assertion is on the guarantee that matters — a named refusal and no write.
MALFORMED_RECORD = {
    "truncated_hash": {"originalSha256": GOOD_SHA[:32]},
    "nulled_hash": {"originalSha256": None},
    "numeric_hash": {"originalSha256": 12345},
}


@pytest.mark.parametrize("label", sorted(WELL_FORMED_BUT_WRONG))
def test_a_fingerprint_that_does_not_describe_the_backup_is_refused(
    tmp_path: Path, label: str
) -> None:
    vault = provision_then_edit_marker(tmp_path, f"v-{label}", WELL_FORMED_BUT_WRONG[label])
    settings_path = vault / constants.PLUGIN_DATA_REL
    provisioned = settings_path.read_bytes()

    with pytest.raises(Exception) as excinfo:
        ports.restore_port(vault)

    assert getattr(excinfo.value, "reason", None) == constants.SETTINGS_RESTORE_MISMATCH, label
    assert settings_path.read_bytes() == provisioned, f"{label}: the file was written anyway"
    assert (vault / constants.SETTINGS_BACKUP_REL).read_bytes() == ORIGINAL
    assert (vault / constants.PROVISION_MARKER_REL).is_file()


@pytest.mark.parametrize("label", sorted(MALFORMED_RECORD))
def test_an_unusable_fingerprint_is_refused_under_a_named_reason(
    tmp_path: Path, label: str
) -> None:
    vault = provision_then_edit_marker(tmp_path, f"v-{label}", MALFORMED_RECORD[label])
    settings_path = vault / constants.PLUGIN_DATA_REL
    provisioned = settings_path.read_bytes()

    with pytest.raises(Exception) as excinfo:
        ports.restore_port(vault)

    assert getattr(excinfo.value, "reason", None) in {
        constants.SETTINGS_RESTORE_MISMATCH,
        constants.PROVISION_CONFLICT,
    }, f"{label}: the abort must name a reason from constants.py"
    assert settings_path.read_bytes() == provisioned, f"{label}: the file was written anyway"
    assert (vault / constants.SETTINGS_BACKUP_REL).read_bytes() == ORIGINAL
    assert (vault / constants.PROVISION_MARKER_REL).is_file()


def test_a_repeated_failed_restore_changes_nothing(tmp_path: Path) -> None:
    vault = provision_then_edit_marker(tmp_path, "v-repeat", {"originalSha256": "f" * 64})
    settings_path = vault / constants.PLUGIN_DATA_REL
    provisioned = settings_path.read_bytes()

    for _ in range(3):
        with pytest.raises(Exception) as excinfo:
            ports.restore_port(vault)
        assert getattr(excinfo.value, "reason", None) == constants.SETTINGS_RESTORE_MISMATCH

    assert settings_path.read_bytes() == provisioned
    assert (vault / constants.SETTINGS_BACKUP_REL).read_bytes() == ORIGINAL


def test_repairing_the_marker_makes_the_restore_succeed_again(tmp_path: Path) -> None:
    # The refusal must be recoverable by hand — that is the point of leaving the
    # backup and the marker in place.
    vault = provision_then_edit_marker(tmp_path, "v-repair", {"originalSha256": "a" * 64})
    with pytest.raises(Exception):
        ports.restore_port(vault)

    marker_path = vault / constants.PROVISION_MARKER_REL
    marker = json.loads(marker_path.read_bytes().decode("utf-8"))
    marker["originalSha256"] = GOOD_SHA
    marker_path.write_bytes(json.dumps(marker, indent=2).encode("utf-8"))

    result = ports.restore_port(vault)

    assert result.restored is True
    assert (vault / constants.PLUGIN_DATA_REL).read_bytes() == ORIGINAL
    assert not (vault / constants.SETTINGS_BACKUP_REL).exists()
    assert not marker_path.exists()
