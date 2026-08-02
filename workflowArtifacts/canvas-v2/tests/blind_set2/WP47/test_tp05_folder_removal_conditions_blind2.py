# WP47 / AC2 — folder removal, third angle: the decision is examined as a truth
# TABLE over (rig created the folder?) x (folder empty of non-rig files?), so
# every combination is exercised rather than only the two interesting ones.

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

STRAY = b"user bytes that must survive\n"


def build_vault(root: Path) -> None:
    (root / ".obsidian").mkdir(parents=True, exist_ok=True)
    (root / ".obsidian" / "app.json").write_bytes(b"{}\n")
    plugin_dir = root / constants.PLUGIN_DIR_REL
    plugin_dir.mkdir(parents=True, exist_ok=True)
    (plugin_dir / "data.json").write_bytes(b'{"e2e-fixture":"synthetic"}\n')
    for i in range(15):
        (root / f"note-{i:03d}.md").write_bytes(f"# note {i}\n".encode("utf-8"))
    (root / "sub").mkdir(exist_ok=True)
    (root / "sub" / "nested.canvas").write_bytes(b'{"nodes":[],"edges":[]}')


@pytest.fixture()
def vault(tmp_path: Path) -> Path:
    v = tmp_path / "ObsidianOrga"
    v.mkdir()
    build_vault(v)
    return v


# (folder pre-exists, stray dropped in) -> expected folder_removed
TRUTH_TABLE = [
    (False, False, True),
    (False, True, False),
    (True, False, False),
    (True, True, False),
]


@pytest.mark.parametrize("pre_exists, stray, expected_removed", TRUTH_TABLE)
def test_the_removal_truth_table(
    vault: Path, pre_exists: bool, stray: bool, expected_removed: bool
) -> None:
    folder = vault / constants.SCRATCH_FOLDER
    if pre_exists:
        folder.mkdir()

    with scratch.scratch_run(vault) as run:
        assert run.folder_created is (not pre_exists)
        if stray:
            (folder / "stray.md").write_bytes(STRAY)

    assert run.removed is True
    assert run.folder_removed is expected_removed
    assert folder.exists() is (not expected_removed)
    if stray:
        assert (folder / "stray.md").read_bytes() == STRAY


@pytest.mark.parametrize("pre_exists, stray, expected_removed", TRUTH_TABLE)
def test_the_scratch_file_is_removed_in_every_row(
    vault: Path, pre_exists: bool, stray: bool, expected_removed: bool
) -> None:
    if pre_exists:
        (vault / constants.SCRATCH_FOLDER).mkdir()

    with scratch.scratch_run(vault) as run:
        if stray:
            (run.folder / "stray.md").write_bytes(STRAY)
        assert run.path.is_file()

    assert not run.path.exists()


def test_a_stray_is_never_deleted_in_any_row(vault: Path) -> None:
    digest = hashlib.sha256(STRAY).hexdigest()
    for pre_exists in (False, True):
        folder = vault / constants.SCRATCH_FOLDER
        if pre_exists and not folder.exists():
            folder.mkdir()
        with scratch.scratch_run(vault) as run:
            (run.folder / f"stray-{pre_exists}.md").write_bytes(STRAY)
        survivor = folder / f"stray-{pre_exists}.md"
        assert survivor.is_file()
        assert hashlib.sha256(survivor.read_bytes()).hexdigest() == digest


def test_removing_the_stray_lets_the_next_run_clean_up_again(vault: Path) -> None:
    with scratch.scratch_run(vault) as first:
        (first.folder / "stray.md").write_bytes(STRAY)
    assert (vault / constants.SCRATCH_FOLDER).is_dir()

    (vault / constants.SCRATCH_FOLDER / "stray.md").unlink()

    with scratch.scratch_run(vault) as second:
        assert second.folder_created is False
    assert second.folder_removed is False, "the folder now pre-dates the run"
    assert (vault / constants.SCRATCH_FOLDER).is_dir()


def test_the_rest_of_the_vault_never_participates(vault: Path) -> None:
    before = scratch.fingerprint_vault(vault)
    for pre_exists, stray, _ in TRUTH_TABLE:
        folder = vault / constants.SCRATCH_FOLDER
        if pre_exists and not folder.exists():
            folder.mkdir()
        with scratch.scratch_run(vault) as run:
            if stray:
                (run.folder / "stray.md").write_bytes(STRAY)
    assert scratch.diff_fingerprints(before, scratch.fingerprint_vault(vault)) == ()
