# WP47 / AC2 — the scratch file and the rig-owned folder are removed on EVERY
# exit path: success, assertion failure, raised exception, KeyboardInterrupt.
#
# Parameterised over the exit paths so no path can be silently untested, and the
# original exception must still propagate — teardown is not allowed to swallow
# the reason the run failed.
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


def build_vault(root: Path) -> None:
    files = {
        ".obsidian/app.json": b'{"promptDelete":false}\n',
        f"{constants.PLUGIN_DIR_REL}/data.json": b'{"e2e-fixture":"synthetic"}\n',
        "Inbox.md": b"# Inbox\n",
        "Daily/2026-07-31.md": b"note\n",
        "Projects/Nested/Deep/plan.md": b"deep\n",
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


class Boom(Exception):
    pass


# exit path -> (callable raising it, expected exception type or None)
EXIT_PATHS = {
    "success": (None, None),
    "assertion_failure": (lambda: (_ for _ in ()).throw(AssertionError("expected 1, got 2")), AssertionError),
    "raised_exception": (lambda: (_ for _ in ()).throw(Boom("mid-run failure")), Boom),
    "keyboard_interrupt": (lambda: (_ for _ in ()).throw(KeyboardInterrupt()), KeyboardInterrupt),
}


@pytest.mark.parametrize("exit_path", sorted(EXIT_PATHS))
def test_artefacts_are_removed_on_every_exit_path(vault: Path, exit_path: str) -> None:
    trigger, expected = EXIT_PATHS[exit_path]
    seen: dict[str, Path] = {}

    def body() -> None:
        with scratch.scratch_run(vault) as run:
            seen["file"] = run.path
            seen["folder"] = run.folder
            assert run.path.is_file()
            run.write('{"nodes":[{"id":"n"}],"edges":[]}')
            if trigger is not None:
                trigger()

    if expected is None:
        body()
    else:
        with pytest.raises(expected):
            body()

    assert not seen["file"].exists(), f"scratch file survived the {exit_path} path"
    assert not seen["folder"].exists(), f"rig folder survived the {exit_path} path"


@pytest.mark.parametrize("exit_path", sorted(EXIT_PATHS))
def test_the_vault_is_left_with_exactly_its_pre_existing_paths(vault: Path, exit_path: str) -> None:
    trigger, expected = EXIT_PATHS[exit_path]
    before = {p.relative_to(vault).as_posix() for p in vault.rglob("*")}

    def body() -> None:
        with scratch.scratch_run(vault):
            if trigger is not None:
                trigger()

    if expected is None:
        body()
    else:
        with pytest.raises(expected):
            body()

    after = {p.relative_to(vault).as_posix() for p in vault.rglob("*")}
    assert after == before


def test_teardown_does_not_mask_the_original_failure(vault: Path) -> None:
    with pytest.raises(Boom, match="mid-run failure"):
        with scratch.scratch_run(vault):
            raise Boom("mid-run failure")


def test_keyboard_interrupt_is_not_downgraded_to_an_ordinary_exception(vault: Path) -> None:
    """A BaseException must pass through as itself — catching it as Exception
    would turn an operator abort into a silently 'handled' run."""
    with pytest.raises(KeyboardInterrupt):
        with scratch.scratch_run(vault):
            raise KeyboardInterrupt()
    assert not (vault / constants.SCRATCH_FOLDER).exists()


def test_teardown_records_removal_on_the_run_object(vault: Path) -> None:
    with scratch.scratch_run(vault) as run:
        pass
    assert run.removed is True
    assert run.folder_removed is True
