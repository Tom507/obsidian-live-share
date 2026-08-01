"""WP48 · TP08 (blind 2) — byte-exactness under awkward bytes.

Angle: the saved original is not tidy JSON-with-a-trailing-newline. It has CRLF
line endings, a BOM, trailing whitespace and a byte sequence that is not valid
UTF-8. A restore that re-serialises, re-encodes or "normalises" changes the hash
and fails here — which is the point: settings are borrowed, not rewritten.

DATA SAFETY: fixture vault under `tmp_path`; only hashes and sizes are asserted,
never content.
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

# BOM + CRLF + trailing spaces + a lone 0xFF byte inside a string value.
AWKWARD_ORIGINAL = (
    b"\xef\xbb\xbf{\r\n"
    b'  "roomId": "fixture",\r\n'
    b'  "blob": "\xff\xfe-not-utf8",\r\n'
    b'  "nested": {"a": 1}   \r\n'
    b"}\r\n\r\n"
)
PROVISIONED = AWKWARD_ORIGINAL.replace(b'"nested"', b'"e2eControlPort": 39431, "nested"')


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def _build(tmp_path: Path) -> Path:
    vault = tmp_path / "Vault With Spaces"
    _write(vault / "Notes" / "n.md", b"x")
    _write(vault / constants.PLUGIN_DATA_REL, PROVISIONED)
    _write(vault / constants.SETTINGS_BACKUP_REL, AWKWARD_ORIGINAL)
    _write(
        vault / constants.PROVISION_MARKER_REL,
        json.dumps(
            {
                "runId": "20260801T120000Z-31337-0f0f0f",
                "role": constants.ROLE_A,
                "port": constants.REAL_CONTROL_PORT_A,
                "hadOriginal": True,
                "originalSha256": _sha(AWKWARD_ORIGINAL),
                "pid": 31337,
                "createdAt": "2026-08-01T12:00:00Z",
            }
        ).encode("utf-8"),
    )
    return vault


def test_restore_is_byte_identical_not_merely_json_equivalent(tmp_path: Path) -> None:
    vault = _build(tmp_path)
    assert _sha(PROVISIONED) != _sha(AWKWARD_ORIGINAL)

    teardown.reclaim_stale_state(vault)

    restored = (vault / constants.PLUGIN_DATA_REL).read_bytes()
    assert _sha(restored) == _sha(AWKWARD_ORIGINAL)
    assert len(restored) == len(AWKWARD_ORIGINAL)


def test_vault_path_containing_spaces_is_handled(tmp_path: Path) -> None:
    vault = _build(tmp_path)
    assert " " in vault.name

    report = teardown.reclaim_stale_state(vault)

    assert report.actions >= 1
    assert not (vault / constants.PROVISION_MARKER_REL).exists()


def test_only_the_plugin_directory_is_written(tmp_path: Path) -> None:
    vault = _build(tmp_path)
    outside = {
        p.relative_to(vault).as_posix(): _sha(p.read_bytes())
        for p in sorted(vault.rglob("*"))
        if p.is_file() and ".obsidian" not in p.parts
    }

    teardown.reclaim_stale_state(vault)

    after = {
        p.relative_to(vault).as_posix(): _sha(p.read_bytes())
        for p in sorted(vault.rglob("*"))
        if p.is_file() and ".obsidian" not in p.parts
    }
    assert after == outside


def test_reclaim_never_emits_settings_content(tmp_path: Path) -> None:
    vault = _build(tmp_path)

    report = teardown.reclaim_stale_state(vault)
    blob = json.dumps(report.to_dict(), default=str)

    assert "not-utf8" not in blob
    assert "roomId" not in blob
    assert "e2eControlPort" not in blob
