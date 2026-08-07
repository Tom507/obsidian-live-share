# WP69 / AC4 — blind 2. Same subject (exactly one file per vault), different angle:
# **a plugin directory that has no `main.js` at all**, and two vaults borrowed at
# the same time.
#
# The absent-original shape is not hypothetical: it is what a plugin directory looks
# like after a manual clean, and it is the shape WP44's `hadOriginal=False` exists
# for. The trap is symmetric to the normal one — on restore the rig must REMOVE the
# file it added rather than leave an empty one or a copy of the E2E bundle behind,
# or the owner ends up with an instrumented plugin they never installed.
#
# The two-vault case checks that the borrows do not share state: each vault's marker
# and backup describe that vault, and restoring one does not disturb the other.
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

E2E_MAIN = (
    b"var __LS_E2E__=true;\n"
    + b"".join(b"~" + m.encode("utf-8") + b"~\n" for m in constants.E2E_BUILD_MARKERS)
)
PRODUCTION_MAIN = b"// production\n" * 25


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def digest_map(root: Path) -> dict[str, str]:
    return {
        p.relative_to(root).as_posix(): sha(p.read_bytes())
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


def make_root(tmp_path: Path, tag: str) -> Path:
    base = FIXTURE_ROOT if FIXTURE_ROOT.is_dir() else tmp_path
    root = (base / f"wp69b2-{tag}-{uuid.uuid4().hex}").resolve()
    for owner in OWNER_VAULTS:
        resolved = owner.resolve()
        assert root != resolved and resolved not in root.parents, (
            "ABORT: a WP69 fixture vault must never be rooted at or inside an owner vault"
        )
    return root


@pytest.fixture()
def bare_vault(tmp_path: Path) -> Iterator[Path]:
    """A plugin directory that exists but holds no bundle."""
    root = make_root(tmp_path, "bare")
    plugin_dir = root / constants.PLUGIN_DIR_REL
    plugin_dir.mkdir(parents=True)
    (plugin_dir / "manifest.json").write_bytes(b'{"id":"live-share","version":"0.6.1"}\n')
    (plugin_dir / "styles.css").write_bytes(b".x{}\n")
    (root / constants.COMMUNITY_PLUGINS_REL).write_bytes(b'["live-share"]\n')
    try:
        yield root
    finally:
        shutil.rmtree(root, ignore_errors=True)


@pytest.fixture()
def source_bundle(tmp_path: Path) -> Path:
    path = tmp_path / "e2e-main.js"
    path.write_bytes(E2E_MAIN)
    return path


def test_the_bare_vault_really_has_no_bundle(bare_vault: Path) -> None:
    assert not (bare_vault / constants.PLUGIN_MAIN_REL).exists()


def test_installing_into_a_bare_plugin_directory_writes_only_main_js(
    bare_vault: Path, source_bundle: Path
) -> None:
    before = set(digest_map(bare_vault))
    record = install.install_bundle(bare_vault, constants.ROLE_A, source_bundle)
    added = set(digest_map(bare_vault)) - before

    # `hadOriginal=False` + no backup file is the legal absent-original shape
    # (WP44's discipline, reused here rather than reinvented).
    assert added == {constants.PLUGIN_MAIN_REL, constants.INSTALL_MARKER_REL}
    assert not (bare_vault / constants.BUNDLE_BACKUP_REL).exists()
    assert record.had_original is False
    assert record.original_sha256 is None
    assert (bare_vault / constants.PLUGIN_MAIN_REL).read_bytes() == E2E_MAIN


def test_restore_removes_the_added_bundle_instead_of_emptying_it(
    bare_vault: Path, source_bundle: Path
) -> None:
    before = digest_map(bare_vault)

    install.install_bundle(bare_vault, constants.ROLE_A, source_bundle)
    result = install.restore_bundle(bare_vault)

    assert result.had_original is False
    assert result.bundle_file_present is False
    assert not (bare_vault / constants.PLUGIN_MAIN_REL).exists(), (
        "the rig's addition must be removed, not truncated to zero bytes"
    )
    assert digest_map(bare_vault) == before


def test_the_owners_other_plugin_files_are_untouched_in_the_bare_case(
    bare_vault: Path, source_bundle: Path
) -> None:
    watched = (
        constants.PLUGIN_DIR_REL + "/manifest.json",
        constants.PLUGIN_DIR_REL + "/styles.css",
        constants.COMMUNITY_PLUGINS_REL,
    )
    before = {rel: sha((bare_vault / rel).read_bytes()) for rel in watched}
    with install.installed_bundle(bare_vault, constants.ROLE_A, source_bundle):
        pass
    for rel in watched:
        assert sha((bare_vault / rel).read_bytes()) == before[rel]


def test_two_vaults_borrow_independently(tmp_path: Path, source_bundle: Path) -> None:
    roots = []
    for tag, role, original in (
        ("a", constants.ROLE_A, PRODUCTION_MAIN),
        ("b", constants.ROLE_B, PRODUCTION_MAIN + b"// per-vault difference\n"),
    ):
        root = make_root(tmp_path, tag)
        (root / constants.PLUGIN_DIR_REL).mkdir(parents=True)
        (root / constants.PLUGIN_MAIN_REL).write_bytes(original)
        roots.append((root, role, original))

    try:
        records = [
            install.install_bundle(root, role, source_bundle) for root, role, _ in roots
        ]
        assert records[0].original_sha256 != records[1].original_sha256
        assert {r.role for r in records} == {constants.ROLE_A, constants.ROLE_B}

        # restoring the first must not disturb the second
        install.restore_bundle(roots[0][0])
        assert (roots[0][0] / constants.PLUGIN_MAIN_REL).read_bytes() == roots[0][2]
        assert (roots[1][0] / constants.PLUGIN_MAIN_REL).read_bytes() == E2E_MAIN

        install.restore_bundle(roots[1][0])
        assert (roots[1][0] / constants.PLUGIN_MAIN_REL).read_bytes() == roots[1][2]
    finally:
        for root, _, _ in roots:
            shutil.rmtree(root, ignore_errors=True)


def test_the_bare_case_install_is_not_a_no_op(
    bare_vault: Path, source_bundle: Path
) -> None:
    install.install_bundle(bare_vault, constants.ROLE_A, source_bundle)
    installed = (bare_vault / constants.PLUGIN_MAIN_REL).read_bytes()
    counts = install.count_build_markers(installed)
    assert all(counts[m] >= 1 for m in constants.E2E_BUILD_MARKERS)
