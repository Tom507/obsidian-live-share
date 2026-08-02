# WP47 / AC4 — idempotence, different angle: reclaim is hammered (ten calls in a
# row, interleaved with runs), the vault is compared by full fingerprint rather
# than by path set, and the no-op cases include a rig folder that contains ONLY
# user files (nothing to reclaim, nothing to delete).

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

STALE_IDS = ["20251224T120000Z-9-aaaaaa", "20260101T000000Z-10000-bbbbbb"]


def build_vault(root: Path) -> None:
    files = {
        ".obsidian/app.json": b'{"theme":"obsidian"}\n',
        f"{constants.PLUGIN_DIR_REL}/data.json": b'{"e2e-fixture":"synthetic"}\n',
        "Meeting Notes/2026 Q3 Review.md": "# Rückblick\n".encode("utf-8"),
        "Anhänge/foto.png": bytes(range(120)),
        "a/b/c/d/e/tief.md": b"deep\n",
        "leer.md": b"",
    }
    for rel, data in files.items():
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)


def plant(vault: Path, run_id: str) -> Path:
    p = vault / scratch.scratch_relpath(run_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b'{"nodes":[],"edges":[]}\n')
    return p


@pytest.fixture()
def vault(tmp_path: Path) -> Path:
    v = tmp_path / "Obsidian Orga - Kopie"
    v.mkdir()
    build_vault(v)
    return v


def test_ten_consecutive_calls_reclaim_only_once(vault: Path) -> None:
    for run_id in STALE_IDS:
        plant(vault, run_id)

    results = [scratch.reclaim_stale_scratch(vault) for _ in range(10)]

    assert len(results[0]) == len(STALE_IDS)
    assert all(r == () for r in results[1:])


def test_the_full_fingerprint_is_identical_after_every_extra_call(vault: Path) -> None:
    for run_id in STALE_IDS:
        plant(vault, run_id)
    scratch.reclaim_stale_scratch(vault)
    baseline = scratch.fingerprint_vault(vault)

    for _ in range(10):
        scratch.reclaim_stale_scratch(vault)
        assert scratch.fingerprint_vault(vault) == baseline


def test_a_rig_folder_with_only_user_files_is_left_completely_alone(vault: Path) -> None:
    folder = vault / constants.SCRATCH_FOLDER
    folder.mkdir()
    (folder / "Notiz.md").write_bytes("# Ümläute\n".encode("utf-8"))
    (folder / ".gitkeep").write_bytes(b"")
    listing = sorted(p.name for p in folder.iterdir())

    for _ in range(5):
        assert scratch.reclaim_stale_scratch(vault) == ()

    assert sorted(p.name for p in folder.iterdir()) == listing


def test_reclaim_before_and_after_a_run_is_stable(vault: Path) -> None:
    plant(vault, STALE_IDS[0])

    first = scratch.reclaim_stale_scratch(vault)
    with scratch.scratch_run(vault) as run:
        assert run.reclaimed == ()
    second = scratch.reclaim_stale_scratch(vault)

    assert first == (scratch.scratch_relpath(STALE_IDS[0]),)
    assert second == ()


def test_reclaim_does_not_create_the_rig_folder_on_a_pristine_vault(vault: Path) -> None:
    for _ in range(5):
        assert scratch.reclaim_stale_scratch(vault) == ()
    assert not (vault / constants.SCRATCH_FOLDER).exists()


def test_interleaving_runs_and_reclaims_never_loses_a_live_file(vault: Path) -> None:
    with scratch.scratch_run(vault) as run:
        for _ in range(5):
            reclaimed = scratch.reclaim_stale_scratch(vault)
            assert reclaimed == ()
            assert run.path.is_file(), "an in-flight run's file was reclaimed"
    assert not run.path.exists()


def test_reclaim_returns_a_tuple_not_a_mutable_view(vault: Path) -> None:
    plant(vault, STALE_IDS[1])
    result = scratch.reclaim_stale_scratch(vault)
    assert isinstance(result, tuple)
    assert scratch.reclaim_stale_scratch(vault) == ()
