# WP69 / AC3 — success is decided by the build's EXIT STATUS **and** by finding all
# three E2E build markers in the emitted main.js. Never by the file existing, never
# by its mtime moving.
#
# The rejected alternative in the BUILD_SPEC is precisely "fire and forget the
# watcher, poll main.js, kill it": a killed watcher can leave a truncated bundle,
# which would then be installed into the owner's vaults. So the two halves of the
# oracle are tested separately, and each is shown to be able to fail on its own:
#
#   ├── exit 0 + all three markers   → capable
#   ├── exit non-zero + all markers  → refusal (status alone can veto)
#   └── exit 0 + two of three        → refusal (markers alone can veto)
#
# No sleeps, no polling, no real build.
#
# Run: .venv\Scripts\python.exe -m pytest <this file>   (from the AgenticWorkspace root)

from __future__ import annotations

import hashlib
import os
import sys
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


def bundle_with(markers) -> bytes:
    body = b'"use strict";var __LS_E2E__=true;\n'
    for marker in markers:
        body += b"/* " + marker.encode("utf-8") + b" */\n"
    return body + b"module.exports={};\n"


ALL_MARKERS = bundle_with(constants.E2E_BUILD_MARKERS)


@pytest.fixture()
def bundle(tmp_path: Path) -> Path:
    path = tmp_path / "main.js"
    path.write_bytes(ALL_MARKERS)
    return path


def test_exit_zero_with_all_markers_is_capable(bundle: Path) -> None:
    result = install.verify_e2e_bundle(bundle, exit_status=0)
    assert result.e2e_capable is True
    assert result.exit_status == 0
    assert tuple(result.markers_found) == tuple(constants.E2E_BUILD_MARKERS)
    assert tuple(result.markers_missing) == ()
    assert result.size == len(ALL_MARKERS)
    assert result.sha256 == hashlib.sha256(ALL_MARKERS).hexdigest()


@pytest.mark.parametrize("status", [1, 2, 127, -1])
def test_a_non_zero_exit_is_refused_even_with_every_marker_present(
    bundle: Path, status: int
) -> None:
    with pytest.raises(install.E2EBuildFailed) as excinfo:
        install.verify_e2e_bundle(bundle, exit_status=status)
    assert excinfo.value.reason == constants.E2E_BUILD_FAILED


@pytest.mark.parametrize("missing", list(constants.E2E_BUILD_MARKERS))
def test_a_single_missing_marker_is_refused_on_a_clean_exit(
    tmp_path: Path, missing: str
) -> None:
    kept = [m for m in constants.E2E_BUILD_MARKERS if m != missing]
    path = tmp_path / "main.js"
    path.write_bytes(bundle_with(kept))

    with pytest.raises(install.BundleNotE2ECapable) as excinfo:
        install.verify_e2e_bundle(path, exit_status=0)
    assert excinfo.value.reason == constants.BUNDLE_NOT_E2E_CAPABLE


def test_file_presence_is_not_the_signal(tmp_path: Path) -> None:
    """The exact defect class C69 rejects: a bundle is there, and it proves nothing."""
    path = tmp_path / "main.js"
    path.write_bytes(ALL_MARKERS)
    assert path.is_file()  # present, complete, and still not a verdict

    with pytest.raises(install.E2EBuildFailed):
        install.verify_e2e_bundle(path, exit_status=1)


def test_an_mtime_move_is_not_the_signal(tmp_path: Path) -> None:
    """mtime is set from the filesystem clock; the oracle must not consult it."""
    path = tmp_path / "main.js"
    path.write_bytes(ALL_MARKERS)
    before = path.stat().st_mtime_ns
    path.write_bytes(ALL_MARKERS + b"// rewritten\n")
    # os.utime rather than a sleep: no wall-clock waiting anywhere in this suite.
    os.utime(path, ns=(before + 1_000_000_000, before + 1_000_000_000))
    assert path.stat().st_mtime_ns != before

    with pytest.raises(install.E2EBuildFailed):
        install.verify_e2e_bundle(path, exit_status=1)


def test_a_missing_bundle_is_refused_rather_than_crashing(tmp_path: Path) -> None:
    with pytest.raises(install.InstallError):
        install.verify_e2e_bundle(tmp_path / "main.js", exit_status=0)


def test_a_truncated_bundle_is_refused(tmp_path: Path) -> None:
    """A watcher killed mid-write leaves exactly this shape."""
    path = tmp_path / "main.js"
    path.write_bytes(ALL_MARKERS[: len(ALL_MARKERS) // 3])

    with pytest.raises(install.BundleNotE2ECapable) as excinfo:
        install.verify_e2e_bundle(path, exit_status=0)
    assert excinfo.value.reason == constants.BUNDLE_NOT_E2E_CAPABLE
