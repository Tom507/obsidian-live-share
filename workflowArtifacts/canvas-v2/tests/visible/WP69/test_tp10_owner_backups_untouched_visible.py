# WP69 / AC4 — the vault's own pre-existing backups are NOT OURS.
#
# `main.js.bak`, `main.js.0.5.9.bak` and `manifest.json.bak` were measured in both
# plugin directories by the pre-flight. They are never written, moved, renamed or
# deleted, and — the part that is easy to get wrong — they are never used as this
# WP's restore point. The rig has its own backup namespace and restores from that
# and nothing else.
#
# DATA SAFETY: synthetic fixture vaults under `h:\tmp\` (or pytest's tmp_path), removed
# again. The owner's live vaults are never touched.
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

#: Measured by T3_PREFLIGHT in both plugin directories. Fixture data, not a constant
#: the rig may key behaviour off.
OWNER_BACKUPS = {
    "main.js.bak": b"// owner backup of a previous bundle\n",
    "main.js.0.5.9.bak": b"// owner backup, version 0.5.9\n",
    "manifest.json.bak": b'{"id":"live-share","version":"0.5.9"}\n',
}

PRODUCTION_MAIN = b'"use strict";var live=1;module.exports={};\n' * 8
PRODUCTION_SHA = hashlib.sha256(PRODUCTION_MAIN).hexdigest()
E2E_MAIN = (
    b'"use strict";var __LS_E2E__=true;\n'
    + b"".join(b"/* " + m.encode("utf-8") + b" */\n" for m in constants.E2E_BUILD_MARKERS)
    + b"module.exports={};\n"
)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


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
    for name, data in OWNER_BACKUPS.items():
        (plugin_dir / name).write_bytes(data)
    try:
        yield root
    finally:
        shutil.rmtree(root, ignore_errors=True)


@pytest.fixture()
def source_bundle(tmp_path: Path) -> Path:
    path = tmp_path / "built-main.js"
    path.write_bytes(E2E_MAIN)
    return path


def test_the_owner_backups_survive_install_and_restore_unchanged(
    vault: Path, source_bundle: Path
) -> None:
    plugin_dir = vault / constants.PLUGIN_DIR_REL

    install.install_bundle(vault, constants.ROLE_A, source_bundle)
    for name, data in OWNER_BACKUPS.items():
        assert (plugin_dir / name).read_bytes() == data

    install.restore_bundle(vault)
    for name, data in OWNER_BACKUPS.items():
        assert (plugin_dir / name).read_bytes() == data


def test_the_rigs_backup_path_is_none_of_the_owners(vault: Path) -> None:
    rig_backup = Path(constants.BUNDLE_BACKUP_REL).name
    rig_marker = Path(constants.INSTALL_MARKER_REL).name
    assert rig_backup not in OWNER_BACKUPS
    assert rig_marker not in OWNER_BACKUPS
    # Both live inside the plugin directory (S4), not beside the vault.
    assert constants.BUNDLE_BACKUP_REL.startswith(constants.PLUGIN_DIR_REL + "/")
    assert constants.INSTALL_MARKER_REL.startswith(constants.PLUGIN_DIR_REL + "/")


def test_restore_does_not_fall_back_to_the_owners_main_js_bak(
    vault: Path, source_bundle: Path
) -> None:
    """The trap: `main.js.bak` is right there and looks like a restore point.

    Here it holds bytes that would *satisfy* a naive restore, so an implementation
    that reaches for it would look correct. It must refuse instead — the rig's own
    backup is the only restore point it recognises.
    """
    plugin_dir = vault / constants.PLUGIN_DIR_REL
    (plugin_dir / "main.js.bak").write_bytes(PRODUCTION_MAIN)

    install.install_bundle(vault, constants.ROLE_A, source_bundle)
    (vault / constants.BUNDLE_BACKUP_REL).write_bytes(b"corrupted rig backup\n")

    with pytest.raises(install.BundleRestoreMismatch) as excinfo:
        install.restore_bundle(vault)
    assert excinfo.value.reason == constants.BUNDLE_RESTORE_MISMATCH
    # A file nobody can reconstruct is strictly worse than a loud refusal: the rig
    # keeps its evidence rather than writing a bundle it cannot vouch for.
    assert (vault / constants.BUNDLE_BACKUP_REL).is_file()
    assert (vault / constants.INSTALL_MARKER_REL).is_file()
    assert (plugin_dir / "main.js").read_bytes() == E2E_MAIN
    assert (plugin_dir / "main.js.bak").read_bytes() == PRODUCTION_MAIN


def test_a_healthy_rig_backup_does_restore(vault: Path, source_bundle: Path) -> None:
    """The refusal above must not be an unconditional raise."""
    install.install_bundle(vault, constants.ROLE_A, source_bundle)
    result = install.restore_bundle(vault)
    assert result.restored is True
    assert result.restored_sha256 == PRODUCTION_SHA


def test_the_plugin_directory_gains_and_loses_only_the_rigs_two_files(
    vault: Path, source_bundle: Path
) -> None:
    plugin_dir = vault / constants.PLUGIN_DIR_REL
    before = {p.name for p in plugin_dir.iterdir()}

    install.install_bundle(vault, constants.ROLE_A, source_bundle)
    during = {p.name for p in plugin_dir.iterdir()}
    assert during - before == {
        Path(constants.BUNDLE_BACKUP_REL).name,
        Path(constants.INSTALL_MARKER_REL).name,
    }
    assert before - during == set()

    install.restore_bundle(vault)
    assert {p.name for p in plugin_dir.iterdir()} == before
