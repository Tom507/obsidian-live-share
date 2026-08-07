# WP47 / AC4 — two run_ids generated in the SAME second in the SAME process must
# differ. This is the test that proves the random component is load-bearing: a
# generator of only timestamp+pid passes every uniqueness check that spans a
# second boundary and collides the moment two runs start together.
#
# Run: .venv\Scripts\python.exe -m pytest <this file>   (from the AgenticWorkspace root)

import os
import re
import sys
from collections import Counter
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

RUN_ID = re.compile(r"^(\d{8}T\d{6}Z)-(\d+)-([0-9a-f]{6})$")


def split(run_id: str) -> tuple[str, str, str]:
    m = RUN_ID.match(run_id)
    assert m, f"run_id does not match the pinned shape: {run_id!r}"
    return m.group(1), m.group(2), m.group(3)


def test_run_id_has_the_pinned_timestamp_pid_random_shape() -> None:
    stamp, pid, rand = split(constants.new_run_id())
    assert pid == str(os.getpid())
    assert len(rand) == 6


def test_two_ids_in_the_same_second_and_process_differ() -> None:
    ids = [constants.new_run_id() for _ in range(2000)]
    groups = Counter(f"{split(i)[0]}-{split(i)[1]}" for i in ids)
    same_second = [prefix for prefix, n in groups.items() if n >= 2]

    assert same_second, "no two ids landed in the same second; test is inconclusive"
    for prefix in same_second:
        colliding = [i for i in ids if i.startswith(prefix + "-")]
        assert len(set(colliding)) == len(colliding), (
            "two ids generated in the same second in the same process collided — "
            "the random component is not load-bearing"
        )


def test_all_ids_in_a_burst_are_unique() -> None:
    ids = [constants.new_run_id() for _ in range(2000)]
    assert len(set(ids)) == len(ids)


def test_the_random_tail_is_what_varies_within_a_second() -> None:
    ids = [constants.new_run_id() for _ in range(500)]
    tails = {split(i)[2] for i in ids}
    assert len(tails) > 1, "the random tail never changed"
    assert {split(i)[1] for i in ids} == {str(os.getpid())}


def test_derived_scratch_paths_inherit_the_uniqueness() -> None:
    paths = {scratch.scratch_relpath(constants.new_run_id()) for _ in range(500)}
    assert len(paths) == 500
    for p in paths:
        assert p.startswith(f"{constants.SCRATCH_FOLDER}/{constants.SCRATCH_PREFIX}")
        assert p.endswith(constants.SCRATCH_EXT)


def test_two_runs_started_back_to_back_never_share_a_path(tmp_path: Path) -> None:
    vault = tmp_path / "FixtureVault"
    (vault / ".obsidian").mkdir(parents=True)
    (vault / ".obsidian" / "app.json").write_bytes(b"{}\n")
    (vault / "Inbox.md").write_bytes(b"# Inbox\n")

    seen: list[str] = []
    for _ in range(25):
        with scratch.scratch_run(vault) as run:
            seen.append(run.relpath)
    assert len(set(seen)) == len(seen)


def test_concurrent_runs_in_one_vault_get_distinct_files(tmp_path: Path) -> None:
    """Two overlapping runs — the second starts while the first is still open."""
    vault = tmp_path / "FixtureVault"
    (vault / ".obsidian").mkdir(parents=True)
    (vault / ".obsidian" / "app.json").write_bytes(b"{}\n")
    (vault / "Daily" / "2026-07-31.md").parent.mkdir(parents=True)
    (vault / "Daily" / "2026-07-31.md").write_bytes(b"note\n")

    with scratch.scratch_run(vault) as first:
        with scratch.scratch_run(vault) as second:
            assert first.relpath != second.relpath
            assert first.path.is_file() and second.path.is_file()
            assert first.run_id != second.run_id
