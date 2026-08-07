# WP69 / AC4 — blind 2. Same subject (nothing that is not ours is touched),
# different angle: **the whole vault subtree, walked, including directories**, and
# owner backups whose bytes are indistinguishable from each other.
#
# A digest map over files alone cannot see a directory being created, removed or
# renamed, and a name set cannot see a file whose bytes were swapped with an
# identically sized sibling. Here the fixture gives three neighbours the SAME bytes
# as the production bundle, so any confusion between them is invisible to a
# content check and visible only to a per-path check. Every path in the vault is
# compared to itself.
#
# Also asserted: `data.json` and `community-plugins.json` — the two files WP44 and
# WP50 own — are not this WP's to write, in either direction.
#
# DATA SAFETY: synthetic fixture vaults under `h:\tmp\` (or pytest's tmp_path),
# removed again. The owner's live vaults are never touched.
#
# Run: .venv\Scripts\python.exe -m pytest <this file>   (from the AgenticWorkspace root)

from __future__ import annotations

import hashlib
import shutil
import sys
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest

# --- repo bootstrap (T3 shared contract §0.2): <repo>/tools on sys.path, top-level pkg ---
for _parent in Path(__file__).resolve().parents:
    if (_parent / "tools").is_dir() and (_parent / "plugin").is_dir():
        _REPO = _parent
        _TOOLS = _parent / "tools"
        break
else:  # pragma: no cover - only fires if the file is moved outside the repo
    raise RuntimeError(f"obsidian-live-share repo root not found from {__file__}")
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, install  # noqa: E402

OWNER_VAULTS = (
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga"),
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie"),
)
FIXTURE_ROOT = Path(r"h:\tmp")

PRODUCTION_MAIN = b"// production bundle bytes\n" * 41
PRODUCTION_SHA = hashlib.sha256(PRODUCTION_MAIN).hexdigest()
E2E_MAIN = (
    b"var __LS_E2E__=true;\n"
    + b"".join(b"=" + m.encode("utf-8") + b"=\n" for m in constants.E2E_BUILD_MARKERS)
)

#: All three hold EXACTLY the production bytes. Only a per-path comparison can tell
#: them apart from `main.js` or from each other.
IDENTICAL_TWINS = ("main.js.bak", "main.js.0.5.9.bak", "main.js.previous")


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def walk(root: Path) -> dict[str, str]:
    """Every path in the tree: files by digest, directories by a marker."""
    out: dict[str, str] = {}
    for p in sorted(root.rglob("*")):
        rel = p.relative_to(root).as_posix()
        out[rel] = sha(p.read_bytes()) if p.is_file() else "<dir>"
    return out


@pytest.fixture()
def vault(tmp_path: Path) -> Iterator[Path]:
    base = FIXTURE_ROOT if FIXTURE_ROOT.is_dir() else tmp_path
    root = (base / f"wp69b2-{uuid.uuid4().hex}").resolve()
    for owner in OWNER_VAULTS:
        resolved = owner.resolve()
        assert root != resolved and resolved not in root.parents, (
            "ABORT: a WP69 fixture vault must never be rooted at or inside an owner vault"
        )
    plugin_dir = root / constants.PLUGIN_DIR_REL
    plugin_dir.mkdir(parents=True)
    (plugin_dir / "main.js").write_bytes(PRODUCTION_MAIN)
    (plugin_dir / "manifest.json").write_bytes(b'{"id":"live-share","version":"0.6.1"}\n')
    (plugin_dir / "manifest.json.bak").write_bytes(b'{"id":"live-share"}\n')
    (plugin_dir / "styles.css").write_bytes(b".live-share{}\n")
    (plugin_dir / "data.json").write_bytes(b'{"roomId":"fixture-room","token":"FAKE"}\n')
    for name in IDENTICAL_TWINS:
        (plugin_dir / name).write_bytes(PRODUCTION_MAIN)
    # Nested structure inside and beside the plugin dir.
    (plugin_dir / "vendor" / "sub").mkdir(parents=True)
    (plugin_dir / "vendor" / "sub" / "chunk.js").write_bytes(b"// vendor chunk\n")
    (plugin_dir / "empty-dir").mkdir()
    (root / ".obsidian" / "plugins" / "obsidian-git").mkdir(parents=True)
    (root / ".obsidian" / "plugins" / "obsidian-git" / "main.js").write_bytes(b"// git\n")
    (root / ".obsidian" / "plugins" / "lan-vault-sync").mkdir(parents=True)
    (root / ".obsidian" / "plugins" / "lan-vault-sync" / "main.js").write_bytes(b"// sync\n")
    (root / constants.COMMUNITY_PLUGINS_REL).write_bytes(
        b'["live-share","obsidian-git","lan-vault-sync"]\n'
    )
    try:
        yield root
    finally:
        shutil.rmtree(root, ignore_errors=True)


@pytest.fixture()
def source_bundle(tmp_path: Path) -> Path:
    path = tmp_path / "e2e-main.js"
    path.write_bytes(E2E_MAIN)
    return path


def test_the_twins_really_are_indistinguishable_by_content(vault: Path) -> None:
    """Guards the file: if the twins differed, a content check would suffice."""
    plugin_dir = vault / constants.PLUGIN_DIR_REL
    digests = {sha((plugin_dir / name).read_bytes()) for name in IDENTICAL_TWINS}
    assert digests == {PRODUCTION_SHA}


def test_the_full_tree_returns_to_its_exact_shape(
    vault: Path, source_bundle: Path
) -> None:
    before = walk(vault)
    with install.installed_bundle(vault, constants.ROLE_A, source_bundle):
        pass
    assert walk(vault) == before


def test_only_main_js_and_the_rigs_two_files_differ_during_the_borrow(
    vault: Path, source_bundle: Path
) -> None:
    before = walk(vault)
    install.install_bundle(vault, constants.ROLE_A, source_bundle)
    during = walk(vault)

    assert set(during) - set(before) == {
        constants.BUNDLE_BACKUP_REL,
        constants.INSTALL_MARKER_REL,
    }
    assert set(before) - set(during) == set()
    assert {k for k in before if before[k] != during[k]} == {constants.PLUGIN_MAIN_REL}


def test_every_owner_twin_keeps_its_own_path(vault: Path, source_bundle: Path) -> None:
    plugin_dir = vault / constants.PLUGIN_DIR_REL
    install.install_bundle(vault, constants.ROLE_A, source_bundle)
    for name in (*IDENTICAL_TWINS, "manifest.json.bak"):
        assert (plugin_dir / name).is_file(), f"{name} was moved or removed"
    assert (plugin_dir / "main.js").read_bytes() == E2E_MAIN
    for name in IDENTICAL_TWINS:
        assert (plugin_dir / name).read_bytes() == PRODUCTION_MAIN


def test_the_other_plugins_are_never_visited(vault: Path, source_bundle: Path) -> None:
    others = (
        ".obsidian/plugins/obsidian-git/main.js",
        ".obsidian/plugins/lan-vault-sync/main.js",
    )
    before = {rel: sha((vault / rel).read_bytes()) for rel in others}
    with install.installed_bundle(vault, constants.ROLE_A, source_bundle):
        for rel in others:
            assert sha((vault / rel).read_bytes()) == before[rel]
    for rel in others:
        assert sha((vault / rel).read_bytes()) == before[rel]


def test_the_settings_and_plugin_list_are_not_written(
    vault: Path, source_bundle: Path
) -> None:
    watched = (constants.PLUGIN_DATA_REL, constants.COMMUNITY_PLUGINS_REL)
    before = {rel: sha((vault / rel).read_bytes()) for rel in watched}
    install.install_bundle(vault, constants.ROLE_A, source_bundle)
    install.restore_bundle(vault)
    for rel in watched:
        assert sha((vault / rel).read_bytes()) == before[rel]


def test_the_nested_and_empty_directories_survive(
    vault: Path, source_bundle: Path
) -> None:
    plugin_dir = vault / constants.PLUGIN_DIR_REL
    with install.installed_bundle(vault, constants.ROLE_A, source_bundle):
        assert (plugin_dir / "empty-dir").is_dir()
        assert (plugin_dir / "vendor" / "sub" / "chunk.js").is_file()
    assert (plugin_dir / "empty-dir").is_dir()
    assert (plugin_dir / "vendor" / "sub" / "chunk.js").read_bytes() == b"// vendor chunk\n"
