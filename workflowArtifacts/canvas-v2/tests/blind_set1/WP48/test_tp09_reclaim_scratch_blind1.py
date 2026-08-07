"""WP48 · TP09 (blind 1) — scratch reclaim must not become a vault cleaner.

Angle: the rig-owned folder also contains a file that does NOT match the scratch
naming scheme, and the vault contains a canvas whose name merely resembles the
scratch prefix but lives outside the rig folder. Reclaim owns the folder, not the
vault: the look-alike outside must survive untouched.

DATA SAFETY: fixture vault under `tmp_path`; fingerprints prove non-interference.
"""
from __future__ import annotations

import hashlib
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


LOOKALIKE_REL = f"Canvases/{constants.SCRATCH_PREFIX}owner-made{constants.SCRATCH_EXT}"


def _build(tmp_path: Path) -> Path:
    vault = tmp_path / "MixedVault"
    _write(vault / "Notes" / "deep" / "nested.md", b"nested note\n")
    _write(vault / LOOKALIKE_REL, b'{"owner":true}')
    _write(
        vault
        / constants.SCRATCH_FOLDER
        / f"{constants.SCRATCH_PREFIX}20260731T080000Z-5-cccccc{constants.SCRATCH_EXT}",
        b"{}",
    )
    _write(vault / constants.SCRATCH_FOLDER / "leftover.log", b"rig log\n")
    _write(vault / constants.SCRATCH_FOLDER / "sub" / "deep.tmp", b"tmp\n")
    return vault


def test_lookalike_canvas_outside_the_rig_folder_is_never_touched(tmp_path: Path) -> None:
    vault = _build(tmp_path)
    before = _sha((vault / LOOKALIKE_REL).read_bytes())

    teardown.reclaim_stale_state(vault)

    assert (vault / LOOKALIKE_REL).exists()
    assert _sha((vault / LOOKALIKE_REL).read_bytes()) == before
    assert (vault / "Notes" / "deep" / "nested.md").exists()


def test_the_whole_rig_owned_folder_goes_including_non_canvas_leftovers(tmp_path: Path) -> None:
    vault = _build(tmp_path)

    report = teardown.reclaim_stale_state(vault)

    assert not (vault / constants.SCRATCH_FOLDER).exists()
    assert report.actions >= 1
    assert any(a.kind == teardown.RECLAIM_KIND_SCRATCH for a in report.artefacts)


def test_an_empty_rig_folder_is_still_removed(tmp_path: Path) -> None:
    vault = tmp_path / "EmptyRigFolder"
    _write(vault / "Notes" / "x.md", b"x")
    (vault / constants.SCRATCH_FOLDER).mkdir(parents=True)

    teardown.reclaim_stale_state(vault)

    assert not (vault / constants.SCRATCH_FOLDER).exists()
    assert (vault / "Notes" / "x.md").exists()


def test_absent_rig_folder_produces_no_scratch_artefact(tmp_path: Path) -> None:
    vault = tmp_path / "NoRigFolder"
    _write(vault / "Notes" / "x.md", b"x")

    report = teardown.reclaim_stale_state(vault)

    assert [a for a in report.artefacts if a.kind == teardown.RECLAIM_KIND_SCRATCH] == []
    assert report.actions == 0
