# WP47 / AC1 — the scratch file is created inside the rig-owned folder and NOWHERE else.
#
# This is the structural half of the no-pre-existing-write invariant: the path is
# derived from the pinned constants (never a literal), it lands directly inside
# SCRATCH_FOLDER, and the ONLY paths a run adds to the vault are the rig folder
# and that one file.
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
else:  # pragma: no cover - only fires if the file is moved outside the repo
    raise RuntimeError(f"obsidian-live-share repo root not found from {__file__}")
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, scratch  # noqa: E402


def build_vault(root: Path) -> dict[str, bytes]:
    """A realistic mix: notes, a canvas, a binary attachment, .obsidian/, nesting."""
    files = {
        ".obsidian/app.json": b'{"promptDelete":false}\n',
        ".obsidian/community-plugins.json": b'["live-share"]\n',
        f"{constants.PLUGIN_DIR_REL}/main.js": b"// synthetic build marker\n",
        f"{constants.PLUGIN_DIR_REL}/data.json": b'{"e2e-fixture":"synthetic"}\n',
        "Inbox.md": b"# Inbox\n\n- [ ] pre-existing\n",
        "Daily/2026-07-31.md": b"# 2026-07-31\n\npre-existing note bytes\n",
        "Projects/Nested/Deep/plan.md": b"deep nested pre-existing note\n",
        "boards/board.canvas": b'{"nodes":[{"id":"n1"}],"edges":[]}\n',
        "attachments/diagram.png": bytes(range(256)),
    }
    for rel, data in files.items():
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    return files


def relpaths(root: Path) -> set[str]:
    return {p.relative_to(root).as_posix() for p in root.rglob("*")}


@pytest.fixture()
def vault(tmp_path: Path) -> Path:
    v = tmp_path / "FixtureVault"
    v.mkdir()
    build_vault(v)
    return v


def test_relpath_is_derived_from_the_pinned_constants(vault: Path) -> None:
    run_id = constants.new_run_id()
    expected = (
        f"{constants.SCRATCH_FOLDER}/"
        f"{constants.SCRATCH_PREFIX}{run_id}{constants.SCRATCH_EXT}"
    )
    assert scratch.scratch_relpath(run_id) == expected
    # Derived, not decorative: the three constants must each be load-bearing.
    assert expected.startswith(f"{constants.SCRATCH_FOLDER}/")
    assert Path(expected).name.startswith(constants.SCRATCH_PREFIX)
    assert expected.endswith(constants.SCRATCH_EXT)


def test_file_lands_directly_inside_the_rig_folder(vault: Path) -> None:
    with scratch.scratch_run(vault) as run:
        assert run.path.is_file()
        assert run.path == vault / run.relpath
        assert run.path.parent == vault / constants.SCRATCH_FOLDER
        assert run.folder == vault / constants.SCRATCH_FOLDER
        assert run.path.suffix == constants.SCRATCH_EXT


def test_the_only_new_vault_paths_are_the_folder_and_the_scratch_file(vault: Path) -> None:
    before = relpaths(vault)
    with scratch.scratch_run(vault) as run:
        during = relpaths(vault)
    added = during - before
    assert added == {constants.SCRATCH_FOLDER, run.relpath}


def test_no_pre_existing_file_changes_identity_across_the_run(vault: Path) -> None:
    originals = build_vault(vault)  # rewrite = same bytes, gives us the expected map
    expected = {
        rel: hashlib.sha256(data).hexdigest() for rel, data in originals.items()
    }
    with scratch.scratch_run(vault):
        pass
    for rel, digest in expected.items():
        # sha256 of bytes only — never the bytes, never the content (S4).
        assert hashlib.sha256((vault / rel).read_bytes()).hexdigest() == digest


@pytest.mark.parametrize(
    "candidate",
    [
        f"{constants.SCRATCH_PREFIX}abc{constants.SCRATCH_EXT}",  # vault root
        f"notes/{constants.SCRATCH_PREFIX}abc{constants.SCRATCH_EXT}",  # other folder
        f"{constants.SCRATCH_FOLDER}/sub/{constants.SCRATCH_PREFIX}abc{constants.SCRATCH_EXT}",
        f"{constants.SCRATCH_FOLDER}/../{constants.SCRATCH_PREFIX}abc{constants.SCRATCH_EXT}",
        f"{constants.SCRATCH_FOLDER}/abc{constants.SCRATCH_EXT}",  # prefix missing
        f"{constants.SCRATCH_FOLDER}/{constants.SCRATCH_PREFIX}abc.md",  # wrong ext
        f"/{constants.SCRATCH_FOLDER}/{constants.SCRATCH_PREFIX}abc{constants.SCRATCH_EXT}",
        "",
    ],
)
def test_is_scratch_relpath_rejects_everything_outside_the_folder(candidate: str) -> None:
    assert scratch.is_scratch_relpath(candidate) is False


def test_is_scratch_relpath_accepts_the_derived_path() -> None:
    assert scratch.is_scratch_relpath(scratch.scratch_relpath(constants.new_run_id())) is True
