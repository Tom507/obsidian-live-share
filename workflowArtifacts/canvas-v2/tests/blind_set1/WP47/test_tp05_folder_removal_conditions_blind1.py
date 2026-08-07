# WP47 / AC2 — folder removal conditions, different angle: here the folder is
# contested. A user drops a hidden dotfile in it, an attachment with no
# extension, and an empty subfolder; and one case has the folder pre-created by
# the OWNER (not by a crashed run) with a note already in it.

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


def build_vault(root: Path) -> None:
    files = {
        ".obsidian/app.json": b'{"theme":"obsidian"}\n',
        f"{constants.PLUGIN_DIR_REL}/data.json": b'{"e2e-fixture":"synthetic"}\n',
        "Meeting Notes/2026 Q3 Review.md": "# Rückblick\n".encode("utf-8"),
        "Anhänge/foto.png": bytes(range(120)),
        "a/b/c/d/e/tief.md": b"deep\n",
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


@pytest.mark.parametrize(
    "stray_rel, stray_bytes",
    [
        (".gitkeep", b""),
        (".DS_Store", b"\x00\x01"),
        ("attachment-no-extension", bytes(range(32))),
        ("Notiz mit Leerzeichen.md", "# Ümläute\n".encode("utf-8")),
    ],
)
def test_any_non_rig_file_in_the_folder_stops_removal(
    vault: Path, stray_rel: str, stray_bytes: bytes
) -> None:
    with scratch.scratch_run(vault) as run:
        stray = run.folder / stray_rel
        stray.write_bytes(stray_bytes)

    assert run.removed is True
    assert run.folder_removed is False
    assert stray.is_file()
    assert sha(stray) == hashlib.sha256(stray_bytes).hexdigest()


def test_an_empty_user_subfolder_also_stops_removal(vault: Path) -> None:
    with scratch.scratch_run(vault) as run:
        (run.folder / "leerer-unterordner").mkdir()

    assert run.folder_removed is False
    assert (vault / constants.SCRATCH_FOLDER / "leerer-unterordner").is_dir()


def test_a_folder_the_owner_created_with_content_is_never_removed(vault: Path) -> None:
    folder = vault / constants.SCRATCH_FOLDER
    folder.mkdir()
    owned = folder / "Warum ist das hier.md"
    owned.write_bytes("Der Besitzer hat den Ordner angelegt\n".encode("utf-8"))
    before = sha(owned)

    with scratch.scratch_run(vault) as run:
        assert run.folder_created is False
        run.write("{}")

    assert run.folder_removed is False
    assert folder.is_dir()
    assert owned.is_file()
    assert sha(owned) == before
    assert not run.path.exists()


def test_an_empty_folder_the_rig_created_is_removed_even_after_a_failure(vault: Path) -> None:
    with pytest.raises(RuntimeError):
        with scratch.scratch_run(vault) as run:
            assert run.folder_created is True
            raise RuntimeError("driver gave up")

    assert not (vault / constants.SCRATCH_FOLDER).exists()


def test_a_stray_appearing_after_the_scratch_file_is_removed_still_protects_the_folder(
    vault: Path,
) -> None:
    """Ordering matters: the check must look at the folder as it is at removal
    time, not at a snapshot taken when the run started."""
    with scratch.scratch_run(vault) as run:
        folder = run.folder
        assert list(folder.iterdir()) == [run.path]
        (folder / "spät.md").write_bytes(b"landed late\n")

    assert folder.is_dir()
    assert (folder / "spät.md").is_file()


def test_nothing_outside_the_folder_is_ever_removed(vault: Path) -> None:
    before = scratch.fingerprint_vault(vault)
    with scratch.scratch_run(vault) as run:
        (run.folder / "stray.md").write_bytes(b"x\n")
    assert scratch.diff_fingerprints(before, scratch.fingerprint_vault(vault)) == ()
    for rel in ("Meeting Notes/2026 Q3 Review.md", "Anhänge/foto.png", "a/b/c/d/e/tief.md"):
        assert (vault / rel).is_file()
