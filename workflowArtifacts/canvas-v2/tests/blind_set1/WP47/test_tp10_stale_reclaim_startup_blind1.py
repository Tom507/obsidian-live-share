# WP47 / AC4 — stale reclaim at start-up, different angle: the crash left MORE
# than one artefact behind (several scratch files, one of them zero-byte, one of
# them with the CURRENT process's pid embedded), and the reclaim must happen
# before the new file is created, not after.

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

import os  # noqa: E402

from obsidian_e2e import constants, scratch  # noqa: E402

STALE_IDS = [
    "20251224T120000Z-9-aaaaaa",
    "20260101T000000Z-10000-bbbbbb",
    f"20260102T030405Z-{os.getpid()}-cccccc",  # same pid: a crash of THIS process
]
BODIES = [b'{"nodes":[{"id":"crashed"}],"edges":[]}\n', b"", b"{}\n"]


def build_vault(root: Path) -> None:
    files = {
        ".obsidian/app.json": b'{"theme":"obsidian"}\n',
        f"{constants.PLUGIN_DIR_REL}/data.json": b'{"e2e-fixture":"synthetic"}\n',
        "Meeting Notes/2026 Q3 Review.md": "# Rückblick\n".encode("utf-8"),
        "Anhänge/foto.png": bytes(range(120)),
        "a/b/c/d/e/tief.md": b"deep\n",
    }
    for rel, data in files.items():
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)


def plant_all(vault: Path) -> list[Path]:
    planted = []
    for run_id, body in zip(STALE_IDS, BODIES):
        p = vault / scratch.scratch_relpath(run_id)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(body)
        planted.append(p)
    return planted


@pytest.fixture()
def vault(tmp_path: Path) -> Path:
    v = tmp_path / "Obsidian Orga - Kopie"
    v.mkdir()
    build_vault(v)
    return v


def test_all_stale_artefacts_are_gone_once_the_body_runs(vault: Path) -> None:
    planted = plant_all(vault)

    with scratch.scratch_run(vault) as run:
        for p in planted:
            assert not p.exists(), f"{p.name} survived start-up"
        assert run.path.is_file()
        assert list(run.folder.iterdir()) == [run.path]


def test_a_crashed_artefact_with_the_current_pid_is_still_stale(vault: Path) -> None:
    """The rig must not treat 'same pid' as 'still live' — the previous run in
    this process is exactly the crash case AC4 names."""
    same_pid = vault / scratch.scratch_relpath(STALE_IDS[2])
    same_pid.parent.mkdir(parents=True, exist_ok=True)
    same_pid.write_bytes(b"{}\n")

    reclaimed = scratch.reclaim_stale_scratch(vault)

    assert scratch.scratch_relpath(STALE_IDS[2]) in reclaimed
    assert not same_pid.exists()


def test_a_zero_byte_stale_artefact_is_reclaimed_too(vault: Path) -> None:
    empty = vault / scratch.scratch_relpath(STALE_IDS[1])
    empty.parent.mkdir(parents=True, exist_ok=True)
    empty.write_bytes(b"")

    assert scratch.reclaim_stale_scratch(vault) == (scratch.scratch_relpath(STALE_IDS[1]),)
    assert not empty.exists()


def test_reclaim_is_reported_and_ordered(vault: Path) -> None:
    plant_all(vault)
    with scratch.scratch_run(vault) as run:
        assert set(run.reclaimed) == {scratch.scratch_relpath(i) for i in STALE_IDS}
        assert list(run.reclaimed) == sorted(run.reclaimed)


def test_the_new_run_never_lands_on_a_reclaimed_name(vault: Path) -> None:
    plant_all(vault)
    with scratch.scratch_run(vault) as run:
        assert run.relpath not in run.reclaimed


def test_a_live_run_is_not_reclaimed_by_a_second_run_starting_after_it(vault: Path) -> None:
    with scratch.scratch_run(vault) as outer:
        outer.write('{"nodes":[{"id":"outer"}],"edges":[]}')
        with scratch.scratch_run(vault) as inner:
            assert outer.path.is_file(), "a live run's file must not be reclaimed"
            assert scratch.scratch_relpath(outer.run_id) not in inner.reclaimed


def test_the_rest_of_the_vault_is_untouched_by_reclaim(vault: Path) -> None:
    before = scratch.fingerprint_vault(vault)
    plant_all(vault)
    scratch.reclaim_stale_scratch(vault)
    assert scratch.diff_fingerprints(before, scratch.fingerprint_vault(vault)) == ()
