# WP47 / AC3 — the four change classes the fingerprint must catch:
#   added · deleted · renamed · content changed with the size UNCHANGED.
#
# The same-size case is the one that proves the hash is load-bearing: a
# fingerprint built on (path, size, mtime) passes it and is worthless.
#
# Run: .venv\Scripts\python.exe -m pytest <this file>   (from the AgenticWorkspace root)

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

SAME_SIZE_TARGET = "boards/board.canvas"
SAME_SIZE_ORIGINAL = b'{"nodes":[{"id":"n1","x":100}],"edges":[]}\n'
SAME_SIZE_MUTATED = b'{"nodes":[{"id":"n1","x":900}],"edges":[]}\n'  # identical length
assert len(SAME_SIZE_ORIGINAL) == len(SAME_SIZE_MUTATED)


def build_vault(root: Path) -> None:
    files = {
        ".obsidian/app.json": b'{"promptDelete":false}\n',
        f"{constants.PLUGIN_DIR_REL}/data.json": b'{"e2e-fixture":"synthetic"}\n',
        "Inbox.md": b"# Inbox\n",
        "Daily/2026-07-31.md": b"# 2026-07-31\n\nnote bytes\n",
        "Projects/Nested/Deep/plan.md": b"deep nested note\n",
        SAME_SIZE_TARGET: SAME_SIZE_ORIGINAL,
        "attachments/diagram.png": bytes(range(256)),
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


def mutate_added(vault: Path) -> set[str]:
    (vault / "Daily" / "2026-08-01.md").write_bytes(b"a brand new note\n")
    return {"Daily/2026-08-01.md"}


def mutate_deleted(vault: Path) -> set[str]:
    (vault / "Projects/Nested/Deep/plan.md").unlink()
    return {"Projects/Nested/Deep/plan.md"}


def mutate_renamed(vault: Path) -> set[str]:
    src = vault / "Inbox.md"
    src.rename(vault / "Inbox-renamed.md")
    return {"Inbox.md", "Inbox-renamed.md"}


def mutate_same_size(vault: Path) -> set[str]:
    (vault / SAME_SIZE_TARGET).write_bytes(SAME_SIZE_MUTATED)
    return {SAME_SIZE_TARGET}


CHANGE_CLASSES = {
    "added": mutate_added,
    "deleted": mutate_deleted,
    "renamed": mutate_renamed,
    "same_size_different_content": mutate_same_size,
}


@pytest.mark.parametrize("change_class", sorted(CHANGE_CLASSES))
def test_each_change_class_is_detected_by_diff(vault: Path, change_class: str) -> None:
    before = scratch.fingerprint_vault(vault)
    expected = CHANGE_CLASSES[change_class](vault)
    after = scratch.fingerprint_vault(vault)

    assert set(scratch.diff_fingerprints(before, after)) == expected


@pytest.mark.parametrize("change_class", sorted(CHANGE_CLASSES))
def test_each_change_class_fails_the_run(vault: Path, change_class: str) -> None:
    with pytest.raises(scratch.ScratchError) as excinfo:
        with scratch.scratch_run(vault):
            CHANGE_CLASSES[change_class](vault)

    assert excinfo.value.reason == constants.FINGERPRINT_MISMATCH


def test_the_same_size_case_really_keeps_the_size(vault: Path) -> None:
    """Guards the guard: if this ever stops being size-neutral, the test above
    stops proving that the hash is what caught it."""
    before = scratch.fingerprint_vault(vault)
    mutate_same_size(vault)
    after = scratch.fingerprint_vault(vault)

    size_before, hash_before = before[SAME_SIZE_TARGET]
    size_after, hash_after = after[SAME_SIZE_TARGET]

    assert size_before == size_after
    assert hash_before != hash_after
    assert scratch.diff_fingerprints(before, after) == (SAME_SIZE_TARGET,)


def test_diff_is_sorted_and_deduplicated(vault: Path) -> None:
    before = scratch.fingerprint_vault(vault)
    mutate_added(vault)
    mutate_deleted(vault)
    mutate_same_size(vault)
    after = scratch.fingerprint_vault(vault)

    changed = scratch.diff_fingerprints(before, after)
    assert list(changed) == sorted(changed)
    assert len(changed) == len(set(changed))
    assert set(changed) == {
        "Daily/2026-08-01.md",
        "Projects/Nested/Deep/plan.md",
        SAME_SIZE_TARGET,
    }


def test_a_change_confined_to_the_scratch_folder_is_not_a_mismatch(vault: Path) -> None:
    before = scratch.fingerprint_vault(vault)
    folder = vault / constants.SCRATCH_FOLDER
    folder.mkdir()
    (folder / f"{constants.SCRATCH_PREFIX}x{constants.SCRATCH_EXT}").write_bytes(b"{}\n")
    after = scratch.fingerprint_vault(vault)

    assert scratch.diff_fingerprints(before, after) == ()
