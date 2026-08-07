# WP69 / AC4 — blind 2. Same subject (restore), different angle: **restore verifies
# its own work, and refuses rather than write something it cannot vouch for**.
#
# "After restore each vault's main.js sha256 equals the recorded production value"
# is a check the module must perform on itself, not only a property a test asserts.
# The distinction matters at 3am on the owner's live vault: a restore that writes
# and hopes leaves a wrong bundle installed with a green log line next to it.
#
# Angles used here and nowhere else in this WP's suite:
#   ├── the restore path is INDEPENDENT of the modify path — the backup is written
#   │   back verbatim, with no parse, no re-serialise, no normalisation
#   ├── a corrupted restore point is a loud refusal that KEEPS its evidence
#   ├── no temporary file survives any path
#   └── restore is safe to call before any install, twice, and after a refusal
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

#: JSON-shaped on purpose: a restore that "helpfully" re-serialises would reorder
#: these keys and change the bytes while keeping the meaning.
PRODUCTION_MAIN = (
    b'\xef\xbb\xbf/*{"z":1,"a":2,  "nested":{"b":[3,4]}}*/\r\n'
    b"var x=1;\r\n\r\n\r\n// trailing whitespace   \t\r\n"
) + bytes(range(256))
PRODUCTION_SHA = hashlib.sha256(PRODUCTION_MAIN).hexdigest()
E2E_MAIN = (
    b"var __LS_E2E__=true;\n"
    + b"".join(b"^" + m.encode("utf-8") + b"^\n" for m in constants.E2E_BUILD_MARKERS)
)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


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
    try:
        yield root
    finally:
        shutil.rmtree(root, ignore_errors=True)


@pytest.fixture()
def source_bundle(tmp_path: Path) -> Path:
    path = tmp_path / "e2e-main.js"
    path.write_bytes(E2E_MAIN)
    return path


def plugin_files(vault: Path) -> set[str]:
    return {p.name for p in (vault / constants.PLUGIN_DIR_REL).iterdir()}


def test_the_bytes_come_back_with_no_normalisation_whatsoever(
    vault: Path, source_bundle: Path
) -> None:
    with install.installed_bundle(vault, constants.ROLE_A, source_bundle):
        pass
    restored = (vault / constants.PLUGIN_MAIN_REL).read_bytes()
    assert restored == PRODUCTION_MAIN
    assert restored[:3] == b"\xef\xbb\xbf"  # the BOM survived
    assert restored.count(b"\r\n") == PRODUCTION_MAIN.count(b"\r\n")
    assert restored.endswith(PRODUCTION_MAIN[-16:])


def test_a_corrupted_restore_point_is_a_refusal_that_keeps_its_evidence(
    vault: Path, source_bundle: Path
) -> None:
    install.install_bundle(vault, constants.ROLE_A, source_bundle)
    (vault / constants.BUNDLE_BACKUP_REL).write_bytes(PRODUCTION_MAIN[:-1])

    with pytest.raises(install.BundleRestoreMismatch) as excinfo:
        install.restore_bundle(vault)
    assert excinfo.value.reason == constants.BUNDLE_RESTORE_MISMATCH
    assert (vault / constants.BUNDLE_BACKUP_REL).is_file()
    assert (vault / constants.INSTALL_MARKER_REL).is_file()
    # the live file is untouched: the module did not write a bundle it could not vouch for
    assert (vault / constants.PLUGIN_MAIN_REL).read_bytes() == E2E_MAIN


def test_a_truncation_of_a_single_byte_is_caught(
    vault: Path, source_bundle: Path
) -> None:
    """Length and hash together — a same-length corruption and a one-byte truncation
    are both caught, and neither is a plausible 'close enough'."""
    install.install_bundle(vault, constants.ROLE_A, source_bundle)
    tampered = bytearray(PRODUCTION_MAIN)
    tampered[len(tampered) // 2] ^= 0x01
    (vault / constants.BUNDLE_BACKUP_REL).write_bytes(bytes(tampered))

    with pytest.raises(install.BundleRestoreMismatch):
        install.restore_bundle(vault)


def test_no_temporary_file_survives_any_path(
    vault: Path, source_bundle: Path
) -> None:
    before = plugin_files(vault)

    install.install_bundle(vault, constants.ROLE_A, source_bundle)
    after_install = plugin_files(vault)
    assert after_install - before == {
        Path(constants.BUNDLE_BACKUP_REL).name,
        Path(constants.INSTALL_MARKER_REL).name,
    }

    install.restore_bundle(vault)
    assert plugin_files(vault) == before


def test_no_temporary_file_survives_a_refused_restore(
    vault: Path, source_bundle: Path
) -> None:
    install.install_bundle(vault, constants.ROLE_A, source_bundle)
    expected = plugin_files(vault)
    (vault / constants.BUNDLE_BACKUP_REL).write_bytes(b"corrupt\n")

    with pytest.raises(install.BundleRestoreMismatch):
        install.restore_bundle(vault)
    assert plugin_files(vault) == expected


def test_restore_before_any_install_is_a_no_op(vault: Path) -> None:
    result = install.restore_bundle(vault)
    assert result.restored is False
    assert result.reason is None
    assert (vault / constants.PLUGIN_MAIN_REL).read_bytes() == PRODUCTION_MAIN
    assert plugin_files(vault) == {"main.js"}


def test_restore_reports_the_hash_it_verified(vault: Path, source_bundle: Path) -> None:
    install.install_bundle(vault, constants.ROLE_A, source_bundle)
    result = install.restore_bundle(vault)
    assert result.restored is True
    assert result.bundle_file_present is True
    assert result.restored_sha256 == PRODUCTION_SHA
    assert result.restored_size == len(PRODUCTION_MAIN)
    assert sha((vault / constants.PLUGIN_MAIN_REL).read_bytes()) == result.restored_sha256


def test_the_install_really_did_replace_the_bundle(
    vault: Path, source_bundle: Path
) -> None:
    """The whole file would pass against a no-op install without this."""
    install.install_bundle(vault, constants.ROLE_A, source_bundle)
    assert (vault / constants.PLUGIN_MAIN_REL).read_bytes() == E2E_MAIN
    assert sha(E2E_MAIN) != PRODUCTION_SHA
