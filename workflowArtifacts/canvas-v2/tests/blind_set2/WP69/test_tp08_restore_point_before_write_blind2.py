# WP69 / AC4 — blind 2. Same subject (an install that cannot establish its restore
# point does not install), different angle: **every way the borrow bookkeeping can
# be malformed**, rather than the two the visible test picks.
#
# The rule the shapes come from: the marker and the backup are one statement about
# the owner's file. When they disagree, the original is unknown, and guessing there
# is how data gets destroyed. So each malformed shape must produce a refusal AND
# leave the vault byte-for-byte as it was — checked with a whole-vault digest map,
# because "it raised" and "it changed nothing" are different claims.
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

PRODUCTION_MAIN = b"// owner production bundle\n" * 19
PRODUCTION_SHA = hashlib.sha256(PRODUCTION_MAIN).hexdigest()
E2E_MAIN = (
    b"var __LS_E2E__=true;\n"
    + b"".join(b"%" + m.encode("utf-8") + b"%\n" for m in constants.E2E_BUILD_MARKERS)
)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def digest_map(root: Path) -> dict[str, str]:
    return {
        p.relative_to(root).as_posix(): sha(p.read_bytes())
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


def good_marker() -> dict:
    return {
        "runId": "20260101T000000Z-4242-abcdef",
        "role": constants.ROLE_A,
        "hadOriginal": True,
        "originalSha256": PRODUCTION_SHA,
        "originalSize": len(PRODUCTION_MAIN),
        "installedSha256": sha(E2E_MAIN),
        "pid": 4242,
        "createdAt": "2026-01-01T00:00:00Z",
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
    try:
        yield root
    finally:
        shutil.rmtree(root, ignore_errors=True)


@pytest.fixture()
def source_bundle(tmp_path: Path) -> Path:
    path = tmp_path / "e2e-main.js"
    path.write_bytes(E2E_MAIN)
    return path


def write_marker(vault: Path, payload) -> None:  # noqa: ANN001
    raw = payload if isinstance(payload, bytes) else json.dumps(payload).encode("utf-8")
    (vault / constants.INSTALL_MARKER_REL).write_bytes(raw)


MALFORMED_IDS = (
    "marker is not json",
    "marker is a json array",
    "marker missing hadOriginal",
    "marker missing originalSha256 while claiming an original",
    "marker says no original but a backup exists",
    "backup exists with no marker",
    "backup contents disagree with the recorded hash",
    "recorded size disagrees with the backup",
)


def arrange(case: str, vault: Path) -> None:
    backup = vault / constants.BUNDLE_BACKUP_REL
    if case == "marker is not json":
        write_marker(vault, b"not json at all\n")
        backup.write_bytes(PRODUCTION_MAIN)
    elif case == "marker is a json array":
        write_marker(vault, [1, 2, 3])
        backup.write_bytes(PRODUCTION_MAIN)
    elif case == "marker missing hadOriginal":
        m = good_marker()
        del m["hadOriginal"]
        write_marker(vault, m)
        backup.write_bytes(PRODUCTION_MAIN)
    elif case == "marker missing originalSha256 while claiming an original":
        m = good_marker()
        m["originalSha256"] = None
        write_marker(vault, m)
        backup.write_bytes(PRODUCTION_MAIN)
    elif case == "marker says no original but a backup exists":
        m = good_marker()
        m["hadOriginal"] = False
        m["originalSha256"] = None
        m["originalSize"] = None
        write_marker(vault, m)
        backup.write_bytes(PRODUCTION_MAIN)
    elif case == "backup exists with no marker":
        backup.write_bytes(PRODUCTION_MAIN)
    elif case == "backup contents disagree with the recorded hash":
        write_marker(vault, good_marker())
        backup.write_bytes(PRODUCTION_MAIN + b"// tampered\n")
    elif case == "recorded size disagrees with the backup":
        m = good_marker()
        m["originalSize"] = len(PRODUCTION_MAIN) + 7
        write_marker(vault, m)
        backup.write_bytes(PRODUCTION_MAIN)
    else:  # pragma: no cover - the parametrisation is exhaustive
        raise AssertionError(case)


@pytest.mark.parametrize("case", MALFORMED_IDS)
def test_a_malformed_borrow_refuses_the_install(
    vault: Path, source_bundle: Path, case: str
) -> None:
    arrange(case, vault)
    before = digest_map(vault)

    with pytest.raises(install.InstallError):
        install.install_bundle(vault, constants.ROLE_A, source_bundle)
    assert digest_map(vault) == before, f"{case}: the vault was modified by a refusal"
    assert (vault / constants.PLUGIN_MAIN_REL).read_bytes() == PRODUCTION_MAIN


@pytest.mark.parametrize("case", MALFORMED_IDS)
def test_a_malformed_borrow_refuses_the_restore(vault: Path, case: str) -> None:
    arrange(case, vault)
    before = digest_map(vault)

    with pytest.raises(install.InstallError):
        install.restore_bundle(vault)
    assert digest_map(vault) == before, f"{case}: the vault was modified by a refusal"


@pytest.mark.parametrize("case", MALFORMED_IDS)
def test_capture_state_reports_the_conflict_without_writing(
    vault: Path, case: str
) -> None:
    arrange(case, vault)
    before = digest_map(vault)

    with pytest.raises(install.InstallError):
        install.capture_bundle_state(vault)
    assert digest_map(vault) == before


def test_a_well_formed_borrow_is_accepted(vault: Path, source_bundle: Path) -> None:
    """None of the refusals above may be unconditional."""
    (vault / constants.BUNDLE_BACKUP_REL).write_bytes(PRODUCTION_MAIN)
    write_marker(vault, good_marker())

    state = install.capture_bundle_state(vault)
    assert state.had_original is True
    assert state.original_sha256 == PRODUCTION_SHA

    result = install.restore_bundle(vault)
    assert result.restored is True
    assert result.restored_sha256 == PRODUCTION_SHA
    assert (vault / constants.PLUGIN_MAIN_REL).read_bytes() == PRODUCTION_MAIN
