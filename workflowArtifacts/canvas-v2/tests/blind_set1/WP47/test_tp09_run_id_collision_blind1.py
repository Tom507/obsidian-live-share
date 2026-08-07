# WP47 / AC4 — run_id collision resistance, different angle: instead of a burst,
# the clock component is held CONSTANT by construction (all ids compared inside a
# single wall-clock second, verified) and the entropy of the random tail is
# measured. A timestamp+pid generator scores 1 distinct value and dies here.

import os
import re
import sys
import time
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

SHAPE = re.compile(r"^(\d{8}T\d{6}Z)-(\d+)-([0-9a-f]{6})$")


def ids_within_one_second(n: int) -> list[str]:
    """Collect n ids that provably share one timestamp component."""
    for _ in range(20):
        batch = [constants.new_run_id() for _ in range(n)]
        stamps = {SHAPE.match(i).group(1) for i in batch}
        if len(stamps) == 1:
            return batch
        time.sleep(0.01)
    pytest.skip("could not collect a same-second batch on this machine")
    return []  # pragma: no cover


def test_the_shape_is_timestamp_pid_random() -> None:
    m = SHAPE.match(constants.new_run_id())
    assert m is not None
    assert m.group(2) == str(os.getpid())


def test_a_same_second_batch_has_no_duplicates() -> None:
    batch = ids_within_one_second(200)
    assert len({SHAPE.match(i).group(1) for i in batch}) == 1
    assert len({SHAPE.match(i).group(2) for i in batch}) == 1
    assert len(set(batch)) == len(batch)


def test_the_random_tail_carries_real_entropy() -> None:
    batch = ids_within_one_second(200)
    tails = {SHAPE.match(i).group(3) for i in batch}
    # 200 draws from 16^6 values: near-certainly >150 distinct. A constant or a
    # counter seeded per second would be far below this.
    assert len(tails) > 150


def test_the_tail_is_lowercase_hex_of_exactly_six_chars() -> None:
    for _ in range(50):
        tail = SHAPE.match(constants.new_run_id()).group(3)
        assert len(tail) == 6
        assert tail == tail.lower()
        int(tail, 16)


def test_paths_derived_in_the_same_second_are_distinct() -> None:
    batch = ids_within_one_second(100)
    paths = {scratch.scratch_relpath(i) for i in batch}
    assert len(paths) == len(batch)


def test_two_open_runs_in_the_same_vault_hold_two_files(tmp_path: Path) -> None:
    vault = tmp_path / "Obsidian Orga - Kopie"
    (vault / "Anhänge").mkdir(parents=True)
    (vault / "Anhänge" / "foto.png").write_bytes(bytes(range(30)))
    (vault / ".obsidian").mkdir()
    (vault / ".obsidian" / "app.json").write_bytes(b"{}\n")

    with scratch.scratch_run(vault) as a:
        with scratch.scratch_run(vault) as b:
            with scratch.scratch_run(vault) as c:
                names = {a.path.name, b.path.name, c.path.name}
                assert len(names) == 3
                assert all(p.path.is_file() for p in (a, b, c))
    assert not (vault / constants.SCRATCH_FOLDER).exists()


def test_an_explicit_run_id_is_honoured_but_not_required(tmp_path: Path) -> None:
    vault = tmp_path / "Obsidian Orga - Kopie"
    vault.mkdir()
    (vault / "note.md").write_bytes(b"x\n")

    with scratch.scratch_run(vault, run_id="20260101T000000Z-1-abc123") as pinned:
        assert pinned.run_id == "20260101T000000Z-1-abc123"
    with scratch.scratch_run(vault) as generated:
        assert SHAPE.match(generated.run_id) is not None
        assert generated.run_id != pinned.run_id
