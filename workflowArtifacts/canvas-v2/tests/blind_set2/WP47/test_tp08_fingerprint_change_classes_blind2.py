# WP47 / AC3 — the four change classes, third angle: each class is applied to a
# file inside a NESTED tree and the classes are also COMBINED (all four at once)
# to prove the diff is a set operation and not a first-difference-wins scan.
# The size-preserving case here replaces a file with a same-length rotation.

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

ROT_TARGET = "level1/level2/level3/rotate.md"
ROT_ORIGINAL = b"abcdefghij"
ROT_MUTATED = b"bcdefghija"  # rotation: same length, same byte multiset

ADD_TARGET = "level1/level2/level3/added.md"
DEL_TARGET = "level1/level2/deleted.md"
REN_SRC = "level1/renamed-src.md"
REN_DST = "level1/level2/level3/renamed-dst.md"


def build_vault(root: Path) -> None:
    files = {
        ".obsidian/app.json": b"{}\n",
        f"{constants.PLUGIN_DIR_REL}/data.json": b'{"e2e-fixture":"synthetic"}\n',
        ROT_TARGET: ROT_ORIGINAL,
        DEL_TARGET: b"to be deleted\n",
        REN_SRC: b"to be renamed\n",
        "level1/keep.md": b"untouched\n",
        "level1/level2/keep.md": b"untouched\n",
        "level1/level2/level3/keep.canvas": b'{"nodes":[],"edges":[]}',
        "root-note.md": b"untouched\n",
    }
    for rel, data in files.items():
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)


@pytest.fixture()
def vault(tmp_path: Path) -> Path:
    v = tmp_path / "ObsidianOrga"
    v.mkdir()
    build_vault(v)
    return v


def do_add(vault: Path) -> set[str]:
    (vault / ADD_TARGET).write_bytes(b"added deep\n")
    return {ADD_TARGET}


def do_delete(vault: Path) -> set[str]:
    (vault / DEL_TARGET).unlink()
    return {DEL_TARGET}


def do_rename(vault: Path) -> set[str]:
    (vault / REN_SRC).rename(vault / REN_DST)
    return {REN_SRC, REN_DST}


def do_rotate(vault: Path) -> set[str]:
    (vault / ROT_TARGET).write_bytes(ROT_MUTATED)
    return {ROT_TARGET}


CLASSES = {
    "added_deep": do_add,
    "deleted_deep": do_delete,
    "renamed_deep": do_rename,
    "rotated_same_size": do_rotate,
}


@pytest.mark.parametrize("name", sorted(CLASSES))
def test_each_class_alone(vault: Path, name: str) -> None:
    before = scratch.fingerprint_vault(vault)
    expected = CLASSES[name](vault)
    after = scratch.fingerprint_vault(vault)
    assert set(scratch.diff_fingerprints(before, after)) == expected


@pytest.mark.parametrize("name", sorted(CLASSES))
def test_each_class_fails_the_run(vault: Path, name: str) -> None:
    with pytest.raises(scratch.ScratchError) as excinfo:
        with scratch.scratch_run(vault):
            CLASSES[name](vault)
    assert excinfo.value.reason == constants.FINGERPRINT_MISMATCH


def test_all_four_classes_at_once_are_all_reported(vault: Path) -> None:
    before = scratch.fingerprint_vault(vault)
    expected: set[str] = set()
    for fn in CLASSES.values():
        expected |= fn(vault)
    after = scratch.fingerprint_vault(vault)

    changed = scratch.diff_fingerprints(before, after)
    assert set(changed) == expected
    assert len(changed) == len(expected)


def test_the_rotation_is_genuinely_size_and_multiset_neutral(vault: Path) -> None:
    assert len(ROT_ORIGINAL) == len(ROT_MUTATED)
    assert sorted(ROT_ORIGINAL) == sorted(ROT_MUTATED)

    before = scratch.fingerprint_vault(vault)
    do_rotate(vault)
    after = scratch.fingerprint_vault(vault)

    assert before[ROT_TARGET][0] == after[ROT_TARGET][0]
    assert before[ROT_TARGET][1] != after[ROT_TARGET][1]


def test_untouched_neighbours_never_appear_in_the_diff(vault: Path) -> None:
    before = scratch.fingerprint_vault(vault)
    do_rotate(vault)
    do_add(vault)
    after = scratch.fingerprint_vault(vault)

    changed = set(scratch.diff_fingerprints(before, after))
    for keep in ("level1/keep.md", "level1/level2/keep.md", "root-note.md"):
        assert keep not in changed


def test_a_folder_appearing_without_files_is_not_a_change(vault: Path) -> None:
    """Fingerprints are over files; an empty folder carries no content."""
    before = scratch.fingerprint_vault(vault)
    (vault / "level1" / "brand-new-empty").mkdir()
    after = scratch.fingerprint_vault(vault)
    assert scratch.diff_fingerprints(before, after) == ()
