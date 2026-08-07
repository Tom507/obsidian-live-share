# WP69 / AC4 — "restoration runs on every exit path including failure, abort and
# interruption, and after restore each vault's main.js sha256 equals the recorded
# production value."
#
# The oracle is sha256 of bytes against the value recorded BEFORE the install — not
# the rig's own bookkeeping, and not a log line.
#
#   ├── T1 normal exit of the context manager restores byte-exactly
#   ├── T2 an exception inside the context restores and re-raises
#   ├── T3 a KeyboardInterrupt (the "abort" path) restores
#   ├── T4 the file really was replaced in between — a no-op install must not pass T1
#   └── T5 restore leaves no rig artefact behind, and is a safe no-op when repeated
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
    (plugin_dir / "manifest.json").write_bytes(b'{"id":"live-share"}\n')
    try:
        yield root
    finally:
        shutil.rmtree(root, ignore_errors=True)


@pytest.fixture()
def source_bundle(tmp_path: Path) -> Path:
    path = tmp_path / "built-main.js"
    path.write_bytes(E2E_MAIN)
    return path


def main_js(vault: Path) -> bytes:
    return (vault / constants.PLUGIN_MAIN_REL).read_bytes()


def test_normal_exit_restores_byte_exactly(vault: Path, source_bundle: Path) -> None:
    with install.installed_bundle(vault, constants.ROLE_A, source_bundle) as record:
        assert record.original_sha256 == PRODUCTION_SHA
        assert main_js(vault) == E2E_MAIN
    assert sha(main_js(vault)) == PRODUCTION_SHA
    assert main_js(vault) == PRODUCTION_MAIN


def test_an_exception_inside_the_context_still_restores(
    vault: Path, source_bundle: Path
) -> None:
    class Boom(RuntimeError):
        pass

    with pytest.raises(Boom):
        with install.installed_bundle(vault, constants.ROLE_A, source_bundle):
            assert main_js(vault) == E2E_MAIN
            raise Boom("the gate failed mid-run")

    assert sha(main_js(vault)) == PRODUCTION_SHA


def test_an_abort_inside_the_context_still_restores(
    vault: Path, source_bundle: Path
) -> None:
    """KeyboardInterrupt derives from BaseException — a bare `except Exception:`
    teardown would leave the owner's vault holding an instrumented bundle."""
    with pytest.raises(KeyboardInterrupt):
        with install.installed_bundle(vault, constants.ROLE_A, source_bundle):
            raise KeyboardInterrupt

    assert sha(main_js(vault)) == PRODUCTION_SHA


def test_the_bundle_was_genuinely_replaced_in_between(
    vault: Path, source_bundle: Path
) -> None:
    """Without this, a do-nothing install would make every restore test green."""
    with install.installed_bundle(vault, constants.ROLE_A, source_bundle):
        during = main_js(vault)
    assert sha(during) != PRODUCTION_SHA
    assert during == E2E_MAIN
    assert main_js(vault) == PRODUCTION_MAIN


def test_restore_leaves_no_rig_artefact_behind(vault: Path, source_bundle: Path) -> None:
    plugin_dir = vault / constants.PLUGIN_DIR_REL
    names_before = sorted(p.name for p in plugin_dir.iterdir())

    install.install_bundle(vault, constants.ROLE_A, source_bundle)
    assert (vault / constants.BUNDLE_BACKUP_REL).is_file()
    assert (vault / constants.INSTALL_MARKER_REL).is_file()

    result = install.restore_bundle(vault)
    assert result.restored is True
    assert result.restored_sha256 == PRODUCTION_SHA
    assert not (vault / constants.BUNDLE_BACKUP_REL).exists()
    assert not (vault / constants.INSTALL_MARKER_REL).exists()
    assert sorted(p.name for p in plugin_dir.iterdir()) == names_before


def test_restore_with_nothing_borrowed_is_a_safe_no_op(vault: Path) -> None:
    """It is called unconditionally from a `finally`, so it must be callable twice."""
    result = install.restore_bundle(vault)
    assert result.restored is False
    assert main_js(vault) == PRODUCTION_MAIN


def test_restore_is_idempotent_after_a_completed_restore(
    vault: Path, source_bundle: Path
) -> None:
    install.install_bundle(vault, constants.ROLE_A, source_bundle)
    install.restore_bundle(vault)
    again = install.restore_bundle(vault)
    assert again.restored is False
    assert main_js(vault) == PRODUCTION_MAIN
