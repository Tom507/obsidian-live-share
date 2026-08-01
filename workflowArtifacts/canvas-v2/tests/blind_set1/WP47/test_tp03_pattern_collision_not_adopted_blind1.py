# WP47 / AC1 — name-collision, different angle: the collisions here are
# ADVERSARIAL rather than accidental. A user note is named exactly like the run
# that is about to start, another sits in a folder whose name merely starts with
# the rig folder name, and a third is a `.md` twin of the scratch file.

import hashlib
import sys
from pathlib import Path

import pytest

for _parent in Path(__file__).resolve().parents:
    if (_parent / "tools").is_dir() and (_parent / "plugin").is_dir():
        _TOOLS = _parent / "tools"
        break
else:  # pragma: no cover
    raise RuntimeError(f"obsidian-live-share repo root not found from {__file__}")
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, scratch  # noqa: E402

PINNED_ID = "20260215T090000Z-31337-0f0f0f"
USER_BODY = "# Nicht anfassen\n\nUser-Notiz mit Ümläuten\n".encode("utf-8")

LOOKALIKE_FOLDER = f"{constants.SCRATCH_FOLDER}-archive"
TWIN_MD = f"{constants.SCRATCH_PREFIX}{PINNED_ID}.md"
SAME_NAME_ROOT = f"{constants.SCRATCH_PREFIX}{PINNED_ID}{constants.SCRATCH_EXT}"
IN_LOOKALIKE = f"{LOOKALIKE_FOLDER}/{constants.SCRATCH_PREFIX}{PINNED_ID}{constants.SCRATCH_EXT}"

DECOYS = (SAME_NAME_ROOT, TWIN_MD, IN_LOOKALIKE)


def build_vault(root: Path) -> None:
    files = {
        ".obsidian/app.json": b'{"theme":"obsidian"}\n',
        f"{constants.PLUGIN_DIR_REL}/data.json": b'{"e2e-fixture":"synthetic"}\n',
        "Meeting Notes/2026 Q3 Review.md": USER_BODY,
        "Anhänge/foto.png": bytes(range(120)),
        SAME_NAME_ROOT: USER_BODY,
        TWIN_MD: USER_BODY,
        IN_LOOKALIKE: USER_BODY,
    }
    for rel, data in files.items():
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture()
def vault(tmp_path: Path) -> Path:
    v = tmp_path / "Obsidian Orga - Kopie"
    v.mkdir()
    build_vault(v)
    return v


def test_a_run_with_the_colliding_id_still_writes_only_into_the_rig_folder(vault: Path) -> None:
    before = {rel: sha(vault / rel) for rel in DECOYS}

    with scratch.scratch_run(vault, run_id=PINNED_ID) as run:
        assert run.path.parent == vault / constants.SCRATCH_FOLDER
        assert run.path.read_bytes() != USER_BODY

    for rel in DECOYS:
        assert (vault / rel).is_file()
        assert sha(vault / rel) == before[rel]


def test_the_lookalike_folder_is_not_the_rig_folder(vault: Path) -> None:
    assert scratch.is_scratch_relpath(IN_LOOKALIKE) is False

    reclaimed = scratch.reclaim_stale_scratch(vault)

    assert reclaimed == ()
    assert (vault / IN_LOOKALIKE).is_file()
    assert (vault / LOOKALIKE_FOLDER).is_dir()


def test_the_md_twin_is_not_a_scratch_artefact(vault: Path) -> None:
    assert scratch.is_scratch_relpath(TWIN_MD) is False
    fp = scratch.fingerprint_vault(vault)
    assert TWIN_MD in fp


def test_all_decoys_participate_in_the_verdict(vault: Path) -> None:
    """Overwriting any decoy must fail the run — which is only possible if the
    decoys are inside the fingerprint in the first place."""
    with pytest.raises(scratch.ScratchError) as excinfo:
        with scratch.scratch_run(vault, run_id=PINNED_ID):
            (vault / SAME_NAME_ROOT).write_bytes(b"clobbered\n")

    assert excinfo.value.reason == constants.FINGERPRINT_MISMATCH
    assert SAME_NAME_ROOT in excinfo.value.changed


def test_two_runs_with_the_same_pinned_id_do_not_adopt_each_others_file(vault: Path) -> None:
    with scratch.scratch_run(vault, run_id=PINNED_ID) as first:
        first.write('{"nodes":[{"id":"first"}],"edges":[]}')
        first_path = first.path
    assert not first_path.exists()

    with scratch.scratch_run(vault, run_id=PINNED_ID) as second:
        assert second.path == first_path
        assert b"first" not in second.path.read_bytes()
