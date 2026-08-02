# WP47 / AC4 — collision resistance, third angle: the id is dissected as a
# *contract* (each of the three components is checked for what it must and must
# not contribute) and the collision property is proven by holding the first two
# components fixed and asking whether any pair of full ids is equal.
#
# A generator of "timestamp + pid" scores a duplicate rate of 100% here.

import os
import re
import sys
from collections import Counter
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


def parts(run_id: str) -> tuple[str, str, str]:
    m = SHAPE.match(run_id)
    assert m is not None, f"unexpected run_id shape: {run_id!r}"
    return m.groups()


def test_the_timestamp_component_is_utc_and_second_resolution() -> None:
    stamp = parts(constants.new_run_id())[0]
    assert stamp.endswith("Z")
    assert len(stamp) == len("YYYYMMDDTHHMMSS") + 1
    assert stamp[8] == "T"


def test_the_pid_component_is_this_process() -> None:
    assert parts(constants.new_run_id())[1] == str(os.getpid())


def test_the_pid_component_alone_cannot_disambiguate() -> None:
    """Everything in one process shares a pid — so the pid contributes zero
    entropy WITHIN a run batch. This is why the third component must exist."""
    pids = {parts(constants.new_run_id())[1] for _ in range(200)}
    assert pids == {str(os.getpid())}


def test_no_duplicate_id_in_a_thousand_draws() -> None:
    ids = [constants.new_run_id() for _ in range(1000)]
    duplicates = [i for i, n in Counter(ids).items() if n > 1]
    assert duplicates == []


def test_duplicates_of_the_first_two_components_are_expected_and_harmless() -> None:
    """The (timestamp, pid) prefix WILL repeat — the test is that the full id
    does not."""
    ids = [constants.new_run_id() for _ in range(1000)]
    prefixes = Counter(f"{parts(i)[0]}-{parts(i)[1]}" for i in ids)
    assert max(prefixes.values()) > 1, "no prefix repeated; the test is inconclusive"
    assert len(set(ids)) == len(ids)


def test_the_random_component_is_not_derived_from_the_others() -> None:
    ids = [constants.new_run_id() for _ in range(300)]
    by_prefix: dict[str, set[str]] = {}
    for i in ids:
        stamp, pid, rand = parts(i)
        by_prefix.setdefault(f"{stamp}-{pid}", set()).add(rand)
    biggest = max(by_prefix.values(), key=len)
    assert len(biggest) > 1, "the tail is constant within a second — it is derived"


def test_scratch_paths_from_a_thousand_ids_are_all_distinct() -> None:
    paths = {scratch.scratch_relpath(constants.new_run_id()) for _ in range(1000)}
    assert len(paths) == 1000


def test_three_sequential_runs_in_one_vault_never_reuse_a_path(tmp_path: Path) -> None:
    vault = tmp_path / "ObsidianOrga"
    (vault / "vault-notes").mkdir(parents=True)
    for i in range(5):
        (vault / "vault-notes" / f"note-{i}.md").write_bytes(b"x\n")

    used = []
    for _ in range(3):
        with scratch.scratch_run(vault) as run:
            used.append(run.relpath)
            assert run.path.is_file()
    assert len(set(used)) == 3


def test_a_generated_id_round_trips_through_the_path_helpers() -> None:
    run_id = constants.new_run_id()
    rel = scratch.scratch_relpath(run_id)
    assert scratch.is_scratch_relpath(rel) is True
    assert run_id in rel
