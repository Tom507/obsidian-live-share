"""WP48 · TP08 (visible) — a leftover provisioned port setting is reclaimed at
start-up and the saved original is restored byte-exactly.

Verifies AC4 (artefact kind 1 of 3).

DATA SAFETY
-----------
* The vault is a fixture built under pytest `tmp_path`. The owner's vaults are
  never referenced.
* Settings content is NEVER asserted on or printed — the real `data.json` carries
  a live production secret (S4). Every comparison here is a sha256 of bytes.
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

ORIGINAL_BYTES = b'{"serverPassword":"<fixture-not-a-secret>","roomId":"fixture"}\n'
PROVISIONED_BYTES = (
    b'{"serverPassword":"<fixture-not-a-secret>","roomId":"fixture","e2eControlPort":39431}\n'
)


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def _fingerprint(root: Path) -> dict[str, str]:
    return {
        p.relative_to(root).as_posix(): _sha(p.read_bytes())
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


def _build_vault(tmp_path: Path) -> Path:
    vault = tmp_path / "FixtureVaultA"
    _write(vault / "Notes" / "keep.md", b"# pre-existing note\n")
    _write(vault / "Canvases" / "real.canvas", b'{"nodes":[],"edges":[]}')
    _write(vault / constants.PLUGIN_DATA_REL, PROVISIONED_BYTES)
    _write(vault / constants.SETTINGS_BACKUP_REL, ORIGINAL_BYTES)
    _write(
        vault / constants.PROVISION_MARKER_REL,
        json.dumps(
            {
                "runId": "20260801T090000Z-4242-abc123",
                "role": constants.ROLE_A,
                "port": constants.REAL_CONTROL_PORT_A,
                "hadOriginal": True,
                "originalSha256": _sha(ORIGINAL_BYTES),
                "pid": 4242,
                "createdAt": "2026-08-01T09:00:00Z",
            }
        ).encode("utf-8"),
    )
    return vault


def test_leftover_provisioned_setting_is_restored_byte_exactly(tmp_path: Path) -> None:
    vault = _build_vault(tmp_path)
    untouched_before = {
        k: v for k, v in _fingerprint(vault).items() if not k.startswith(".obsidian/")
    }

    report = teardown.reclaim_stale_state(vault)

    settings_artefacts = [a for a in report.artefacts if a.kind == teardown.RECLAIM_KIND_SETTINGS]
    assert len(settings_artefacts) == 1
    assert settings_artefacts[0].reclaimed is True

    # byte-exact restore, asserted via hash only (S4)
    assert _sha((vault / constants.PLUGIN_DATA_REL).read_bytes()) == _sha(ORIGINAL_BYTES)
    assert (vault / constants.PLUGIN_DATA_REL).stat().st_size == len(ORIGINAL_BYTES)

    # the rig's own leftovers are gone
    assert not (vault / constants.SETTINGS_BACKUP_REL).exists()
    assert not (vault / constants.PROVISION_MARKER_REL).exists()

    # nothing outside the plugin dir was touched
    untouched_after = {
        k: v for k, v in _fingerprint(vault).items() if not k.startswith(".obsidian/")
    }
    assert untouched_after == untouched_before


def test_reclaim_reports_the_artefact_it_acted_on(tmp_path: Path) -> None:
    vault = _build_vault(tmp_path)

    report = teardown.reclaim_stale_state(vault)
    record = report.to_dict()

    assert report.actions == len(report.reclaimed)
    assert report.actions >= 1
    kinds = {a["kind"] for a in record["artefacts"]}
    assert teardown.RECLAIM_KIND_SETTINGS in kinds
    # the record identifies the file, never its content
    serialised = json.dumps(record)
    assert "serverPassword" not in serialised
    assert "e2eControlPort" not in serialised


def test_a_vault_with_no_leftover_settings_is_a_no_op(tmp_path: Path) -> None:
    vault = tmp_path / "CleanVault"
    _write(vault / "Notes" / "keep.md", b"# clean\n")
    _write(vault / constants.PLUGIN_DATA_REL, ORIGINAL_BYTES)
    before = _fingerprint(vault)

    report = teardown.reclaim_stale_state(vault)

    assert report.actions == 0
    assert [a for a in report.artefacts if a.reclaimed] == []
    assert _fingerprint(vault) == before
