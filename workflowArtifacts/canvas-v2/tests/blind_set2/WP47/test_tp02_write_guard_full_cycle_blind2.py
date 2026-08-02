# WP47 / AC1 — the write guard, third angle: instead of watching only `open`,
# this guard makes every pre-existing file PHYSICALLY read-only first and then
# additionally intercepts the mutation syscalls. A run that tries to write a
# pre-existing note therefore fails twice over — at the OS and at the guard.

import builtins
import io
import os
import stat
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


class Violation(BaseException):
    pass


def build_vault(root: Path) -> list[str]:
    (root / ".obsidian").mkdir(parents=True, exist_ok=True)
    (root / ".obsidian" / "app.json").write_bytes(b"{}\n")
    plugin_dir = root / constants.PLUGIN_DIR_REL
    plugin_dir.mkdir(parents=True, exist_ok=True)
    (plugin_dir / "data.json").write_bytes(b'{"e2e-fixture":"synthetic"}\n')

    rels = []
    for i in range(30):
        rel = f"note-{i:03d}.md"
        (root / rel).write_bytes(f"# note {i}\n".encode("utf-8"))
        rels.append(rel)
    (root / "sub").mkdir(exist_ok=True)
    (root / "sub" / "nested.canvas").write_bytes(b'{"nodes":[],"edges":[]}')
    rels.append("sub/nested.canvas")
    return rels


class Guard:
    def __init__(self, vault: Path) -> None:
        self.vault = vault.resolve()
        self.violations: list[str] = []
        self.allowed_hits = 0

    def classify(self, target, what: str) -> None:
        try:
            rel = Path(os.fspath(target)).resolve().relative_to(self.vault).as_posix()
        except (TypeError, ValueError, OSError):
            return
        for ok in (constants.SCRATCH_FOLDER, constants.PLUGIN_DIR_REL):
            if rel == ok or rel.startswith(ok + "/"):
                self.allowed_hits += 1
                return
        self.violations.append(f"{what}:{rel}")
        raise Violation(f"{what} on a pre-existing vault path: {rel}")

    def arm(self, mp: pytest.MonkeyPatch) -> None:
        originals = {"builtins.open": builtins.open, "io.open": io.open, "os.open": os.open}
        wflags = os.O_WRONLY | os.O_RDWR | os.O_APPEND | os.O_CREAT | os.O_TRUNC

        def make(real):
            def guarded(file, mode="r", *a, **kw):
                if any(c in str(mode) for c in "wxa+"):
                    self.classify(file, "open")
                return real(file, mode, *a, **kw)

            return guarded

        mp.setattr(builtins, "open", make(originals["builtins.open"]))
        mp.setattr(io, "open", make(originals["io.open"]))

        real_os_open = originals["os.open"]

        def guarded_os_open(path, flags, *a, **kw):
            if flags & wflags:
                self.classify(path, "os.open")
            return real_os_open(path, flags, *a, **kw)

        mp.setattr(os, "open", guarded_os_open)

        for mod, name in (
            (os, "remove"),
            (os, "unlink"),
            (os, "rename"),
            (os, "replace"),
            (os, "rmdir"),
            (os, "mkdir"),
            (os, "makedirs"),
            (os, "chmod"),
            (os, "utime"),
        ):
            real = getattr(mod, name)

            def guarded(*args, __real=real, __name=name, **kw):
                if args:
                    self.classify(args[0], __name)
                return __real(*args, **kw)

            mp.setattr(mod, name, guarded)


@pytest.fixture()
def vault(tmp_path: Path):
    v = tmp_path / "ObsidianOrga"
    v.mkdir()
    rels = build_vault(v)
    for rel in rels:
        (v / rel).chmod(stat.S_IREAD)
    yield v, rels
    for rel in rels:  # let pytest clean the tmp dir up afterwards
        try:
            (v / rel).chmod(stat.S_IWRITE | stat.S_IREAD)
        except OSError:  # pragma: no cover
            pass


def test_a_full_cycle_never_touches_a_read_only_note(vault, monkeypatch) -> None:
    v, rels = vault
    guard = Guard(v)
    guard.arm(monkeypatch)

    with scratch.scratch_run(v) as run:
        run.write('{"nodes":[{"id":"a"}],"edges":[]}')
        run.write('{"nodes":[{"id":"a","x":10}],"edges":[]}')

    assert guard.violations == []
    assert guard.allowed_hits > 0
    for rel in rels:
        assert (v / rel).is_file()


def test_the_read_only_bit_really_is_set(vault) -> None:
    v, rels = vault
    with pytest.raises(OSError):
        (v / rels[0]).write_bytes(b"tampered")


def test_the_guard_catches_a_delete_attempt(vault, monkeypatch) -> None:
    v, rels = vault
    guard = Guard(v)
    guard.arm(monkeypatch)

    with pytest.raises(Violation):
        os.remove(v / rels[1])

    assert guard.violations == [f"remove:{rels[1]}"]
    assert (v / rels[1]).is_file()


def test_teardown_after_an_exception_stays_inside_the_folder(vault, monkeypatch) -> None:
    v, _ = vault
    guard = Guard(v)
    guard.arm(monkeypatch)

    with pytest.raises(ValueError):
        with scratch.scratch_run(v) as run:
            run.write("{}")
            raise ValueError("driver aborted")

    assert guard.violations == []
    assert not (v / constants.SCRATCH_FOLDER).exists()


def test_reclaim_of_a_stale_artefact_stays_inside_the_folder(vault, monkeypatch) -> None:
    v, _ = vault
    stale = v / scratch.scratch_relpath("20260101T000000Z-5-eeeeee")
    stale.parent.mkdir(parents=True, exist_ok=True)
    stale.write_bytes(b"{}\n")

    guard = Guard(v)
    guard.arm(monkeypatch)

    reclaimed = scratch.reclaim_stale_scratch(v)

    assert reclaimed == (scratch.scratch_relpath("20260101T000000Z-5-eeeeee"),)
    assert guard.violations == []
