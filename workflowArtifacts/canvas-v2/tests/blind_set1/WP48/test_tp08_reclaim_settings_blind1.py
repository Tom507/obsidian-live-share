"""WP48 · TP08 (blind 1) — the crashed run had NO original settings file.

Angle: `hadOriginal: false`. The rig created `data.json` itself, so reclaim must
DELETE it rather than restore anything, and leave no file behind. Also covers a
marker whose recorded sha256 does not match the backup on disk.

DATA SAFETY: fixture vault under `tmp_path`; settings bytes are only ever hashed.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path


def _tools_dir() -> Path:
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "tools").is_dir() and (parent / "plugin").is_dir():
            return parent / "tools"
    raise RuntimeError(f"obsidian-live-share repo root not found above {here}")


sys.path.insert(0, str(_tools_dir()))

from obsidian_e2e import constants, teardown  # noqa: E402


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def _marker(**over) -> bytes:
    base = {
        "runId": "20260801T101500Z-777-ffee11",
        "role": constants.ROLE_B,
        "port": constants.REAL_CONTROL_PORT_B,
        "hadOriginal": False,
        "originalSha256": None,
        "pid": 777,
        "createdAt": "2026-08-01T10:15:00Z",
    }
    base.update(over)
    return json.dumps(base).encode("utf-8")


def test_rig_created_settings_file_is_removed_leaving_no_file_behind(tmp_path: Path) -> None:
    vault = tmp_path / "VaultNoOriginal"
    _write(vault / "Notes" / "a.md", b"keep me\n")
    _write(vault / constants.PLUGIN_DATA_REL, b'{"e2eControlPort":39432}\n')
    _write(vault / constants.PROVISION_MARKER_REL, _marker())

    report = teardown.reclaim_stale_state(vault)

    assert not (vault / constants.PLUGIN_DATA_REL).exists()
    assert not (vault / constants.PROVISION_MARKER_REL).exists()
    assert not (vault / constants.SETTINGS_BACKUP_REL).exists()
    assert (vault / "Notes" / "a.md").read_bytes() == b"keep me\n"
    settings = [a for a in report.artefacts if a.kind == teardown.RECLAIM_KIND_SETTINGS]
    assert len(settings) == 1 and settings[0].reclaimed is True


def test_backup_that_does_not_match_the_recorded_hash_is_not_silently_applied(
    tmp_path: Path,
) -> None:
    vault = tmp_path / "VaultBadHash"
    original = b'{"roomId":"fixture-room"}\n'
    corrupted = b'{"roomId":"fixture-room","truncat'
    _write(vault / constants.PLUGIN_DATA_REL, b'{"roomId":"fixture-room","e2eControlPort":39432}\n')
    _write(vault / constants.SETTINGS_BACKUP_REL, corrupted)
    _write(
        vault / constants.PROVISION_MARKER_REL,
        _marker(hadOriginal=True, originalSha256=_sha(original)),
    )

    report = teardown.reclaim_stale_state(vault)

    settings = [a for a in report.artefacts if a.kind == teardown.RECLAIM_KIND_SETTINGS]
    assert len(settings) == 1
    assert settings[0].reclaimed is False
    assert settings[0].reason == constants.SETTINGS_RESTORE_MISMATCH
    # nothing was destroyed: the backup survives for a human to inspect
    assert (vault / constants.SETTINGS_BACKUP_REL).read_bytes() == corrupted
    assert json.dumps(report.to_dict()).find("roomId") == -1


def test_marker_without_a_backup_but_claiming_an_original_is_reported_not_guessed(
    tmp_path: Path,
) -> None:
    vault = tmp_path / "VaultMissingBackup"
    _write(vault / constants.PLUGIN_DATA_REL, b'{"e2eControlPort":39432}\n')
    _write(
        vault / constants.PROVISION_MARKER_REL,
        _marker(hadOriginal=True, originalSha256=_sha(b"whatever")),
    )

    report = teardown.reclaim_stale_state(vault)

    settings = [a for a in report.artefacts if a.kind == teardown.RECLAIM_KIND_SETTINGS]
    assert len(settings) == 1
    assert settings[0].reclaimed is False
    assert settings[0].reason == constants.SETTINGS_RESTORE_MISMATCH
    # the rig must not fall back to deleting a file it may not have created
    assert (vault / constants.PLUGIN_DATA_REL).exists()
