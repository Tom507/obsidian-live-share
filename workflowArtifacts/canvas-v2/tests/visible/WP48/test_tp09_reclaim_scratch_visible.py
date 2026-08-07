"""WP48 · TP09 (visible) — a stale scratch artefact from a crashed run is
detected and removed at start-up.

Verifies AC4 (artefact kind 2 of 3), plus the SCRATCH_STALE_UNRECLAIMED reason
when removal is impossible.

DATA SAFETY: fixture vault under `tmp_path`; the owner's vaults are never
referenced. Pre-existing fixture content is fingerprinted to prove reclaim only
removed rig-owned artefacts.
"""
from __future__ import annotations

import hashlib
import os
import shutil
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


def _fingerprint(root: Path) -> dict[str, str]:
    return {
        p.relative_to(root).as_posix(): _sha(p.read_bytes())
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


STALE_RUN_ID = "20260731T235959Z-9999-deadbe"
SCRATCH_REL = (
    f"{constants.SCRATCH_FOLDER}/"
    f"{constants.SCRATCH_PREFIX}{STALE_RUN_ID}{constants.SCRATCH_EXT}"
)


def _build(tmp_path: Path) -> Path:
    vault = tmp_path / "VaultWithStaleScratch"
    _write(vault / "Notes" / "keep.md", b"# owner note\n")
    _write(vault / "Canvases" / "owner.canvas", b'{"nodes":[{"id":"n1"}],"edges":[]}')
    _write(vault / SCRATCH_REL, b'{"nodes":[],"edges":[]}')
    return vault


def test_stale_scratch_file_and_its_folder_are_removed(tmp_path: Path) -> None:
    vault = _build(tmp_path)
    protected_before = {
        k: v for k, v in _fingerprint(vault).items() if not k.startswith(constants.SCRATCH_FOLDER)
    }
    assert (vault / SCRATCH_REL).exists()

    report = teardown.reclaim_stale_state(vault)

    assert not (vault / SCRATCH_REL).exists()
    assert not (vault / constants.SCRATCH_FOLDER).exists()
    scratch = [a for a in report.artefacts if a.kind == teardown.RECLAIM_KIND_SCRATCH]
    assert len(scratch) == 1
    assert scratch[0].reclaimed is True
    assert scratch[0].reason is None

    protected_after = {
        k: v for k, v in _fingerprint(vault).items() if not k.startswith(constants.SCRATCH_FOLDER)
    }
    assert protected_after == protected_before


def test_a_stale_scratch_that_cannot_be_removed_is_reported_not_swallowed(
    tmp_path: Path, monkeypatch
) -> None:
    vault = _build(tmp_path)
    scratch_root = str((vault / constants.SCRATCH_FOLDER).resolve())

    def _blocked(target) -> None:
        raise PermissionError(f"cannot remove {target}")

    real_unlink = Path.unlink
    real_remove = os.remove
    real_rmtree = shutil.rmtree
    real_rmdir = os.rmdir

    def guard_unlink(self, *a, **kw):
        if str(self.resolve()).startswith(scratch_root):
            _blocked(self)
        return real_unlink(self, *a, **kw)

    def guard_remove(path, *a, **kw):
        if str(Path(path).resolve()).startswith(scratch_root):
            _blocked(path)
        return real_remove(path, *a, **kw)

    def guard_rmtree(path, *a, **kw):
        if str(Path(path).resolve()).startswith(scratch_root):
            _blocked(path)
        return real_rmtree(path, *a, **kw)

    def guard_rmdir(path, *a, **kw):
        if str(Path(path).resolve()).startswith(scratch_root):
            _blocked(path)
        return real_rmdir(path, *a, **kw)

    monkeypatch.setattr(Path, "unlink", guard_unlink)
    monkeypatch.setattr(os, "remove", guard_remove)
    monkeypatch.setattr(shutil, "rmtree", guard_rmtree)
    monkeypatch.setattr(os, "rmdir", guard_rmdir)

    report = teardown.reclaim_stale_state(vault)

    scratch = [a for a in report.artefacts if a.kind == teardown.RECLAIM_KIND_SCRATCH]
    assert len(scratch) == 1
    assert scratch[0].reclaimed is False
    assert scratch[0].reason == constants.SCRATCH_STALE_UNRECLAIMED
    assert report.actions == 0


def test_scratch_folder_holding_several_stale_runs_is_fully_cleared(tmp_path: Path) -> None:
    vault = _build(tmp_path)
    for run_id in ("20260730T101010Z-1-aaaaaa", "20260730T111111Z-2-bbbbbb"):
        _write(
            vault
            / constants.SCRATCH_FOLDER
            / f"{constants.SCRATCH_PREFIX}{run_id}{constants.SCRATCH_EXT}",
            b"{}",
        )

    report = teardown.reclaim_stale_state(vault)

    assert not (vault / constants.SCRATCH_FOLDER).exists()
    scratch = [a for a in report.artefacts if a.kind == teardown.RECLAIM_KIND_SCRATCH]
    assert len(scratch) == 3
    assert all(a.reclaimed for a in scratch)
