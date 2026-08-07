# WP47 / AC4 — a stale scratch artefact left by an earlier CRASHED run is
# detected and REMOVED at start-up, never reused.
#
# "Reused" is the failure this rules out: adopting a leftover file would make a
# run inherit another run's state and would hide the crash entirely.
#
# Run: .venv\Scripts\python.exe -m pytest <this file>   (from the AgenticWorkspace root)

import hashlib
import sys
from pathlib import Path

import pytest

# --- repo bootstrap (T3 shared contract): <repo>/tools on sys.path, top-level pkg ---
for _parent in Path(__file__).resolve().parents:
    if (_parent / "tools").is_dir() and (_parent / "plugin").is_dir():
        _TOOLS = _parent / "tools"
        break
else:  # pragma: no cover
    raise RuntimeError(f"obsidian-live-share repo root not found from {__file__}")
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, scratch  # noqa: E402

STALE_ID = "20260101T010203Z-4242-abcdef"
STALE_BODY = b'{"nodes":[{"id":"from-the-crashed-run"}],"edges":[]}\n'
USER_BODY = b"# a note the user parked in the rig folder\n"


def build_vault(root: Path) -> None:
    files = {
        ".obsidian/app.json": b'{"promptDelete":false}\n',
        f"{constants.PLUGIN_DIR_REL}/data.json": b'{"e2e-fixture":"synthetic"}\n',
        "Inbox.md": b"# Inbox\n",
        "Daily/2026-07-31.md": b"note\n",
        "Projects/Nested/Deep/plan.md": b"deep nested note\n",
        "boards/board.canvas": b'{"nodes":[],"edges":[]}\n',
        "attachments/diagram.png": bytes(range(64)),
    }
    for rel, data in files.items():
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)


def plant_stale(vault: Path, run_id: str = STALE_ID, body: bytes = STALE_BODY) -> Path:
    rel = scratch.scratch_relpath(run_id)
    path = vault / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    return path


@pytest.fixture()
def vault(tmp_path: Path) -> Path:
    v = tmp_path / "FixtureVault"
    v.mkdir()
    build_vault(v)
    return v


def test_stale_artefact_is_gone_before_the_run_body_starts(vault: Path) -> None:
    stale = plant_stale(vault)
    assert stale.is_file()

    with scratch.scratch_run(vault) as run:
        assert not stale.exists(), "the stale artefact survived start-up"
        assert run.relpath != scratch.scratch_relpath(STALE_ID)


def test_the_reclaim_is_reported_on_the_run(vault: Path) -> None:
    plant_stale(vault)
    with scratch.scratch_run(vault) as run:
        assert scratch.scratch_relpath(STALE_ID) in run.reclaimed


def test_the_stale_content_is_never_reused(vault: Path) -> None:
    plant_stale(vault)
    with scratch.scratch_run(vault) as run:
        assert run.path.read_bytes() != STALE_BODY
        assert hashlib.sha256(run.path.read_bytes()).hexdigest() != (
            hashlib.sha256(STALE_BODY).hexdigest()
        )


def test_several_stale_artefacts_are_all_reclaimed(vault: Path) -> None:
    ids = [STALE_ID, "20251231T235959Z-1-000000", "20260102T101010Z-77-ffffff"]
    for run_id in ids:
        plant_stale(vault, run_id)

    reclaimed = scratch.reclaim_stale_scratch(vault)

    assert set(reclaimed) == {scratch.scratch_relpath(i) for i in ids}
    assert list(reclaimed) == sorted(reclaimed)
    for run_id in ids:
        assert not (vault / scratch.scratch_relpath(run_id)).exists()


def test_reclaim_never_removes_a_non_rig_file_from_the_rig_folder(vault: Path) -> None:
    plant_stale(vault)
    stray = vault / constants.SCRATCH_FOLDER / "user-notes.md"
    stray.write_bytes(USER_BODY)

    reclaimed = scratch.reclaim_stale_scratch(vault)

    assert reclaimed == (scratch.scratch_relpath(STALE_ID),)
    assert stray.is_file()
    assert stray.read_bytes() == USER_BODY


def test_a_stale_only_folder_is_reclaimed_without_touching_the_vault(vault: Path) -> None:
    before = scratch.fingerprint_vault(vault)
    plant_stale(vault)

    scratch.reclaim_stale_scratch(vault)

    assert scratch.diff_fingerprints(before, scratch.fingerprint_vault(vault)) == ()
    for rel in ("Inbox.md", "Daily/2026-07-31.md", "attachments/diagram.png"):
        assert (vault / rel).is_file()


def test_a_run_after_a_crashed_run_ends_with_no_scratch_file_left(vault: Path) -> None:
    """The crashed run's folder pre-dates this run, so this run does not remove
    it (rule: only a folder the rig created in THIS run is removed) — but no
    scratch FILE may survive, neither the stale one nor this run's own."""
    plant_stale(vault)

    with scratch.scratch_run(vault) as run:
        run.write('{"nodes":[],"edges":[]}')

    folder = vault / constants.SCRATCH_FOLDER
    assert not run.path.exists()
    assert run.folder_created is False
    assert run.folder_removed is False
    assert folder.is_dir()
    assert list(folder.iterdir()) == []
    assert run.verdict.ok is True
