# WP47 / AC3 — the change classes, different angle: every class is exercised on
# a UNICODE / SPACED path, the rename is a pure CASE change plus a move between
# folders, and the size-preserving mutation is a byte SWAP (identical byte
# multiset, identical size — only the order differs).

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

SWAP_TARGET = "Ideen & Skizzen/roadmap.canvas"
SWAP_ORIGINAL = b'{"nodes":[{"id":"ab"}],"edges":[]}\n'
SWAP_MUTATED = b'{"nodes":[{"id":"ba"}],"edges":[]}\n'
assert len(SWAP_ORIGINAL) == len(SWAP_MUTATED)
assert sorted(SWAP_ORIGINAL) == sorted(SWAP_MUTATED)

MOVE_SRC = "Meeting Notes/2026 Q3 Review.md"
MOVE_DST = "Archiv/2026 Q3 Review.md"


def build_vault(root: Path) -> None:
    files = {
        ".obsidian/app.json": b'{"theme":"obsidian"}\n',
        f"{constants.PLUGIN_DIR_REL}/data.json": b'{"e2e-fixture":"synthetic"}\n',
        MOVE_SRC: "# Rückblick\n".encode("utf-8"),
        SWAP_TARGET: SWAP_ORIGINAL,
        "Anhänge/foto.png": bytes(range(120)),
        "a/b/c/d/e/tief.md": b"deep\n",
    }
    for rel, data in files.items():
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    (root / "Archiv").mkdir(exist_ok=True)


@pytest.fixture()
def vault(tmp_path: Path) -> Path:
    v = tmp_path / "Obsidian Orga - Kopie"
    v.mkdir()
    build_vault(v)
    return v


def add_unicode_note(vault: Path) -> set[str]:
    (vault / "Anhänge" / "Neue Datei mit Ümläuten.md").write_bytes("neu\n".encode("utf-8"))
    return {"Anhänge/Neue Datei mit Ümläuten.md"}


def delete_attachment(vault: Path) -> set[str]:
    (vault / "Anhänge" / "foto.png").unlink()
    return {"Anhänge/foto.png"}


def move_between_folders(vault: Path) -> set[str]:
    (vault / MOVE_SRC).rename(vault / MOVE_DST)
    return {MOVE_SRC, MOVE_DST}


def swap_two_bytes(vault: Path) -> set[str]:
    (vault / SWAP_TARGET).write_bytes(SWAP_MUTATED)
    return {SWAP_TARGET}


CHANGE_CLASSES = {
    "added_unicode": add_unicode_note,
    "deleted_attachment": delete_attachment,
    "renamed_across_folders": move_between_folders,
    "byte_swap_same_size": swap_two_bytes,
}


@pytest.mark.parametrize("change_class", sorted(CHANGE_CLASSES))
def test_diff_names_exactly_the_affected_paths(vault: Path, change_class: str) -> None:
    before = scratch.fingerprint_vault(vault)
    expected = CHANGE_CLASSES[change_class](vault)
    after = scratch.fingerprint_vault(vault)

    assert set(scratch.diff_fingerprints(before, after)) == expected


@pytest.mark.parametrize("change_class", sorted(CHANGE_CLASSES))
def test_every_class_fails_the_run_under_the_named_reason(vault: Path, change_class: str) -> None:
    with pytest.raises(scratch.ScratchError) as excinfo:
        with scratch.scratch_run(vault) as run:
            run.write("{}")
            CHANGE_CLASSES[change_class](vault)

    assert excinfo.value.reason == constants.FINGERPRINT_MISMATCH


def test_the_byte_swap_keeps_size_and_byte_multiset(vault: Path) -> None:
    before = scratch.fingerprint_vault(vault)
    swap_two_bytes(vault)
    after = scratch.fingerprint_vault(vault)

    size_before, hash_before = before[SWAP_TARGET]
    size_after, hash_after = after[SWAP_TARGET]

    assert size_before == size_after
    assert sorted(SWAP_ORIGINAL) == sorted(SWAP_MUTATED), "the swap must be content-neutral by size"
    assert hash_before != hash_after, "only a real hash can see this change"


def test_a_move_shows_up_as_both_a_deletion_and_an_addition(vault: Path) -> None:
    before = scratch.fingerprint_vault(vault)
    move_between_folders(vault)
    after = scratch.fingerprint_vault(vault)

    changed = set(scratch.diff_fingerprints(before, after))
    assert MOVE_SRC in changed and MOVE_SRC not in after
    assert MOVE_DST in changed and MOVE_DST in after
    # Same bytes, different path — a content-only fingerprint would miss it.
    assert before[MOVE_SRC] == after[MOVE_DST]


def test_no_change_yields_an_empty_diff(vault: Path) -> None:
    before = scratch.fingerprint_vault(vault)
    after = scratch.fingerprint_vault(vault)
    assert scratch.diff_fingerprints(before, after) == ()
    assert scratch.diff_fingerprints(before, before) == ()
