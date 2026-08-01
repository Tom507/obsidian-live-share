# WP47 / AC2 — removal on every exit path, different angle: the failures here are
# raised from DEEPER inside the run (after several scratch writes, from a nested
# helper, and from a generator finalisation), and the exit paths additionally
# cover SystemExit and an exception raised while another is being handled.

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


def build_vault(root: Path) -> None:
    files = {
        ".obsidian/app.json": b'{"theme":"obsidian"}\n',
        f"{constants.PLUGIN_DIR_REL}/data.json": b'{"e2e-fixture":"synthetic"}\n',
        "Meeting Notes/2026 Q3 Review.md": "# Rückblick\n".encode("utf-8"),
        "Ideen & Skizzen/roadmap.canvas": b'{"nodes":[],"edges":[]}\n',
        "Anhänge/foto.png": bytes(range(120)),
        "a/b/c/d/e/tief.md": b"deep\n",
    }
    for rel, data in files.items():
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)


@pytest.fixture()
def vault(tmp_path: Path) -> Path:
    v = tmp_path / "Obsidian Orga - Kopie"
    v.mkdir()
    build_vault(v)
    return v


class DriverError(Exception):
    pass


def deep_helper(depth: int, boom) -> None:
    if depth == 0:
        boom()
        return
    deep_helper(depth - 1, boom)


EXIT_PATHS = {
    "success": (None, None),
    "assertion_failure": (lambda: _raise(AssertionError("nodes did not converge")), AssertionError),
    "raised_exception": (lambda: _raise(DriverError("endpoint lost")), DriverError),
    "keyboard_interrupt": (lambda: _raise(KeyboardInterrupt()), KeyboardInterrupt),
    "system_exit": (lambda: _raise(SystemExit(2)), SystemExit),
    "chained_exception": (lambda: _chained(), DriverError),
}


def _raise(exc: BaseException) -> None:
    raise exc


def _chained() -> None:
    try:
        raise ValueError("inner")
    except ValueError as inner:
        raise DriverError("outer") from inner


@pytest.mark.parametrize("exit_path", sorted(EXIT_PATHS))
def test_removal_happens_after_several_writes_on_every_exit_path(
    vault: Path, exit_path: str
) -> None:
    trigger, expected = EXIT_PATHS[exit_path]
    captured: dict[str, Path] = {}

    def body() -> None:
        with scratch.scratch_run(vault) as run:
            captured["file"] = run.path
            captured["folder"] = run.folder
            for i in range(5):
                run.write(f'{{"nodes":[{{"id":"n{i}"}}],"edges":[]}}')
            if trigger is not None:
                deep_helper(6, trigger)

    if expected is None:
        body()
    else:
        with pytest.raises(expected):
            body()

    assert not captured["file"].exists()
    assert not captured["folder"].exists()


@pytest.mark.parametrize("exit_path", sorted(EXIT_PATHS))
def test_the_vault_contents_are_identical_afterwards(vault: Path, exit_path: str) -> None:
    trigger, expected = EXIT_PATHS[exit_path]
    before = scratch.fingerprint_vault(vault)

    def body() -> None:
        with scratch.scratch_run(vault) as run:
            run.write("{}")
            if trigger is not None:
                trigger()

    if expected is None:
        body()
    else:
        with pytest.raises(expected):
            body()

    assert scratch.diff_fingerprints(before, scratch.fingerprint_vault(vault)) == ()


def test_a_chained_exception_keeps_its_cause(vault: Path) -> None:
    with pytest.raises(DriverError) as excinfo:
        with scratch.scratch_run(vault):
            _chained()
    assert isinstance(excinfo.value.__cause__, ValueError)


def test_system_exit_is_not_converted_into_a_normal_return(vault: Path) -> None:
    with pytest.raises(SystemExit):
        with scratch.scratch_run(vault):
            raise SystemExit(2)
    assert not (vault / constants.SCRATCH_FOLDER).exists()


def test_a_second_teardown_after_a_manual_removal_is_harmless(vault: Path) -> None:
    """Teardown must tolerate a scratch file that has already vanished — a
    crashed Obsidian can take it with it."""
    with scratch.scratch_run(vault) as run:
        run.path.unlink()
        assert not run.path.exists()

    assert run.removed is False
    assert not (vault / constants.SCRATCH_FOLDER).exists()
    assert run.verdict.ok is True
