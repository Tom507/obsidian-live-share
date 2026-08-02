# WP47 / AC3 — fingerprint equality across a clean run, different angle: a vault
# built to break naive walkers — unicode names, spaces, an empty file, a file
# whose name looks like a directory, a deeply nested tree, and files that share
# a size. Plus the S4 property stated positively: only sizes and digests exist.

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

FIXTURE = {
    ".obsidian/app.json": b'{"theme":"obsidian"}\n',
    ".obsidian/hotkeys.json": b"{}\n",
    f"{constants.PLUGIN_DIR_REL}/main.js": b"// synthetic\n",
    f"{constants.PLUGIN_DIR_REL}/data.json": b'{"e2e-fixture":"synthetic"}\n',
    ".git/HEAD": b"ref: refs/heads/main\n",
    ".git/objects/ab/cdef": bytes(range(40)),
    ".trash/geloescht.md": b"weg\n",
    "Meeting Notes/2026 Q3 Review.md": "# Rückblick\n".encode("utf-8"),
    "Meeting Notes/2026 Q4 Review.md": "# Ausblick\n".encode("utf-8"),
    "Ideen & Skizzen/roadmap.canvas": b'{"nodes":[],"edges":[]}\n',
    "Ideen & Skizzen/ordner.md/inhalt.md": b"a folder named like a file\n",
    "Anhänge/Bildschirmfoto 2026.png": bytes(range(200)),
    "a/b/c/d/e/f/g/tief.md": b"very deep\n",
    "leer.md": b"",
    "gleich-gross-1.md": b"AAAAAAAAAA",
    "gleich-gross-2.md": b"BBBBBBBBBB",
}


def build_vault(root: Path) -> None:
    for rel, data in FIXTURE.items():
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)


@pytest.fixture()
def vault(tmp_path: Path) -> Path:
    v = tmp_path / "Obsidian Orga - Kopie"
    v.mkdir()
    build_vault(v)
    return v


def test_every_included_file_is_walked_exactly_once(vault: Path) -> None:
    fp = scratch.fingerprint_vault(vault)
    expected = {
        rel
        for rel in FIXTURE
        if not rel.startswith((constants.PLUGIN_DIR_REL + "/", ".git/", ".trash/"))
    }
    assert set(fp) == expected


def test_same_size_files_get_different_digests(vault: Path) -> None:
    fp = scratch.fingerprint_vault(vault)
    size1, hash1 = fp["gleich-gross-1.md"]
    size2, hash2 = fp["gleich-gross-2.md"]
    assert size1 == size2 == 10
    assert hash1 != hash2


def test_the_empty_file_is_fingerprinted_not_skipped(vault: Path) -> None:
    fp = scratch.fingerprint_vault(vault)
    size, digest = fp["leer.md"]
    assert size == 0
    assert digest == hashlib.sha256(b"").hexdigest()


def test_before_equals_after_across_a_clean_run_with_many_writes(vault: Path) -> None:
    before = scratch.fingerprint_vault(vault)
    with scratch.scratch_run(vault) as run:
        for i in range(10):
            run.write(f'{{"nodes":[{{"id":"n{i}","x":{i}}}],"edges":[]}}')
    after = scratch.fingerprint_vault(vault)

    assert after == before
    assert run.after == run.before
    assert run.verdict.ok is True
    assert run.verdict.reason is None


def test_the_fingerprint_is_stable_when_taken_repeatedly(vault: Path) -> None:
    """No timestamp, no inode, no ordering nondeterminism may leak in."""
    snapshots = [scratch.fingerprint_vault(vault) for _ in range(5)]
    for snap in snapshots[1:]:
        assert snap == snapshots[0]


def test_the_fingerprint_carries_no_bytes(vault: Path) -> None:
    fp = scratch.fingerprint_vault(vault)
    dumped = repr(fp)
    for marker in ("Rückblick", "Ausblick", "very deep", "AAAAAAAAAA", "BBBBBBBBBB"):
        assert marker not in dumped
    for size, digest in fp.values():
        assert isinstance(size, int)
        assert isinstance(digest, str) and len(digest) == 64


def test_the_scratch_file_is_invisible_to_the_fingerprint_while_it_exists(vault: Path) -> None:
    with scratch.scratch_run(vault) as run:
        run.write('{"nodes":[{"id":"live"}],"edges":[]}')
        live = scratch.fingerprint_vault(vault)
        assert run.path.is_file()
        assert run.relpath not in live
        assert scratch.diff_fingerprints(run.before, live) == ()
