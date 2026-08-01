# WP44 / AC3 — an unreconcilable pre-existing provisioning state is refused under
# PROVISION_CONFLICT, and nothing is written.
#
# The backup and the marker are two halves of one statement about the owner's
# file. When they disagree, the rig cannot know what the original was — and a rig
# that guesses here destroys data. The sanctioned outcome is a named refusal that
# leaves every byte where it was, so a human can look.
#
#   ├── T1 marker says hadOriginal, the backup hashes to something else → refuse.
#   ├── T2 marker says hadOriginal, there is no backup at all → refuse.
#   ├── T3 marker says there was no original, yet a backup exists → refuse.
#   ├── T4 the marker is unreadable → refuse.
#   └── T5 every refusal leaves data.json, the backup and the marker untouched.
#
# Data safety: fixture vault under tmp_path only.

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from obsidian_e2e import constants, ports

ORIGINAL_BYTES = (
    '{\n  "serverPassword": "FAKE-PASSWORD-NOT-REAL-0000",\n  "roomId": "fixture-room"\n}\n'
).encode("utf-8")
OTHER_BYTES = b'{\n  "roomId": "some-other-room"\n}\n'


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def marker_blob(*, had_original: bool, original_sha256: str | None) -> bytes:
    return json.dumps(
        {
            "runId": "20260801T000000Z-1234-abcdef",
            "role": constants.ROLE_A,
            "port": constants.REAL_CONTROL_PORT_A,
            "hadOriginal": had_original,
            "originalSha256": original_sha256,
            "pid": 1234,
            "createdAt": "2026-08-01T00:00:00+00:00",
        },
        indent=2,
    ).encode("utf-8")


def build_state(
    tmp_path: Path,
    name: str,
    *,
    settings: bytes | None,
    backup: bytes | None,
    marker: bytes | None,
) -> Path:
    vault = tmp_path / name
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    if settings is not None:
        (vault / constants.PLUGIN_DATA_REL).write_bytes(settings)
    if backup is not None:
        (vault / constants.SETTINGS_BACKUP_REL).write_bytes(backup)
    if marker is not None:
        (vault / constants.PROVISION_MARKER_REL).write_bytes(marker)
    return vault


def snapshot(vault: Path) -> dict[str, bytes | None]:
    out: dict[str, bytes | None] = {}
    for rel in (
        constants.PLUGIN_DATA_REL,
        constants.SETTINGS_BACKUP_REL,
        constants.PROVISION_MARKER_REL,
    ):
        path = vault / rel
        out[rel] = path.read_bytes() if path.is_file() else None
    return out


CASES = {
    # marker's recorded hash and the backup on disk disagree
    "hash_disagreement": dict(
        settings=ORIGINAL_BYTES,
        backup=OTHER_BYTES,
        marker=marker_blob(had_original=True, original_sha256=sha256_bytes(ORIGINAL_BYTES)),
    ),
    # marker claims an original, the backup is gone
    "backup_missing": dict(
        settings=ORIGINAL_BYTES,
        backup=None,
        marker=marker_blob(had_original=True, original_sha256=sha256_bytes(ORIGINAL_BYTES)),
    ),
    # marker claims there never was a file, yet a backup exists
    "unexpected_backup": dict(
        settings=ORIGINAL_BYTES,
        backup=ORIGINAL_BYTES,
        marker=marker_blob(had_original=False, original_sha256=None),
    ),
    # marker unreadable
    "marker_corrupt": dict(
        settings=ORIGINAL_BYTES,
        backup=ORIGINAL_BYTES,
        marker=b"{not json at all",
    ),
    # a backup with no marker: nothing says whether it is an original or debris
    "backup_without_marker": dict(
        settings=ORIGINAL_BYTES,
        backup=OTHER_BYTES,
        marker=None,
    ),
}


@pytest.mark.parametrize("label", sorted(CASES))
def test_an_unreconcilable_state_is_refused_and_nothing_is_written(
    tmp_path: Path, label: str
) -> None:
    vault = build_state(tmp_path, f"vault-{label}", **CASES[label])
    before = snapshot(vault)

    with pytest.raises(Exception) as excinfo:
        ports.provision_port(vault, constants.ROLE_A)

    assert getattr(excinfo.value, "reason", None) == constants.PROVISION_CONFLICT, (
        f"{label}: the refusal must name constants.PROVISION_CONFLICT"
    )
    assert snapshot(vault) == before, f"{label}: the refusal modified the vault"


def test_a_consistent_crashed_state_is_not_a_conflict(tmp_path: Path) -> None:
    # The discriminator: consistent leftovers are recoverable (AC3), only
    # contradictory ones are a conflict.
    vault = build_state(
        tmp_path,
        "vault-consistent",
        settings=ORIGINAL_BYTES,
        backup=ORIGINAL_BYTES,
        marker=marker_blob(had_original=True, original_sha256=sha256_bytes(ORIGINAL_BYTES)),
    )

    record = ports.provision_port(vault, constants.ROLE_A)

    assert record.had_original is True
    assert (vault / constants.SETTINGS_BACKUP_REL).read_bytes() == ORIGINAL_BYTES
    ports.restore_port(vault)
    assert (vault / constants.PLUGIN_DATA_REL).read_bytes() == ORIGINAL_BYTES


def test_the_conflict_message_leaks_no_settings_content(tmp_path: Path) -> None:
    vault = build_state(tmp_path, "vault-leak", **CASES["hash_disagreement"])

    with pytest.raises(Exception) as excinfo:
        ports.provision_port(vault, constants.ROLE_A)

    rendered = f"{excinfo.value!r} {excinfo.value}"
    assert "FAKE-PASSWORD-NOT-REAL-0000" not in rendered
