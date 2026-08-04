# WP69 / AC4 — blind 1. Same subject (the restore point), different angle:
# **a second install over an existing borrow**, which is what a crashed run leaves
# behind and what a retry does.
#
# WP44 established the discipline this WP follows rather than invents: if a backup
# already exists it IS the original and is never overwritten by the current,
# already-instrumented state. Get that wrong and the restore point becomes a copy of
# the E2E bundle — the vault is then "restored" to an instrumented build, every hash
# check passes against the rig's own bookkeeping, and the owner's Obsidian quietly
# runs a debug bundle for ever.
#
# The oracle is the recorded production sha256 captured before anything was written.
#
# DATA SAFETY: synthetic fixture vaults under `h:\tmp\` (or pytest's tmp_path),
# removed again. The owner's live vaults are never touched.
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

PRODUCTION_MAIN = b"// the owner's production bundle\n" + bytes(range(200)) * 3
PRODUCTION_SHA = hashlib.sha256(PRODUCTION_MAIN).hexdigest()


def e2e_bundle(tag: bytes) -> bytes:
    return (
        b"var __LS_E2E__=true;// " + tag + b"\n"
        + b"".join(b"<" + m.encode("utf-8") + b">\n" for m in constants.E2E_BUILD_MARKERS)
    )


FIRST = e2e_bundle(b"first build")
SECOND = e2e_bundle(b"second build")


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
    root = (base / f"wp69b1-{uuid.uuid4().hex}").resolve()
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


def bundle_file(tmp_path: Path, data: bytes, name: str) -> Path:
    path = tmp_path / name
    path.write_bytes(data)
    return path


def test_a_second_install_does_not_overwrite_the_captured_original(
    vault: Path, tmp_path: Path
) -> None:
    first = bundle_file(tmp_path, FIRST, "first.js")
    second = bundle_file(tmp_path, SECOND, "second.js")

    install.install_bundle(vault, constants.ROLE_A, first)
    install.install_bundle(vault, constants.ROLE_A, second)

    assert (vault / constants.BUNDLE_BACKUP_REL).read_bytes() == PRODUCTION_MAIN
    assert (vault / constants.PLUGIN_MAIN_REL).read_bytes() == SECOND


def test_the_second_install_says_it_adopted_the_existing_borrow(
    vault: Path, tmp_path: Path
) -> None:
    first = bundle_file(tmp_path, FIRST, "first.js")
    second = bundle_file(tmp_path, SECOND, "second.js")

    one = install.install_bundle(vault, constants.ROLE_A, first)
    two = install.install_bundle(vault, constants.ROLE_A, second)

    assert one.adopted_existing_backup is False
    assert two.adopted_existing_backup is True
    assert two.original_sha256 == PRODUCTION_SHA == one.original_sha256


def test_restore_after_two_installs_returns_the_production_bundle(
    vault: Path, tmp_path: Path
) -> None:
    install.install_bundle(vault, constants.ROLE_A, bundle_file(tmp_path, FIRST, "a.js"))
    install.install_bundle(vault, constants.ROLE_A, bundle_file(tmp_path, SECOND, "b.js"))

    result = install.restore_bundle(vault)
    assert result.restored is True
    assert result.restored_sha256 == PRODUCTION_SHA
    assert (vault / constants.PLUGIN_MAIN_REL).read_bytes() == PRODUCTION_MAIN


def test_two_installs_leave_exactly_one_backup_and_one_marker(
    vault: Path, tmp_path: Path
) -> None:
    plugin_dir = vault / constants.PLUGIN_DIR_REL
    before = {p.name for p in plugin_dir.iterdir()}

    install.install_bundle(vault, constants.ROLE_A, bundle_file(tmp_path, FIRST, "a.js"))
    install.install_bundle(vault, constants.ROLE_A, bundle_file(tmp_path, SECOND, "b.js"))

    added = {p.name for p in plugin_dir.iterdir()} - before
    assert added == {
        Path(constants.BUNDLE_BACKUP_REL).name,
        Path(constants.INSTALL_MARKER_REL).name,
    }


def test_a_crashed_run_leaves_a_recoverable_borrow(vault: Path, tmp_path: Path) -> None:
    """No context manager, no restore — the process simply died. The next run must
    still be able to give the owner the original back."""
    install.install_bundle(vault, constants.ROLE_A, bundle_file(tmp_path, FIRST, "a.js"))
    # crash: nothing runs, the instrumented bundle stays installed
    assert (vault / constants.PLUGIN_MAIN_REL).read_bytes() == FIRST

    state = install.capture_bundle_state(vault)
    assert state.has_marker is True
    assert state.had_original is True
    assert state.original_sha256 == PRODUCTION_SHA

    result = install.restore_bundle(vault)
    assert result.restored_sha256 == PRODUCTION_SHA
    assert (vault / constants.PLUGIN_MAIN_REL).read_bytes() == PRODUCTION_MAIN


def test_a_marker_whose_backup_hash_disagrees_refuses_and_writes_nothing(
    vault: Path, tmp_path: Path
) -> None:
    install.install_bundle(vault, constants.ROLE_A, bundle_file(tmp_path, FIRST, "a.js"))
    (vault / constants.BUNDLE_BACKUP_REL).write_bytes(b"someone edited the backup\n")
    before = digest_map(vault)

    with pytest.raises(install.InstallError):
        install.install_bundle(vault, constants.ROLE_A, bundle_file(tmp_path, SECOND, "b.js"))
    assert digest_map(vault) == before


def test_the_marker_records_the_original_by_hash_and_not_by_copy(
    vault: Path, tmp_path: Path
) -> None:
    install.install_bundle(vault, constants.ROLE_A, bundle_file(tmp_path, FIRST, "a.js"))
    marker = json.loads((vault / constants.INSTALL_MARKER_REL).read_text(encoding="utf-8"))
    assert marker["originalSha256"] == PRODUCTION_SHA
    assert marker["hadOriginal"] is True
    assert set(marker) == set(constants.INSTALL_MARKER_FIELDS)
