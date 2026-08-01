# WP47 / AC2 — the rig-owned folder is removed too, but ONLY if the rig created
# it and ONLY if it is empty of non-rig files.
#
# The failure mode this guards against is a recursive delete of a folder the user
# happened to own or drop something into. Removing the folder is a courtesy;
# never deleting a user file is the requirement.
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

USER_BODY = b"# notes I parked in the rig folder by accident\n"


def build_vault(root: Path) -> None:
    files = {
        ".obsidian/app.json": b'{"promptDelete":false}\n',
        f"{constants.PLUGIN_DIR_REL}/data.json": b'{"e2e-fixture":"synthetic"}\n',
        "Inbox.md": b"# Inbox\n",
        "Daily/2026-07-31.md": b"note\n",
        "Projects/Nested/Deep/plan.md": b"deep\n",
        "boards/board.canvas": b'{"nodes":[],"edges":[]}\n',
        "attachments/diagram.png": bytes(range(64)),
    }
    for rel, data in files.items():
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)


@pytest.fixture()
def vault(tmp_path: Path) -> Path:
    v = tmp_path / "FixtureVault"
    v.mkdir()
    build_vault(v)
    return v


def test_folder_created_by_the_rig_is_removed(vault: Path) -> None:
    assert not (vault / constants.SCRATCH_FOLDER).exists()
    with scratch.scratch_run(vault) as run:
        assert run.folder_created is True
    assert run.folder_removed is True
    assert not (vault / constants.SCRATCH_FOLDER).exists()


def test_a_pre_existing_rig_folder_is_kept(vault: Path) -> None:
    folder = vault / constants.SCRATCH_FOLDER
    folder.mkdir()

    with scratch.scratch_run(vault) as run:
        assert run.folder_created is False
        assert run.path.is_file()

    assert run.removed is True
    assert run.folder_removed is False
    assert folder.is_dir(), "a folder the rig did not create must not be removed"


def test_a_user_file_in_the_folder_stops_removal_and_is_not_deleted(vault: Path) -> None:
    stray = vault / constants.SCRATCH_FOLDER / "user-notes.md"

    with scratch.scratch_run(vault) as run:
        assert run.folder_created is True
        stray.write_bytes(USER_BODY)  # lands there mid-run

    assert run.removed is True, "the scratch file itself is still removed"
    assert not run.path.exists()
    assert run.folder_removed is False
    assert stray.is_file(), "a non-rig file must stop removal, not be deleted with it"
    assert hashlib.sha256(stray.read_bytes()).hexdigest() == hashlib.sha256(USER_BODY).hexdigest()


def test_a_user_subfolder_in_the_rig_folder_also_stops_removal(vault: Path) -> None:
    with scratch.scratch_run(vault) as run:
        nested = vault / constants.SCRATCH_FOLDER / "keep" / "deep.md"
        nested.parent.mkdir(parents=True, exist_ok=True)
        nested.write_bytes(b"nested user content\n")

    assert run.folder_removed is False
    assert (vault / constants.SCRATCH_FOLDER / "keep" / "deep.md").is_file()


def test_a_concurrent_runs_scratch_file_is_never_deleted_by_this_run(vault: Path) -> None:
    """Teardown removes this run's OWN artefact — a concurrent run's live file
    stays, and because the folder is then non-empty the folder stays too."""
    other = vault / scratch.scratch_relpath("20260101T000000Z-999-bbbbbb")

    with scratch.scratch_run(vault) as run:
        other.parent.mkdir(parents=True, exist_ok=True)
        other.write_bytes(b'{"nodes":[],"edges":[]}\n')
        assert other.name != run.path.name

    assert run.removed is True
    assert not run.path.exists()
    assert other.is_file(), "this run must not delete a concurrent run's live artefact"
    assert run.folder_removed is False


def test_folder_removal_never_touches_anything_outside_the_folder(vault: Path) -> None:
    before = {p.relative_to(vault).as_posix() for p in vault.rglob("*")}
    with scratch.scratch_run(vault):
        pass
    after = {p.relative_to(vault).as_posix() for p in vault.rglob("*")}
    assert after == before
