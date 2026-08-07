# WP69 / AC3 — blind 2. Same subject (verification), different angle: the words
# **"before it is installed anywhere"**.
#
# AC3 does not say "verified"; it says verified *before it is installed anywhere*.
# So the verification is tested from the install side: a source bundle that is not
# demonstrably E2E-capable must be refused by `install_bundle` itself, with the
# vault left byte-for-byte as it was — no backup written, no marker written, no
# `main.js` replaced. An implementation that verifies in the build step only is
# correct until someone calls the install step with a path, which is exactly what
# WP7's gate run will do.
#
# The counterweight matters as much: a capable bundle must still install, or these
# assertions would pass against a module that refuses everything.
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

PRODUCTION_MAIN = b'"use strict";var CanvasBinding=1;module.exports={};\n' * 12
PRODUCTION_SHA = hashlib.sha256(PRODUCTION_MAIN).hexdigest()
CAPABLE = (
    b"var __LS_E2E__=true;\n"
    + b"".join(b"#" + m.encode("utf-8") + b"#\n" for m in constants.E2E_BUILD_MARKERS)
)


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
    root = (base / f"wp69b2-{uuid.uuid4().hex}").resolve()
    for owner in OWNER_VAULTS:
        resolved = owner.resolve()
        assert root != resolved and resolved not in root.parents, (
            "ABORT: a WP69 fixture vault must never be rooted at or inside an owner vault"
        )
    plugin_dir = root / constants.PLUGIN_DIR_REL
    plugin_dir.mkdir(parents=True)
    (plugin_dir / "main.js").write_bytes(PRODUCTION_MAIN)
    (plugin_dir / "manifest.json").write_bytes(b'{"id":"live-share"}\n')
    (plugin_dir / "data.json").write_bytes(b'{"roomId":"fixture-room"}\n')
    try:
        yield root
    finally:
        shutil.rmtree(root, ignore_errors=True)


def bundle(tmp_path: Path, data: bytes, name: str = "src-main.js") -> Path:
    path = tmp_path / name
    path.write_bytes(data)
    return path


@pytest.mark.parametrize("missing_index", [0, 1, 2])
def test_a_source_bundle_missing_one_marker_is_refused_before_anything_is_written(
    vault: Path, tmp_path: Path, missing_index: int
) -> None:
    kept = [m for i, m in enumerate(constants.E2E_BUILD_MARKERS) if i != missing_index]
    data = b"var __LS_E2E__=true;\n" + b"".join(
        b"#" + m.encode("utf-8") + b"#\n" for m in kept
    )
    before = digest_map(vault)

    with pytest.raises(install.BundleNotE2ECapable) as excinfo:
        install.install_bundle(vault, constants.ROLE_A, bundle(tmp_path, data))
    assert excinfo.value.reason == constants.BUNDLE_NOT_E2E_CAPABLE
    assert digest_map(vault) == before


def test_a_production_source_bundle_is_refused(vault: Path, tmp_path: Path) -> None:
    """Installing the production bundle over the production bundle would look like a
    success in every log and leave the gate with no endpoint — the current state."""
    before = digest_map(vault)
    with pytest.raises(install.BundleNotE2ECapable):
        install.install_bundle(vault, constants.ROLE_A, bundle(tmp_path, PRODUCTION_MAIN))
    assert digest_map(vault) == before


def test_an_empty_source_bundle_is_refused(vault: Path, tmp_path: Path) -> None:
    before = digest_map(vault)
    with pytest.raises(install.InstallError):
        install.install_bundle(vault, constants.ROLE_A, bundle(tmp_path, b""))
    assert digest_map(vault) == before


def test_a_missing_source_bundle_is_refused(vault: Path, tmp_path: Path) -> None:
    before = digest_map(vault)
    with pytest.raises(install.InstallError):
        install.install_bundle(vault, constants.ROLE_A, tmp_path / "never-built.js")
    assert digest_map(vault) == before


def test_no_restore_point_is_left_behind_by_a_refused_install(
    vault: Path, tmp_path: Path
) -> None:
    """A refusal must not leave a half-established borrow: the next run would then
    adopt a 'restore point' that was never the owner's file."""
    with pytest.raises(install.InstallError):
        install.install_bundle(vault, constants.ROLE_A, bundle(tmp_path, PRODUCTION_MAIN))
    assert not (vault / constants.BUNDLE_BACKUP_REL).exists()
    assert not (vault / constants.INSTALL_MARKER_REL).exists()
    state = install.capture_bundle_state(vault)
    assert state.has_marker is False


def test_a_capable_source_bundle_does_install(vault: Path, tmp_path: Path) -> None:
    """None of the refusals above may be unconditional."""
    record = install.install_bundle(vault, constants.ROLE_A, bundle(tmp_path, CAPABLE))
    assert (vault / constants.PLUGIN_MAIN_REL).read_bytes() == CAPABLE
    assert record.original_sha256 == PRODUCTION_SHA


def test_verification_of_the_source_bundle_agrees_with_the_install_decision(
    tmp_path: Path,
) -> None:
    capable = bundle(tmp_path, CAPABLE, "capable.js")
    incapable = bundle(tmp_path, PRODUCTION_MAIN, "incapable.js")

    assert install.verify_e2e_bundle(capable, exit_status=0).e2e_capable is True
    with pytest.raises(install.BundleNotE2ECapable):
        install.verify_e2e_bundle(incapable, exit_status=0)
