# WP47 / AC1 — THE crown-jewel test: a guard intercepts every file-open in the
# vault and FAILS on any write-mode open of a path outside SCRATCH_FOLDER and
# outside the plugin dir. A full create -> edit -> teardown cycle runs under it.
#
# Structural, not by inspection: the guard is installed below the module under
# test, so an implementation that opens a pre-existing note for writing cannot
# pass, whatever it does afterwards.
#
# Run: .venv\Scripts\python.exe -m pytest <this file>   (from the AgenticWorkspace root)

import builtins
import hashlib
import io
import os
import shutil
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


class VaultWriteViolation(BaseException):
    """BaseException on purpose: a bare `except Exception` must not swallow it."""


def build_vault(root: Path) -> dict[str, bytes]:
    files = {
        ".obsidian/app.json": b'{"promptDelete":false}\n',
        ".obsidian/community-plugins.json": b'["live-share"]\n',
        f"{constants.PLUGIN_DIR_REL}/main.js": b"// synthetic build marker\n",
        f"{constants.PLUGIN_DIR_REL}/data.json": b'{"e2e-fixture":"synthetic"}\n',
        "Inbox.md": b"# Inbox\n\n- [ ] pre-existing\n",
        "Daily/2026-07-31.md": b"# 2026-07-31\n\npre-existing note bytes\n",
        "Projects/Nested/Deep/plan.md": b"deep nested pre-existing note\n",
        "boards/board.canvas": b'{"nodes":[{"id":"n1"}],"edges":[]}\n',
        "attachments/diagram.png": bytes(range(256)),
    }
    for rel, data in files.items():
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    return files


class VaultWriteGuard:
    """Intercepts every open/mutation and records anything outside the two
    sanctioned prefixes. Paths outside the vault are none of our business."""

    def __init__(self, vault: Path) -> None:
        self.vault = vault.resolve()
        self.violations: list[str] = []
        self.sanctioned_writes: list[str] = []

    # -- classification -----------------------------------------------------
    def _rel(self, target) -> str | None:
        try:
            resolved = Path(os.fspath(target)).resolve()
        except (TypeError, ValueError, OSError):
            return None
        try:
            return resolved.relative_to(self.vault).as_posix()
        except ValueError:
            return None  # outside the vault

    def _check(self, target, what: str) -> None:
        rel = self._rel(target)
        if rel is None:
            return
        allowed = (constants.SCRATCH_FOLDER, constants.PLUGIN_DIR_REL)
        if any(rel == a or rel.startswith(a + "/") for a in allowed):
            self.sanctioned_writes.append(f"{what}:{rel}")
            return
        self.violations.append(f"{what}:{rel}")
        raise VaultWriteViolation(f"write-mode {what} outside the scratch folder: {rel}")

    # -- installation -------------------------------------------------------
    def install(self, monkeypatch: pytest.MonkeyPatch) -> None:
        real_open = builtins.open
        real_io_open = io.open
        real_os_open = os.open

        def guarded_open(file, mode="r", *a, **kw):
            if any(c in str(mode) for c in "wxa+"):
                self._check(file, "open")
            return real_open(file, mode, *a, **kw)

        def guarded_io_open(file, mode="r", *a, **kw):
            if any(c in str(mode) for c in "wxa+"):
                self._check(file, "open")
            return real_io_open(file, mode, *a, **kw)

        write_flags = os.O_WRONLY | os.O_RDWR | os.O_APPEND | os.O_CREAT | os.O_TRUNC

        def guarded_os_open(path, flags, *a, **kw):
            if flags & write_flags:
                self._check(path, "os.open")
            return real_os_open(path, flags, *a, **kw)

        monkeypatch.setattr(builtins, "open", guarded_open)
        monkeypatch.setattr(io, "open", guarded_io_open)
        monkeypatch.setattr(os, "open", guarded_os_open)

        # Mutating the vault without opening anything is just as forbidden.
        for module, name, argno in (
            (os, "remove", 0),
            (os, "unlink", 0),
            (os, "rmdir", 0),
            (os, "mkdir", 0),
            (os, "makedirs", 0),
            (os, "rename", 0),
            (os, "replace", 0),
            (os, "truncate", 0),
            (shutil, "rmtree", 0),
            (shutil, "move", 0),
        ):
            real = getattr(module, name)

            def guarded(*args, __real=real, __name=name, __argno=argno, **kw):
                if len(args) > __argno:
                    self._check(args[__argno], __name)
                # rename/replace/move: the destination counts too
                if __name in ("rename", "replace", "move") and len(args) > 1:
                    self._check(args[1], __name + ".dst")
                return __real(*args, **kw)

            monkeypatch.setattr(module, name, guarded)


@pytest.fixture()
def vault(tmp_path: Path) -> Path:
    v = tmp_path / "FixtureVault"
    v.mkdir()
    build_vault(v)
    return v


def digests(vault: Path, rels) -> dict[str, str]:
    # sha256 of bytes only — no content ever leaves this helper (S4).
    return {rel: hashlib.sha256((vault / rel).read_bytes()).hexdigest() for rel in rels}


def test_full_create_edit_teardown_cycle_writes_only_inside_the_scratch_folder(
    vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    originals = build_vault(vault)
    before = digests(vault, originals)

    guard = VaultWriteGuard(vault)
    guard.install(monkeypatch)

    with scratch.scratch_run(vault) as run:
        assert run.path.is_file()
        run.write('{"nodes":[{"id":"scratch-1","x":0,"y":0}],"edges":[]}')
        run.write('{"nodes":[{"id":"scratch-1","x":40,"y":10}],"edges":[]}')

    assert guard.violations == []
    # The guard must have actually seen traffic — a guard that observed nothing
    # would pass vacuously.
    assert guard.sanctioned_writes, "guard saw no writes at all; it is not wired in"
    assert digests(vault, originals) == before


def test_the_guard_itself_fires_on_a_write_outside_the_scratch_folder(
    vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Meta-test: proves the guard is not a no-op that passes everything."""
    guard = VaultWriteGuard(vault)
    guard.install(monkeypatch)

    with pytest.raises(VaultWriteViolation):
        (vault / "Inbox.md").write_text("tampered", encoding="utf-8")
    assert any(v.endswith("Inbox.md") for v in guard.violations)


def test_read_only_access_to_pre_existing_files_is_not_a_violation(
    vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The fingerprint must be free to READ every pre-existing file."""
    guard = VaultWriteGuard(vault)
    guard.install(monkeypatch)

    fp = scratch.fingerprint_vault(vault)

    assert guard.violations == []
    assert "Inbox.md" in fp


def test_guard_stays_clean_when_the_run_body_raises(
    vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    originals = build_vault(vault)
    before = digests(vault, originals)

    guard = VaultWriteGuard(vault)
    guard.install(monkeypatch)

    with pytest.raises(RuntimeError, match="boom"):
        with scratch.scratch_run(vault) as run:
            run.write('{"nodes":[],"edges":[]}')
            raise RuntimeError("boom")

    assert guard.violations == []
    assert digests(vault, originals) == before
    assert not (vault / constants.SCRATCH_FOLDER).exists()
