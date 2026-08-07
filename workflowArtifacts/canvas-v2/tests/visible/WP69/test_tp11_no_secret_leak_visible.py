# WP69 / AC4 + S4 — `data.json` is not this WP's business, and nothing it produces
# may carry a byte of it.
#
# `data.json` in both plugin directories holds live credentials. This WP writes one
# file — `main.js` — and does not read, move or need the settings file. The
# assertions here are the machine-checkable half of that rule: the settings file is
# untouched, and no record, marker or exception message the module produces contains
# the sentinel value planted in it.
#
# The sentinel below is obviously synthetic. No real credential appears in this file.
#
# DATA SAFETY: synthetic fixture vaults under `h:\tmp\` (or pytest's tmp_path), removed
# again. The owner's live vaults are never touched.
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

#: Not a credential. A tracer: if it ever shows up in a record, a marker or a
#: message, the module read a file it has no business reading.
SENTINEL = "FAKE-SENTINEL-NEVER-A-REAL-SECRET-9f3a"
FAKE_DATA_JSON = json.dumps(
    {
        "serverPassword": SENTINEL,
        "token": SENTINEL,
        "encryptionPassphrase": SENTINEL,
        "roomId": "fixture-room",
    },
    indent=2,
).encode("utf-8") + b"\n"

PRODUCTION_MAIN = b'"use strict";var live=1;module.exports={};\n' * 8
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
    (plugin_dir / "data.json").write_bytes(FAKE_DATA_JSON)
    try:
        yield root
    finally:
        shutil.rmtree(root, ignore_errors=True)


@pytest.fixture()
def source_bundle(tmp_path: Path) -> Path:
    path = tmp_path / "built-main.js"
    path.write_bytes(E2E_MAIN)
    return path


def test_the_settings_file_is_byte_identical_after_install_and_restore(
    vault: Path, source_bundle: Path
) -> None:
    settings = vault / constants.PLUGIN_DATA_REL
    baseline = sha(FAKE_DATA_JSON)

    install.install_bundle(vault, constants.ROLE_A, source_bundle)
    assert sha(settings.read_bytes()) == baseline

    install.restore_bundle(vault)
    assert sha(settings.read_bytes()) == baseline


def test_the_install_record_carries_no_settings_content(
    vault: Path, source_bundle: Path
) -> None:
    record = install.install_bundle(vault, constants.ROLE_A, source_bundle)
    blob = repr(record) + str(record)
    assert SENTINEL not in blob
    assert "serverPassword" not in blob
    assert "encryptionPassphrase" not in blob


def test_the_marker_file_carries_no_settings_content(
    vault: Path, source_bundle: Path
) -> None:
    install.install_bundle(vault, constants.ROLE_A, source_bundle)
    marker_bytes = (vault / constants.INSTALL_MARKER_REL).read_bytes()
    assert SENTINEL.encode("utf-8") not in marker_bytes
    marker = json.loads(marker_bytes.decode("utf-8"))
    # A pinned field set is the structural half: no field can smuggle content in.
    assert set(marker) == set(constants.INSTALL_MARKER_FIELDS)


def test_a_refusal_message_carries_no_settings_content(
    vault: Path, source_bundle: Path
) -> None:
    (vault / constants.BUNDLE_BACKUP_REL).write_bytes(b"unattributed debris\n")
    with pytest.raises(install.InstallError) as excinfo:
        install.install_bundle(vault, constants.ROLE_A, source_bundle)
    message = str(excinfo.value) + repr(excinfo.value)
    assert SENTINEL not in message


def test_the_sentinel_is_genuinely_present_in_the_fixture(vault: Path) -> None:
    """Guards every assertion above: an absent sentinel would make them vacuous."""
    assert SENTINEL.encode("utf-8") in (vault / constants.PLUGIN_DATA_REL).read_bytes()
