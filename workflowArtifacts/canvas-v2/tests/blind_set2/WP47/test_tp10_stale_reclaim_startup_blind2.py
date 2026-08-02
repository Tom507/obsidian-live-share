# WP47 / AC4 — stale reclaim, third angle: the "crash" is simulated end-to-end.
# A run is killed by an exception raised from inside teardown-adjacent code and
# its artefact is then re-planted by hand to model a process that died before it
# could clean up; the NEXT run must reclaim it and must not inherit a single
# byte of it.

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

CRASH_STATE = b'{"nodes":[{"id":"half-written","x":1}],"edges":[]}'


def build_vault(root: Path) -> None:
    (root / ".obsidian").mkdir(parents=True, exist_ok=True)
    (root / ".obsidian" / "app.json").write_bytes(b"{}\n")
    plugin_dir = root / constants.PLUGIN_DIR_REL
    plugin_dir.mkdir(parents=True, exist_ok=True)
    (plugin_dir / "data.json").write_bytes(b'{"e2e-fixture":"synthetic"}\n')
    for i in range(25):
        target = root / "vault-notes" / f"note-{i:03d}.md"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(f"# note {i}\n".encode("utf-8"))


@pytest.fixture()
def vault(tmp_path: Path) -> Path:
    v = tmp_path / "ObsidianOrga"
    v.mkdir()
    build_vault(v)
    return v


def simulate_crash(vault: Path) -> str:
    """Model a run whose process died: its scratch file is left behind."""
    run_id = constants.new_run_id()
    rel = scratch.scratch_relpath(run_id)
    path = vault / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(CRASH_STATE)
    return rel


def test_the_next_run_reclaims_the_crash_artefact(vault: Path) -> None:
    orphan = simulate_crash(vault)

    with scratch.scratch_run(vault) as run:
        assert not (vault / orphan).exists()
        assert orphan in run.reclaimed
        assert run.relpath != orphan


def test_not_a_single_byte_of_the_crash_state_is_inherited(vault: Path) -> None:
    simulate_crash(vault)
    with scratch.scratch_run(vault) as run:
        fresh = run.path.read_bytes()
        assert fresh != CRASH_STATE
        assert hashlib.sha256(fresh).hexdigest() != hashlib.sha256(CRASH_STATE).hexdigest()


def test_five_orphans_from_five_crashes_are_all_reclaimed(vault: Path) -> None:
    orphans = [simulate_crash(vault) for _ in range(5)]

    with scratch.scratch_run(vault) as run:
        assert set(orphans) <= set(run.reclaimed)
        assert list(run.folder.iterdir()) == [run.path]


def test_reclaim_precedes_creation_not_follows_it(vault: Path) -> None:
    """If reclaim ran AFTER creation, the run's own file would be reclaimed."""
    simulate_crash(vault)
    with scratch.scratch_run(vault) as run:
        assert run.path.is_file()
        assert run.relpath not in run.reclaimed


def test_a_crash_leaves_the_vault_itself_untouched(vault: Path) -> None:
    before = scratch.fingerprint_vault(vault)
    simulate_crash(vault)
    with scratch.scratch_run(vault):
        pass
    assert scratch.diff_fingerprints(before, scratch.fingerprint_vault(vault)) == ()


def test_reclaim_is_visible_through_the_standalone_function_too(vault: Path) -> None:
    orphan = simulate_crash(vault)
    assert scratch.reclaim_stale_scratch(vault) == (orphan,)
    assert scratch.reclaim_stale_scratch(vault) == ()


def test_an_orphan_next_to_a_user_file_is_reclaimed_alone(vault: Path) -> None:
    orphan = simulate_crash(vault)
    stray = vault / constants.SCRATCH_FOLDER / "warum-ist-das-hier.md"
    stray.write_bytes(b"user file\n")

    reclaimed = scratch.reclaim_stale_scratch(vault)

    assert reclaimed == (orphan,)
    assert stray.is_file()
    assert stray.read_bytes() == b"user file\n"
