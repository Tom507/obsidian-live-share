# WP47 / AC2 — removal on every exit path, third angle: each exit path is run
# TWICE in a row in the same vault (so a teardown that half-works leaves evidence
# on the second pass), the vault is large, and the failure is raised from inside
# a nested `with` so an inner context manager is unwinding at the same time.

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

import contextlib  # noqa: E402

from obsidian_e2e import constants, scratch  # noqa: E402


def build_vault(root: Path) -> None:
    (root / ".obsidian").mkdir(parents=True, exist_ok=True)
    (root / ".obsidian" / "app.json").write_bytes(b"{}\n")
    plugin_dir = root / constants.PLUGIN_DIR_REL
    plugin_dir.mkdir(parents=True, exist_ok=True)
    (plugin_dir / "data.json").write_bytes(b'{"e2e-fixture":"synthetic"}\n')
    for i in range(40):
        (root / f"note-{i:03d}.md").write_bytes(f"# note {i}\n".encode("utf-8"))
    (root / "sub").mkdir(exist_ok=True)
    (root / "sub" / "nested.canvas").write_bytes(b'{"nodes":[],"edges":[]}')
    (root / "sub" / "bild.png").write_bytes(bytes(range(90)))


@pytest.fixture()
def vault(tmp_path: Path) -> Path:
    v = tmp_path / "ObsidianOrga"
    v.mkdir()
    build_vault(v)
    return v


class RigFailure(Exception):
    pass


@contextlib.contextmanager
def inner_resource(log: list[str]):
    log.append("enter")
    try:
        yield
    finally:
        log.append("exit")


EXIT_PATHS = ["success", "assertion_failure", "raised_exception", "keyboard_interrupt"]


def drive(vault: Path, exit_path: str, log: list[str]) -> Path:
    captured: dict[str, Path] = {}

    def body() -> None:
        with scratch.scratch_run(vault) as run:
            captured["file"] = run.path
            with inner_resource(log):
                run.write('{"nodes":[],"edges":[]}')
                if exit_path == "assertion_failure":
                    raise AssertionError("converge check failed")
                if exit_path == "raised_exception":
                    raise RigFailure("endpoint lost mid-run")
                if exit_path == "keyboard_interrupt":
                    raise KeyboardInterrupt()

    expected = {
        "success": None,
        "assertion_failure": AssertionError,
        "raised_exception": RigFailure,
        "keyboard_interrupt": KeyboardInterrupt,
    }[exit_path]

    if expected is None:
        body()
    else:
        with pytest.raises(expected):
            body()
    return captured["file"]


@pytest.mark.parametrize("exit_path", EXIT_PATHS)
def test_two_consecutive_runs_on_the_same_path_both_clean_up(vault: Path, exit_path: str) -> None:
    log: list[str] = []

    first = drive(vault, exit_path, log)
    assert not first.exists()
    assert not (vault / constants.SCRATCH_FOLDER).exists()

    second = drive(vault, exit_path, log)
    assert not second.exists()
    assert not (vault / constants.SCRATCH_FOLDER).exists()
    assert first != second
    assert log == ["enter", "exit", "enter", "exit"]


@pytest.mark.parametrize("exit_path", EXIT_PATHS)
def test_the_large_vault_is_bit_identical_afterwards(vault: Path, exit_path: str) -> None:
    before = scratch.fingerprint_vault(vault)
    drive(vault, exit_path, [])
    assert scratch.fingerprint_vault(vault) == before


def test_the_inner_context_manager_unwinds_before_teardown_finishes(vault: Path) -> None:
    log: list[str] = []
    with pytest.raises(RigFailure):
        drive(vault, "raised_exception", log)
    assert log == ["enter", "exit"]


def test_forty_notes_are_all_still_there_after_an_interrupted_run(vault: Path) -> None:
    with pytest.raises(KeyboardInterrupt):
        drive(vault, "keyboard_interrupt", [])
    for i in range(40):
        assert (vault / f"note-{i:03d}.md").is_file()
    assert (vault / "sub" / "bild.png").is_file()


def test_teardown_is_not_skipped_when_the_body_never_writes(vault: Path) -> None:
    with scratch.scratch_run(vault) as run:
        pass
    assert run.removed is True
    assert run.folder_removed is True
    assert not run.path.exists()
