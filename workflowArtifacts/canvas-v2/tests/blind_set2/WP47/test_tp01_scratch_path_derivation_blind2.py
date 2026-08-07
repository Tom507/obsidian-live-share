# WP47 / AC1 — path derivation, third angle: a LARGE flat vault (60 generated
# notes at the root) in which one pre-existing note has exactly the content a
# fresh scratch canvas would have. If the rig ever located "its" file by content
# or by extension instead of by folder, it would find that note.

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

EMPTY_CANVAS = b'{"nodes":[],"edges":[]}'


def build_vault(root: Path) -> None:
    (root / ".obsidian").mkdir(parents=True, exist_ok=True)
    (root / ".obsidian" / "app.json").write_bytes(b"{}\n")
    (root / ".obsidian" / "plugins" / "other-plugin").mkdir(parents=True, exist_ok=True)
    (root / ".obsidian" / "plugins" / "other-plugin" / "main.js").write_bytes(b"// other\n")
    plugin_dir = root / constants.PLUGIN_DIR_REL
    plugin_dir.mkdir(parents=True, exist_ok=True)
    (plugin_dir / "data.json").write_bytes(b'{"e2e-fixture":"synthetic"}\n')

    for i in range(60):
        (root / f"note-{i:03d}.md").write_bytes(f"# note {i}\n".encode("utf-8"))
    (root / "twin.canvas").write_bytes(EMPTY_CANVAS)
    (root / "sub").mkdir(exist_ok=True)
    (root / "sub" / "nested.canvas").write_bytes(EMPTY_CANVAS)


@pytest.fixture()
def vault(tmp_path: Path) -> Path:
    v = tmp_path / "ObsidianOrga"
    v.mkdir()
    build_vault(v)
    return v


def test_the_run_file_is_in_the_folder_not_next_to_the_content_twin(vault: Path) -> None:
    with scratch.scratch_run(vault) as run:
        assert run.path.parent.name == constants.SCRATCH_FOLDER
        assert run.path != vault / "twin.canvas"
        assert run.path != vault / "sub" / "nested.canvas"


def test_a_content_identical_pre_existing_canvas_is_never_the_target(vault: Path) -> None:
    twin = vault / "twin.canvas"
    twin_bytes = twin.read_bytes()

    with scratch.scratch_run(vault, content=EMPTY_CANVAS.decode("utf-8")) as run:
        assert run.path.read_bytes() == twin_bytes  # same content...
        assert run.path != twin  # ...different file

    assert twin.is_file()
    assert twin.read_bytes() == twin_bytes


def test_exactly_two_paths_appear_and_both_disappear(vault: Path) -> None:
    before = {p.relative_to(vault).as_posix() for p in vault.rglob("*")}
    with scratch.scratch_run(vault) as run:
        during = {p.relative_to(vault).as_posix() for p in vault.rglob("*")}
        assert during - before == {constants.SCRATCH_FOLDER, run.relpath}
    assert {p.relative_to(vault).as_posix() for p in vault.rglob("*")} == before


def test_sixty_notes_keep_their_names(vault: Path) -> None:
    with scratch.scratch_run(vault):
        pass
    for i in range(60):
        assert (vault / f"note-{i:03d}.md").is_file()


@pytest.mark.parametrize(
    "candidate",
    [
        "twin.canvas",
        "sub/nested.canvas",
        f"sub/{constants.SCRATCH_FOLDER}/{constants.SCRATCH_PREFIX}x{constants.SCRATCH_EXT}",
        f"{constants.SCRATCH_PREFIX}{constants.SCRATCH_EXT}",
        f"{constants.SCRATCH_FOLDER}/{constants.SCRATCH_EXT}",
        f"{constants.SCRATCH_FOLDER}/{constants.SCRATCH_PREFIX}",
        constants.SCRATCH_EXT,
    ],
)
def test_none_of_these_is_a_scratch_path(candidate: str) -> None:
    assert scratch.is_scratch_relpath(candidate) is False


def test_a_long_run_id_still_produces_a_single_level_path() -> None:
    long_id = "20260801T235959Z-4294967295-abcdef"
    rel = scratch.scratch_relpath(long_id)
    assert rel.count("/") == 1
    assert scratch.is_scratch_relpath(rel) is True
