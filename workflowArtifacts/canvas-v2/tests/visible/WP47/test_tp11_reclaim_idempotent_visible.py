# WP47 / AC4 — reclaiming is IDEMPOTENT: the second call is a no-op, it never
# errors, and it never creates anything it then has to clean up.
#
# Idempotence is what makes reclaim safe to call unconditionally at every
# start-up, which is the only way AC4 can be honoured without a bookkeeping file.
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

STALE_IDS = [
    "20260101T010203Z-4242-abcdef",
    "20251231T235959Z-1-000000",
]


def build_vault(root: Path) -> None:
    files = {
        ".obsidian/app.json": b'{"promptDelete":false}\n',
        f"{constants.PLUGIN_DIR_REL}/data.json": b'{"e2e-fixture":"synthetic"}\n',
        "Inbox.md": b"# Inbox\n",
        "Daily/2026-07-31.md": b"note\n",
        "Projects/Nested/Deep/plan.md": b"deep nested note\n",
        "boards/board.canvas": b'{"nodes":[],"edges":[]}\n',
        "attachments/diagram.png": bytes(range(64)),
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


def plant(vault: Path, run_id: str) -> None:
    path = vault / scratch.scratch_relpath(run_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b'{"nodes":[],"edges":[]}\n')


def test_second_and_third_calls_reclaim_nothing(vault: Path) -> None:
    for run_id in STALE_IDS:
        plant(vault, run_id)

    first = scratch.reclaim_stale_scratch(vault)
    second = scratch.reclaim_stale_scratch(vault)
    third = scratch.reclaim_stale_scratch(vault)

    assert len(first) == len(STALE_IDS)
    assert second == ()
    assert third == ()


def test_the_vault_state_is_stable_across_repeated_calls(vault: Path) -> None:
    for run_id in STALE_IDS:
        plant(vault, run_id)
    scratch.reclaim_stale_scratch(vault)

    snapshot = {p.relative_to(vault).as_posix() for p in vault.rglob("*")}
    fp = scratch.fingerprint_vault(vault)

    scratch.reclaim_stale_scratch(vault)
    scratch.reclaim_stale_scratch(vault)

    assert {p.relative_to(vault).as_posix() for p in vault.rglob("*")} == snapshot
    assert scratch.fingerprint_vault(vault) == fp


def test_reclaim_on_a_vault_without_a_rig_folder_is_a_no_op(vault: Path) -> None:
    assert not (vault / constants.SCRATCH_FOLDER).exists()

    assert scratch.reclaim_stale_scratch(vault) == ()

    assert not (vault / constants.SCRATCH_FOLDER).exists(), (
        "reclaim must not create the folder it is inspecting"
    )


def test_reclaim_on_an_empty_rig_folder_is_a_no_op(vault: Path) -> None:
    folder = vault / constants.SCRATCH_FOLDER
    folder.mkdir()

    assert scratch.reclaim_stale_scratch(vault) == ()
    assert folder.is_dir()


def test_reclaim_never_changes_the_fingerprint_of_the_rest_of_the_vault(vault: Path) -> None:
    before = scratch.fingerprint_vault(vault)
    for run_id in STALE_IDS:
        plant(vault, run_id)

    for _ in range(4):
        scratch.reclaim_stale_scratch(vault)

    assert scratch.diff_fingerprints(before, scratch.fingerprint_vault(vault)) == ()


def test_repeated_runs_each_reclaim_only_what_is_actually_stale(vault: Path) -> None:
    plant(vault, STALE_IDS[0])

    with scratch.scratch_run(vault) as first:
        assert first.reclaimed == (scratch.scratch_relpath(STALE_IDS[0]),)
    with scratch.scratch_run(vault) as second:
        assert second.reclaimed == ()
    with scratch.scratch_run(vault) as third:
        assert third.reclaimed == ()

    assert len({first.relpath, second.relpath, third.relpath}) == 3
