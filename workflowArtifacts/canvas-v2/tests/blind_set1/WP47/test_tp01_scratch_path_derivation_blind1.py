# WP47 / AC1 — scratch path derivation, from a different angle: a vault whose
# NAME AND FOLDERS CONTAIN SPACES (the real vault B is "ObsidianOrga - Kopie")
# and whose notes carry unicode. If the path derivation ever goes through a
# shell-ish or naively-joined string, this is where it dies.

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
        "Meeting Notes/2026 Q3 Review.md": "# Rückblick\n\nÜmläute\n".encode("utf-8"),
        "Ideen & Skizzen/roadmap.canvas": b'{"nodes":[{"id":"idee"}],"edges":[]}\n',
        "Anhänge/Bildschirmfoto 2026.png": bytes(range(200)),
        "a/b/c/d/e/tief.md": b"very deep\n",
        "leere-datei.md": b"",
    }
    for rel, data in files.items():
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)


@pytest.fixture()
def vault(tmp_path: Path) -> Path:
    v = tmp_path / "Obsidian Orga - Kopie"
    v.mkdir()
    build_vault(v)
    return v


def test_derivation_survives_a_vault_path_with_spaces(vault: Path) -> None:
    assert " " in vault.name
    with scratch.scratch_run(vault) as run:
        assert run.path.is_file()
        assert run.path.parent.name == constants.SCRATCH_FOLDER
        assert run.path.parent.parent == vault
        assert run.relpath == f"{constants.SCRATCH_FOLDER}/{run.path.name}"


def test_relpath_is_posix_even_on_windows(vault: Path) -> None:
    with scratch.scratch_run(vault) as run:
        assert "\\" not in run.relpath
        assert run.relpath.count("/") == 1


def test_unicode_notes_are_untouched_and_no_extra_path_appears(vault: Path) -> None:
    before = {p.relative_to(vault).as_posix() for p in vault.rglob("*")}
    with scratch.scratch_run(vault) as run:
        during = {p.relative_to(vault).as_posix() for p in vault.rglob("*")}
        assert during - before == {constants.SCRATCH_FOLDER, run.relpath}
    after = {p.relative_to(vault).as_posix() for p in vault.rglob("*")}
    assert after == before


def test_an_empty_pre_existing_file_stays_empty(vault: Path) -> None:
    empty = vault / "leere-datei.md"
    assert empty.read_bytes() == b""
    with scratch.scratch_run(vault):
        pass
    assert empty.is_file()
    assert empty.read_bytes() == b""


@pytest.mark.parametrize(
    "candidate",
    [
        f"Ideen & Skizzen/{constants.SCRATCH_PREFIX}x{constants.SCRATCH_EXT}",
        f"{constants.SCRATCH_FOLDER} /{constants.SCRATCH_PREFIX}x{constants.SCRATCH_EXT}",
        f" {constants.SCRATCH_FOLDER}/{constants.SCRATCH_PREFIX}x{constants.SCRATCH_EXT}",
        f"{constants.SCRATCH_FOLDER}//{constants.SCRATCH_PREFIX}x{constants.SCRATCH_EXT}",
        f"{constants.SCRATCH_FOLDER}/{constants.SCRATCH_PREFIX}x{constants.SCRATCH_EXT}/",
        f"./{constants.SCRATCH_FOLDER}/{constants.SCRATCH_PREFIX}x{constants.SCRATCH_EXT}",
        constants.SCRATCH_FOLDER,
    ],
)
def test_near_miss_paths_are_not_scratch_paths(candidate: str) -> None:
    assert scratch.is_scratch_relpath(candidate) is False


def test_the_run_id_is_carried_verbatim_into_the_file_name(vault: Path) -> None:
    run_id = "20260215T090000Z-31337-0f0f0f"
    with scratch.scratch_run(vault, run_id=run_id) as run:
        assert run.run_id == run_id
        assert run.path.name == f"{constants.SCRATCH_PREFIX}{run_id}{constants.SCRATCH_EXT}"
