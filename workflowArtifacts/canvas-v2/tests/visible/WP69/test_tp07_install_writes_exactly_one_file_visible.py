# WP69 / AC4 — installation writes EXACTLY ONE file per vault:
# `<vault>/.obsidian/plugins/live-share/main.js`. `manifest.json`, `styles.css`,
# `data.json`, `community-plugins.json` and the vault's own pre-existing backups are
# never written, moved, renamed or deleted.
#
# The oracle is a sha256 map of every file in the vault, taken before and after —
# bytes, not log lines, and never the content of `data.json` (S4).
#
# DATA SAFETY: every vault here is a synthetic fixture created under `h:\tmp\` (or
# pytest's tmp_path if that is unavailable) and removed again. The owner's live
# vaults `H:\Developement\_NeuralAngels\ObsidianOrga` and `... - Kopie` are never
# constructed, opened, read or written by this file; `owner_vault_guard` asserts it.
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

PRODUCTION_MAIN = b'"use strict";var live=1;module.exports={};\n' * 8
E2E_MAIN = (
    b'"use strict";var __LS_E2E__=true;\n'
    + b"".join(b"/* " + m.encode("utf-8") + b" */\n" for m in constants.E2E_BUILD_MARKERS)
    + b"module.exports={};\n"
)

#: Obviously fake — no value here resembles a credential, and none is ever printed.
FAKE_DATA_JSON = b'{"serverPassword":"FAKE-NOT-REAL-0000","roomId":"fixture-room"}\n'


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def digest_map(root: Path) -> dict[str, str]:
    return {
        p.relative_to(root).as_posix(): sha(p.read_bytes())
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


@pytest.fixture()
def vault(tmp_path: Path) -> Iterator[Path]:
    base = FIXTURE_ROOT if FIXTURE_ROOT.is_dir() else tmp_path
    root = (base / f"wp69-{uuid.uuid4().hex}").resolve()
    for owner in OWNER_VAULTS:
        resolved = owner.resolve()
        assert root != resolved and resolved not in root.parents, (
            "ABORT: a WP69 fixture vault must never be rooted at or inside an owner vault"
        )
    plugin_dir = root / constants.PLUGIN_DIR_REL
    plugin_dir.mkdir(parents=True)
    (plugin_dir / "main.js").write_bytes(PRODUCTION_MAIN)
    (plugin_dir / "manifest.json").write_bytes(b'{"id":"live-share","version":"0.6.1"}\n')
    (plugin_dir / "styles.css").write_bytes(b".live-share{color:red}\n")
    (plugin_dir / "data.json").write_bytes(FAKE_DATA_JSON)
    (plugin_dir / "main.js.bak").write_bytes(b"owner backup, not ours\n")
    (plugin_dir / "main.js.0.5.9.bak").write_bytes(b"older owner backup\n")
    (plugin_dir / "manifest.json.bak").write_bytes(b'{"id":"live-share"}\n')
    (root / constants.COMMUNITY_PLUGINS_REL).write_bytes(b'["live-share"]\n')
    (root / "Inbox.md").write_bytes(b"# Inbox\n")
    try:
        yield root
    finally:
        shutil.rmtree(root, ignore_errors=True)


@pytest.fixture()
def source_bundle(tmp_path: Path) -> Path:
    path = tmp_path / "built-main.js"
    path.write_bytes(E2E_MAIN)
    return path


def test_the_installed_file_is_the_pinned_plugin_main_path(
    vault: Path, source_bundle: Path
) -> None:
    record = install.install_bundle(vault, constants.ROLE_A, source_bundle)
    assert Path(record.bundle_path) == vault / constants.PLUGIN_MAIN_REL
    assert (vault / constants.PLUGIN_MAIN_REL).read_bytes() == E2E_MAIN
    # The repo folder name is `obsidian-live-share`; installing there installs nothing.
    assert "obsidian-live-share" not in Path(record.bundle_path).as_posix()


def test_only_main_js_changes_identity(vault: Path, source_bundle: Path) -> None:
    before = digest_map(vault)
    install.install_bundle(vault, constants.ROLE_A, source_bundle)
    after = digest_map(vault)

    changed = {k for k in before if before[k] != after.get(k)}
    assert changed == {constants.PLUGIN_MAIN_REL}


def test_the_only_new_paths_are_the_rigs_own_backup_and_marker(
    vault: Path, source_bundle: Path
) -> None:
    before = set(digest_map(vault))
    install.install_bundle(vault, constants.ROLE_A, source_bundle)
    after = set(digest_map(vault))

    assert after - before == {constants.BUNDLE_BACKUP_REL, constants.INSTALL_MARKER_REL}
    assert before - after == set(), "installation removed a file"


def test_nothing_the_owner_owns_is_removed_or_renamed(
    vault: Path, source_bundle: Path
) -> None:
    plugin_dir = vault / constants.PLUGIN_DIR_REL
    owned = {
        "manifest.json",
        "styles.css",
        "data.json",
        "main.js.bak",
        "main.js.0.5.9.bak",
        "manifest.json.bak",
    }
    before = {p.name: sha(p.read_bytes()) for p in plugin_dir.iterdir() if p.is_file()}

    install.install_bundle(vault, constants.ROLE_A, source_bundle)

    after = {p.name: sha(p.read_bytes()) for p in plugin_dir.iterdir() if p.is_file()}
    for name in owned:
        assert name in after, f"{name} disappeared from the plugin directory"
        assert after[name] == before[name], f"{name} was rewritten"


def test_the_record_states_what_it_displaced(vault: Path, source_bundle: Path) -> None:
    record = install.install_bundle(vault, constants.ROLE_A, source_bundle)
    assert record.had_original is True
    assert record.original_sha256 == sha(PRODUCTION_MAIN)
    assert record.original_size == len(PRODUCTION_MAIN)
    assert record.installed_sha256 == sha(E2E_MAIN)
    assert record.role == constants.ROLE_A
    # The displaced production bundle is captured under the RIG's namespace, and the
    # backup holds it verbatim.
    assert (vault / constants.BUNDLE_BACKUP_REL).read_bytes() == PRODUCTION_MAIN


def test_the_installed_bundle_is_genuinely_different_from_what_it_replaced(
    vault: Path, source_bundle: Path
) -> None:
    """Guards every assertion above from passing on a no-op implementation."""
    install.install_bundle(vault, constants.ROLE_A, source_bundle)
    installed = (vault / constants.PLUGIN_MAIN_REL).read_bytes()
    assert sha(installed) != sha(PRODUCTION_MAIN)
    counts = install.count_build_markers(installed)
    assert all(counts[m] >= 1 for m in constants.E2E_BUILD_MARKERS)
