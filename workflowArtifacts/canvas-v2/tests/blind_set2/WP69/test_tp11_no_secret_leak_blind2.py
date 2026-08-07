# WP69 / AC4 + S4 — blind 2. Same subject (no byte of the owner's settings leaves
# this module), different angle: the module must not **depend** on `data.json` at
# all, and nothing it emits through the logging system may quote it.
#
# Two claims that the other tests do not make:
#   ├── independence — the install works identically whether `data.json` is a normal
#   │   file, empty, absent, or 400 KB of noise. A module that reads it to decide
#   │   anything will behave differently across those four, and any behaviour that
#   │   depends on a credential file is one refactor away from printing it.
#   └── the log stream — `caplog` captures every record emitted during the call, and
#       no tracer may appear in any of them. Reports and handovers are written from
#       logs; S4 is not satisfied by keeping content out of the return value alone.
#
# Nothing here is a real credential.
#
# DATA SAFETY: synthetic fixture vaults under `h:\tmp\` (or pytest's tmp_path),
# removed again. The owner's live vaults are never touched.
#
# Run: .venv\Scripts\python.exe -m pytest <this file>   (from the AgenticWorkspace root)

from __future__ import annotations

import hashlib
import json
import logging
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

TRACER = "TRACER-b7d4-DEFINITELY-NOT-A-CREDENTIAL"
FAKE_SETTINGS = json.dumps(
    {"serverPassword": TRACER, "jwt": TRACER, "encryptionSalt": TRACER}, indent=2
).encode("utf-8") + b"\n"

PRODUCTION_MAIN = b"// production\n" * 33
PRODUCTION_SHA = hashlib.sha256(PRODUCTION_MAIN).hexdigest()
E2E_MAIN = (
    b"var __LS_E2E__=true;\n"
    + b"".join(b"!" + m.encode("utf-8") + b"!\n" for m in constants.E2E_BUILD_MARKERS)
)

#: The four settings-file shapes the install must be indifferent to.
SETTINGS_SHAPES = {
    "normal": FAKE_SETTINGS,
    "empty": b"",
    "absent": None,
    "large-noise": (TRACER.encode("utf-8") + b"\n") * 8000,
}


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def make_vault(tmp_path: Path, settings: bytes | None) -> Path:
    base = FIXTURE_ROOT if FIXTURE_ROOT.is_dir() else tmp_path
    root = (base / f"wp69b2-{uuid.uuid4().hex}").resolve()
    for owner in OWNER_VAULTS:
        resolved = owner.resolve()
        assert root != resolved and resolved not in root.parents, (
            "ABORT: a WP69 fixture vault must never be rooted at or inside an owner vault"
        )
    (root / constants.PLUGIN_DIR_REL).mkdir(parents=True)
    (root / constants.PLUGIN_MAIN_REL).write_bytes(PRODUCTION_MAIN)
    if settings is not None:
        (root / constants.PLUGIN_DATA_REL).write_bytes(settings)
    return root


@pytest.fixture()
def source_bundle(tmp_path: Path) -> Path:
    path = tmp_path / "e2e-main.js"
    path.write_bytes(E2E_MAIN)
    return path


@pytest.fixture()
def vaults(tmp_path: Path) -> Iterator[dict[str, Path]]:
    made = {name: make_vault(tmp_path, data) for name, data in SETTINGS_SHAPES.items()}
    try:
        yield made
    finally:
        for root in made.values():
            shutil.rmtree(root, ignore_errors=True)


def test_the_install_outcome_is_identical_across_all_settings_shapes(
    vaults: dict[str, Path], source_bundle: Path
) -> None:
    outcomes = {}
    for name, root in vaults.items():
        record = install.install_bundle(root, constants.ROLE_A, source_bundle)
        outcomes[name] = (
            record.had_original,
            record.original_sha256,
            record.original_size,
            record.installed_sha256,
            sha((root / constants.PLUGIN_MAIN_REL).read_bytes()),
        )
    distinct = set(outcomes.values())
    assert len(distinct) == 1, f"the install depends on data.json: {outcomes}"
    assert next(iter(distinct))[1] == PRODUCTION_SHA


def test_the_restore_outcome_is_identical_across_all_settings_shapes(
    vaults: dict[str, Path], source_bundle: Path
) -> None:
    for root in vaults.values():
        install.install_bundle(root, constants.ROLE_A, source_bundle)
    results = {
        name: install.restore_bundle(root).restored_sha256
        for name, root in vaults.items()
    }
    assert set(results.values()) == {PRODUCTION_SHA}


def test_each_settings_file_is_byte_identical_afterwards(
    vaults: dict[str, Path], source_bundle: Path
) -> None:
    for name, root in vaults.items():
        expected = SETTINGS_SHAPES[name]
        with install.installed_bundle(root, constants.ROLE_A, source_bundle):
            pass
        path = root / constants.PLUGIN_DATA_REL
        if expected is None:
            assert not path.exists(), f"{name}: the rig created a settings file"
        else:
            assert path.read_bytes() == expected, f"{name}: the settings file changed"


def test_no_tracer_reaches_the_log_stream(
    vaults: dict[str, Path], source_bundle: Path, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.DEBUG):
        for root in vaults.values():
            with install.installed_bundle(root, constants.ROLE_A, source_bundle):
                pass
    blob = caplog.text + "".join(str(r.getMessage()) for r in caplog.records)
    assert TRACER not in blob


def test_no_tracer_reaches_a_marker_or_a_record(
    vaults: dict[str, Path], source_bundle: Path
) -> None:
    for root in vaults.values():
        record = install.install_bundle(root, constants.ROLE_A, source_bundle)
        assert TRACER not in repr(record)
        assert TRACER.encode("utf-8") not in (root / constants.INSTALL_MARKER_REL).read_bytes()


def test_a_refusal_across_every_settings_shape_carries_no_tracer(
    vaults: dict[str, Path], source_bundle: Path, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.DEBUG):
        for root in vaults.values():
            (root / constants.BUNDLE_BACKUP_REL).write_bytes(b"unattributed\n")
            with pytest.raises(install.InstallError) as excinfo:
                install.install_bundle(root, constants.ROLE_A, source_bundle)
            assert TRACER not in f"{excinfo.value!s}{excinfo.value!r}"
    assert TRACER not in caplog.text


def test_the_tracer_is_genuinely_present_in_the_fixtures_that_claim_it(
    vaults: dict[str, Path],
) -> None:
    """Guards every assertion above from being vacuous."""
    hits = [
        name
        for name, root in vaults.items()
        if (root / constants.PLUGIN_DATA_REL).exists()
        and TRACER.encode("utf-8") in (root / constants.PLUGIN_DATA_REL).read_bytes()
    ]
    assert set(hits) == {"normal", "large-noise"}
