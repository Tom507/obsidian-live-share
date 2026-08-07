# WP47 / AC1 — write-mode-open guard, different angle: the guard is armed for the
# WHOLE lifetime of the module under test (start-up reclaim included, not just
# the run body), the vault contains a stale artefact and a read-only-ish note,
# and the run is driven to a failing verdict as well as a clean one.

import builtins
import hashlib
import io
import os
import shutil
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


class VaultWriteViolation(BaseException):
    pass


FIXTURE = {
    ".obsidian/app.json": b'{"theme":"obsidian"}\n',
    ".obsidian/workspace.json": b'{"main":{}}\n',
    f"{constants.PLUGIN_DIR_REL}/data.json": b'{"e2e-fixture":"synthetic"}\n',
    "Meeting Notes/2026 Q3 Review.md": "# Rückblick\r\nCRLF Zeilen\r\n".encode("utf-8"),
    "Ideen & Skizzen/roadmap.canvas": b'{"nodes":[{"id":"idee"}],"edges":[]}\n',
    "Anhänge/Bildschirmfoto 2026.png": bytes(range(200)),
    "a/b/c/d/e/tief.md": b"very deep\n",
    "leere-datei.md": b"",
}


def build_vault(root: Path) -> None:
    for rel, data in FIXTURE.items():
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)


class Guard:
    def __init__(self, vault: Path) -> None:
        self.vault = vault.resolve()
        self.violations: list[str] = []
        self.seen: list[str] = []

    def _rel(self, target):
        try:
            resolved = Path(os.fspath(target)).resolve()
        except (TypeError, ValueError, OSError):
            return None
        try:
            return resolved.relative_to(self.vault).as_posix()
        except ValueError:
            return None

    def check(self, target, what: str) -> None:
        rel = self._rel(target)
        if rel is None:
            return
        for allowed in (constants.SCRATCH_FOLDER, constants.PLUGIN_DIR_REL):
            if rel == allowed or rel.startswith(allowed + "/"):
                self.seen.append(f"{what}:{rel}")
                return
        self.violations.append(f"{what}:{rel}")
        raise VaultWriteViolation(f"{what} outside the rig folder: {rel}")

    def arm(self, monkeypatch: pytest.MonkeyPatch) -> None:
        real_builtin, real_io, real_osopen = builtins.open, io.open, os.open
        wflags = os.O_WRONLY | os.O_RDWR | os.O_APPEND | os.O_CREAT | os.O_TRUNC

        def wrap_open(real):
            def guarded(file, mode="r", *a, **kw):
                if any(c in str(mode) for c in "wxa+"):
                    self.check(file, "open")
                return real(file, mode, *a, **kw)

            return guarded

        monkeypatch.setattr(builtins, "open", wrap_open(real_builtin))
        monkeypatch.setattr(io, "open", wrap_open(real_io))

        def guarded_os_open(path, flags, *a, **kw):
            if flags & wflags:
                self.check(path, "os.open")
            return real_osopen(path, flags, *a, **kw)

        monkeypatch.setattr(os, "open", guarded_os_open)

        for module, name in (
            (os, "remove"),
            (os, "unlink"),
            (os, "rmdir"),
            (os, "mkdir"),
            (os, "makedirs"),
            (os, "rename"),
            (os, "replace"),
            (os, "truncate"),
            (shutil, "rmtree"),
            (shutil, "copy2"),
        ):
            real = getattr(module, name)

            def guarded(*args, __real=real, __name=name, **kw):
                if args:
                    self.check(args[0], __name)
                if __name in ("rename", "replace", "copy2") and len(args) > 1:
                    self.check(args[1], f"{__name}.dst")
                return __real(*args, **kw)

            monkeypatch.setattr(module, name, guarded)


@pytest.fixture()
def vault(tmp_path: Path) -> Path:
    v = tmp_path / "Obsidian Orga - Kopie"
    v.mkdir()
    build_vault(v)
    return v


def snapshot(vault: Path) -> dict[str, str]:
    return {
        rel: hashlib.sha256((vault / rel).read_bytes()).hexdigest() for rel in FIXTURE
    }


def test_startup_reclaim_of_a_stale_artefact_writes_nowhere_else(
    vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    stale = vault / scratch.scratch_relpath("20251224T120000Z-9-aaaaaa")
    stale.parent.mkdir(parents=True, exist_ok=True)
    stale.write_bytes(b'{"nodes":[],"edges":[]}\n')
    before = snapshot(vault)

    guard = Guard(vault)
    guard.arm(monkeypatch)

    with scratch.scratch_run(vault) as run:
        assert not stale.exists()
        run.write('{"nodes":[{"id":"x"}],"edges":[]}')

    assert guard.violations == []
    assert guard.seen
    assert snapshot(vault) == before


def test_a_failing_run_still_writes_nowhere_outside_the_folder(
    vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    before = snapshot(vault)
    guard = Guard(vault)
    guard.arm(monkeypatch)

    with pytest.raises(KeyboardInterrupt):
        with scratch.scratch_run(vault) as run:
            run.write("{}")
            raise KeyboardInterrupt()

    assert guard.violations == []
    assert snapshot(vault) == before


def test_repeated_scratch_writes_never_escape_the_folder(
    vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    guard = Guard(vault)
    guard.arm(monkeypatch)

    with scratch.scratch_run(vault) as run:
        for i in range(20):
            run.write(f'{{"nodes":[{{"id":"n{i}"}}],"edges":[]}}')

    assert guard.violations == []
    assert all(
        entry.split(":", 1)[1].startswith(constants.SCRATCH_FOLDER)
        for entry in guard.seen
        if entry.startswith("open:") or entry.startswith("os.open:")
    )


def test_the_guard_is_not_a_no_op(vault: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    guard = Guard(vault)
    guard.arm(monkeypatch)

    with pytest.raises(VaultWriteViolation):
        (vault / "Ideen & Skizzen" / "roadmap.canvas").write_bytes(b"tampered")
    with pytest.raises(VaultWriteViolation):
        os.remove(vault / "leere-datei.md")

    assert len(guard.violations) == 2


def test_fingerprinting_reads_everything_without_a_single_violation(
    vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    guard = Guard(vault)
    guard.arm(monkeypatch)

    fp = scratch.fingerprint_vault(vault)

    assert guard.violations == []
    assert "Meeting Notes/2026 Q3 Review.md" in fp
    assert "a/b/c/d/e/tief.md" in fp
