# WP69 / AC4 — "An install that cannot establish its restore point does not install."
#
# Restore is the criterion, not the intention: an install that writes before its
# restore point is established has already failed AC4 even if it later restores
# correctly. So every refusal below is checked twice — the named raise, and the
# vault being byte-for-byte as it was.
#
# DATA SAFETY: synthetic fixture vaults under `h:\tmp\` (or pytest's tmp_path), removed
# again. The owner's live vaults are never touched; `vault` asserts it.
#
# Run: .venv\Scripts\python.exe -m pytest <this file>   (from the AgenticWorkspace root)

from __future__ import annotations

import hashlib
import json
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


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def digest_map(root: Path) -> dict[str, str]:
    return {
        p.relative_to(root).as_posix(): sha(p.read_bytes())
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


def new_root(tmp_path: Path) -> Path:
    base = FIXTURE_ROOT if FIXTURE_ROOT.is_dir() else tmp_path
    root = (base / f"wp69-{uuid.uuid4().hex}").resolve()
    for owner in OWNER_VAULTS:
        resolved = owner.resolve()
        assert root != resolved and resolved not in root.parents, (
            "ABORT: a WP69 fixture vault must never be rooted at or inside an owner vault"
        )
    return root


@pytest.fixture()
def vault(tmp_path: Path) -> Iterator[Path]:
    root = new_root(tmp_path)
    plugin_dir = root / constants.PLUGIN_DIR_REL
    plugin_dir.mkdir(parents=True)
    (plugin_dir / "main.js").write_bytes(PRODUCTION_MAIN)
    (plugin_dir / "data.json").write_bytes(b'{"roomId":"fixture-room"}\n')
    try:
        yield root
    finally:
        shutil.rmtree(root, ignore_errors=True)


@pytest.fixture()
def empty_vault(tmp_path: Path) -> Iterator[Path]:
    root = new_root(tmp_path)
    (root / ".obsidian").mkdir(parents=True)
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


def test_a_missing_plugin_directory_refuses_and_creates_nothing(
    empty_vault: Path, source_bundle: Path
) -> None:
    before = digest_map(empty_vault)
    with pytest.raises(install.InstallError):
        install.install_bundle(empty_vault, constants.ROLE_A, source_bundle)
    assert digest_map(empty_vault) == before
    assert not (empty_vault / constants.PLUGIN_DIR_REL).exists(), (
        "the rig must not create a plugin directory inside a vault"
    )


def test_a_backup_with_no_marker_is_a_conflict_and_writes_nothing(
    vault: Path, source_bundle: Path
) -> None:
    (vault / constants.BUNDLE_BACKUP_REL).write_bytes(b"unattributed debris\n")
    before = digest_map(vault)

    with pytest.raises(install.InstallConflict) as excinfo:
        install.install_bundle(vault, constants.ROLE_A, source_bundle)
    assert excinfo.value.reason == constants.INSTALL_CONFLICT
    assert digest_map(vault) == before
    assert (vault / constants.PLUGIN_MAIN_REL).read_bytes() == PRODUCTION_MAIN


def test_a_marker_claiming_a_backup_that_is_absent_is_a_conflict(
    vault: Path, source_bundle: Path
) -> None:
    (vault / constants.INSTALL_MARKER_REL).write_bytes(
        json.dumps(
            {
                "runId": "20260101T000000Z-1-aaaaaa",
                "role": constants.ROLE_A,
                "hadOriginal": True,
                "originalSha256": sha(PRODUCTION_MAIN),
                "originalSize": len(PRODUCTION_MAIN),
                "installedSha256": sha(E2E_MAIN),
                "pid": 1,
                "createdAt": "2026-01-01T00:00:00Z",
            }
        ).encode("utf-8")
    )
    before = digest_map(vault)

    with pytest.raises(install.InstallConflict):
        install.install_bundle(vault, constants.ROLE_A, source_bundle)
    assert digest_map(vault) == before


def test_a_backup_that_does_not_match_its_recorded_hash_is_a_conflict(
    vault: Path, source_bundle: Path
) -> None:
    (vault / constants.BUNDLE_BACKUP_REL).write_bytes(b"corrupted backup\n")
    (vault / constants.INSTALL_MARKER_REL).write_bytes(
        json.dumps(
            {
                "runId": "20260101T000000Z-1-aaaaaa",
                "role": constants.ROLE_A,
                "hadOriginal": True,
                "originalSha256": sha(PRODUCTION_MAIN),
                "originalSize": len(PRODUCTION_MAIN),
                "installedSha256": sha(E2E_MAIN),
                "pid": 1,
                "createdAt": "2026-01-01T00:00:00Z",
            }
        ).encode("utf-8")
    )
    before = digest_map(vault)

    with pytest.raises(install.InstallConflict):
        install.install_bundle(vault, constants.ROLE_A, source_bundle)
    assert digest_map(vault) == before


def test_the_backup_exists_and_is_correct_before_main_js_is_overwritten(
    vault: Path, source_bundle: Path
) -> None:
    """Order, not just outcome: capture_bundle_state must already see the original."""
    install.install_bundle(vault, constants.ROLE_A, source_bundle)
    state = install.capture_bundle_state(vault)
    assert state.has_marker is True
    assert state.had_original is True
    assert state.original_sha256 == sha(PRODUCTION_MAIN)
    assert (vault / constants.BUNDLE_BACKUP_REL).read_bytes() == PRODUCTION_MAIN
    # …and the live file really was replaced, so the check above is not trivial.
    assert (vault / constants.PLUGIN_MAIN_REL).read_bytes() == E2E_MAIN


def test_a_clean_vault_installs(vault: Path, source_bundle: Path) -> None:
    """The refusals above must not be an unconditional raise."""
    record = install.install_bundle(vault, constants.ROLE_A, source_bundle)
    assert record.adopted_existing_backup is False
    assert (vault / constants.PLUGIN_MAIN_REL).read_bytes() == E2E_MAIN
