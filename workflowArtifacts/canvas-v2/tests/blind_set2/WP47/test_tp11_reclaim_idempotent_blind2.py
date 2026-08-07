# WP47 / AC4 — idempotence, third angle: idempotence is asserted as a fixed-point
# property. Reclaim is applied repeatedly to a vault snapshot and the snapshot
# must stop changing after the FIRST application — for every starting state,
# including the pathological ones (no folder, empty folder, only-user folder,
# mixed folder).

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

STALE_A = "20260101T000000Z-11-aaaaaa"
STALE_B = "20260102T000000Z-12-bbbbbb"


def build_vault(root: Path) -> None:
    (root / ".obsidian").mkdir(parents=True, exist_ok=True)
    (root / ".obsidian" / "app.json").write_bytes(b"{}\n")
    plugin_dir = root / constants.PLUGIN_DIR_REL
    plugin_dir.mkdir(parents=True, exist_ok=True)
    (plugin_dir / "data.json").write_bytes(b'{"e2e-fixture":"synthetic"}\n')
    for i in range(20):
        target = root / "vault-notes" / f"note-{i:03d}.md"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(f"# note {i}\n".encode("utf-8"))


def plant_scratch(vault: Path, run_id: str) -> None:
    p = vault / scratch.scratch_relpath(run_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b'{"nodes":[],"edges":[]}')


def state_none(vault: Path) -> None:
    return None


def state_empty_folder(vault: Path) -> None:
    (vault / constants.SCRATCH_FOLDER).mkdir()


def state_only_user(vault: Path) -> None:
    folder = vault / constants.SCRATCH_FOLDER
    folder.mkdir()
    (folder / "user.md").write_bytes(b"user\n")


def state_only_stale(vault: Path) -> None:
    plant_scratch(vault, STALE_A)
    plant_scratch(vault, STALE_B)


def state_mixed(vault: Path) -> None:
    plant_scratch(vault, STALE_A)
    (vault / constants.SCRATCH_FOLDER / "user.md").write_bytes(b"user\n")
    (vault / constants.SCRATCH_FOLDER / "sub").mkdir()


STATES = {
    "no_folder": state_none,
    "empty_folder": state_empty_folder,
    "only_user_files": state_only_user,
    "only_stale": state_only_stale,
    "mixed": state_mixed,
}


@pytest.fixture()
def vault(tmp_path: Path) -> Path:
    v = tmp_path / "ObsidianOrga"
    v.mkdir()
    build_vault(v)
    return v


def listing(vault: Path) -> set[str]:
    return {p.relative_to(vault).as_posix() for p in vault.rglob("*")}


@pytest.mark.parametrize("state", sorted(STATES))
def test_reclaim_reaches_a_fixed_point_after_one_application(vault: Path, state: str) -> None:
    STATES[state](vault)

    scratch.reclaim_stale_scratch(vault)
    fixed = listing(vault)

    for _ in range(5):
        assert scratch.reclaim_stale_scratch(vault) == ()
        assert listing(vault) == fixed


@pytest.mark.parametrize("state", sorted(STATES))
def test_the_non_rig_part_of_the_vault_is_a_fixed_point_from_the_start(
    vault: Path, state: str
) -> None:
    before = scratch.fingerprint_vault(vault)
    STATES[state](vault)

    for _ in range(4):
        scratch.reclaim_stale_scratch(vault)

    assert scratch.diff_fingerprints(before, scratch.fingerprint_vault(vault)) == ()


def test_user_files_survive_every_state_and_every_repetition(vault: Path) -> None:
    state_mixed(vault)
    user = vault / constants.SCRATCH_FOLDER / "user.md"

    for _ in range(6):
        scratch.reclaim_stale_scratch(vault)

    assert user.is_file()
    assert user.read_bytes() == b"user\n"
    assert (vault / constants.SCRATCH_FOLDER / "sub").is_dir()


def test_the_first_call_is_the_only_one_that_reports_work(vault: Path) -> None:
    state_only_stale(vault)
    calls = [scratch.reclaim_stale_scratch(vault) for _ in range(4)]
    assert len(calls[0]) == 2
    assert calls[1:] == [(), (), ()]


def test_idempotence_holds_across_interleaved_runs(vault: Path) -> None:
    state_only_stale(vault)

    with scratch.scratch_run(vault) as first:
        assert len(first.reclaimed) == 2
    with scratch.scratch_run(vault) as second:
        assert second.reclaimed == ()
    assert scratch.reclaim_stale_scratch(vault) == ()
