# WP47 / AC1 — a PRE-EXISTING note whose name collides with the scratch naming
# pattern is neither adopted nor overwritten nor reclaimed.
#
# The rig owns a FOLDER, not a name. A user note that happens to be called
# `<SCRATCH_PREFIX>...<SCRATCH_EXT>` but lives outside SCRATCH_FOLDER is an
# ordinary pre-existing note and is protected exactly like any other.
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

DECOY_BODY = b'{"nodes":[{"id":"user-owned","text":"do not touch"}],"edges":[]}\n'


def build_vault(root: Path) -> dict[str, bytes]:
    files = {
        ".obsidian/app.json": b'{"promptDelete":false}\n',
        f"{constants.PLUGIN_DIR_REL}/data.json": b'{"e2e-fixture":"synthetic"}\n',
        "Inbox.md": b"# Inbox\n",
        "Daily/2026-07-30.md": b"yesterday\n",
        "attachments/photo.bin": bytes(range(128)),
        # --- the decoys: names that collide with the scratch pattern ---
        f"{constants.SCRATCH_PREFIX}20260101T000000Z-1-aaaaaa{constants.SCRATCH_EXT}": DECOY_BODY,
        f"archive/{constants.SCRATCH_PREFIX}legacy{constants.SCRATCH_EXT}": DECOY_BODY,
        f"archive/{constants.SCRATCH_FOLDER} notes.md": b"a folder-like name, not the folder\n",
    }
    for rel, data in files.items():
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    return files


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture()
def vault(tmp_path: Path) -> Path:
    v = tmp_path / "FixtureVault"
    v.mkdir()
    build_vault(v)
    return v


DECOY_RELS = [
    f"{constants.SCRATCH_PREFIX}20260101T000000Z-1-aaaaaa{constants.SCRATCH_EXT}",
    f"archive/{constants.SCRATCH_PREFIX}legacy{constants.SCRATCH_EXT}",
]


def test_run_creates_its_own_file_and_never_adopts_a_colliding_note(vault: Path) -> None:
    before = {rel: sha(vault / rel) for rel in DECOY_RELS}

    with scratch.scratch_run(vault) as run:
        for rel in DECOY_RELS:
            assert run.relpath != rel
        assert run.path.parent == vault / constants.SCRATCH_FOLDER
        # The run's own file is fresh, not the decoy body.
        assert run.path.read_bytes() != DECOY_BODY

    for rel in DECOY_RELS:
        assert (vault / rel).is_file(), f"decoy {rel} was deleted"
        assert sha(vault / rel) == before[rel], f"decoy {rel} was overwritten"


def test_startup_reclaim_leaves_colliding_notes_outside_the_folder_alone(vault: Path) -> None:
    before = {rel: sha(vault / rel) for rel in DECOY_RELS}

    reclaimed = scratch.reclaim_stale_scratch(vault)

    assert reclaimed == ()
    for rel in DECOY_RELS:
        assert (vault / rel).is_file()
        assert sha(vault / rel) == before[rel]


def test_a_colliding_note_is_part_of_the_fingerprint_and_protects_itself(vault: Path) -> None:
    """The decoys are NOT scratch artefacts, so they must be fingerprinted —
    which is what makes an accidental overwrite fail the run."""
    fp = scratch.fingerprint_vault(vault)
    for rel in DECOY_RELS:
        assert rel in fp
    assert not any(k.startswith(constants.SCRATCH_FOLDER + "/") for k in fp)


def test_an_explicit_run_id_still_never_targets_a_pre_existing_path(vault: Path) -> None:
    """Even when the caller pins the run_id, the derived path is folder-scoped."""
    run_id = "20260101T000000Z-1-aaaaaa"  # exactly the decoy's id component
    decoy = vault / f"{constants.SCRATCH_PREFIX}{run_id}{constants.SCRATCH_EXT}"
    before = sha(decoy)

    with scratch.scratch_run(vault, run_id=run_id) as run:
        assert run.relpath == f"{constants.SCRATCH_FOLDER}/{decoy.name}"
        assert run.path != decoy
        assert run.path.is_file()

    assert decoy.is_file()
    assert sha(decoy) == before
