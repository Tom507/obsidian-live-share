# WP69 / AC4 + S4 — blind 1. Same subject (nothing this WP produces carries a byte
# of the owner's settings), different angle: a **positive whitelist** over every
# string the module hands back, plus tracers planted in more than one file.
#
# "The sentinel is absent" is a negative test and a negative test can pass by
# accident. Here every string field of the record and every value in the marker must
# match one of a small number of shapes — a path, a hex digest, an ISO timestamp, a
# role, a run id. A field that smuggles content out fails not because it matched a
# tracer but because it is not one of the permitted shapes.
#
# Tracers are planted in `data.json`, in `community-plugins.json` and in the
# production `main.js` itself, so a module that quotes any of them is caught. None
# of them is a real credential.
#
# DATA SAFETY: synthetic fixture vaults under `h:\tmp\` (or pytest's tmp_path),
# removed again. The owner's live vaults are never touched.
#
# Run: .venv\Scripts\python.exe -m pytest <this file>   (from the AgenticWorkspace root)

from __future__ import annotations

import dataclasses
import hashlib
import json
import re
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

SETTINGS_TRACER = "TRACER-SETTINGS-8b21-NOT-A-SECRET"
PLUGINS_TRACER = "TRACER-PLUGINLIST-4c07-NOT-A-SECRET"
BUNDLE_TRACER = "TRACER-BUNDLE-51ff-NOT-A-SECRET"
TRACERS = (SETTINGS_TRACER, PLUGINS_TRACER, BUNDLE_TRACER)

FAKE_SETTINGS = json.dumps(
    {
        "encryptionPassphrase": SETTINGS_TRACER,
        "encryptionSalt": SETTINGS_TRACER,
        "jwt": SETTINGS_TRACER,
        "serverPassword": SETTINGS_TRACER,
        "token": SETTINGS_TRACER,
        "e2eControlPort": 39431,
    },
    indent=2,
).encode("utf-8") + b"\n"

PRODUCTION_MAIN = b'// production ' + BUNDLE_TRACER.encode("utf-8") + b"\n" * 20
E2E_MAIN = (
    b"var __LS_E2E__=true;\n"
    + b"".join(b"'" + m.encode("utf-8") + b"'\n" for m in constants.E2E_BUILD_MARKERS)
)

HEX64 = re.compile(r"\A[0-9a-f]{64}\Z")
ISO8601 = re.compile(r"\A\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})\Z")
RUN_ID = re.compile(r"\A\d{8}T\d{6}Z-\d+-[0-9a-f]+\Z")


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def looks_permitted(vault: Path, value: str) -> bool:
    """A string the rig may hand back: a path under the vault, a digest, a
    timestamp, a run id, a role, or the plugin id."""
    if HEX64.match(value) or ISO8601.match(value) or RUN_ID.match(value):
        return True
    if value in set(constants.ROLES) | {constants.PLUGIN_ID}:
        return True
    try:
        candidate = Path(value)
    except (OSError, ValueError):  # pragma: no cover - defensive
        return False
    return candidate.is_absolute() and (candidate == vault or vault in candidate.parents)


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
    (plugin_dir / "data.json").write_bytes(FAKE_SETTINGS)
    (root / constants.COMMUNITY_PLUGINS_REL).write_bytes(
        json.dumps(["live-share", PLUGINS_TRACER]).encode("utf-8")
    )
    try:
        yield root
    finally:
        shutil.rmtree(root, ignore_errors=True)


@pytest.fixture()
def source_bundle(tmp_path: Path) -> Path:
    path = tmp_path / "e2e-main.js"
    path.write_bytes(E2E_MAIN)
    return path


def test_every_tracer_is_genuinely_planted(vault: Path) -> None:
    """Guards the file: absent tracers would make every assertion below vacuous."""
    assert SETTINGS_TRACER.encode() in (vault / constants.PLUGIN_DATA_REL).read_bytes()
    assert PLUGINS_TRACER.encode() in (vault / constants.COMMUNITY_PLUGINS_REL).read_bytes()
    assert BUNDLE_TRACER.encode() in (vault / constants.PLUGIN_MAIN_REL).read_bytes()


def test_no_tracer_reaches_the_install_record(vault: Path, source_bundle: Path) -> None:
    record = install.install_bundle(vault, constants.ROLE_A, source_bundle)
    blob = repr(record)
    for tracer in TRACERS:
        assert tracer not in blob


def test_every_string_field_of_the_record_has_a_permitted_shape(
    vault: Path, source_bundle: Path
) -> None:
    record = install.install_bundle(vault, constants.ROLE_A, source_bundle)
    fields = dataclasses.asdict(record) if dataclasses.is_dataclass(record) else vars(record)
    for name, value in fields.items():
        if isinstance(value, str):
            assert looks_permitted(vault, value), f"record.{name}={value!r} is not a permitted shape"


def test_the_marker_holds_only_pinned_fields_and_no_tracer(
    vault: Path, source_bundle: Path
) -> None:
    install.install_bundle(vault, constants.ROLE_A, source_bundle)
    raw = (vault / constants.INSTALL_MARKER_REL).read_bytes()
    for tracer in TRACERS:
        assert tracer.encode("utf-8") not in raw
    marker = json.loads(raw.decode("utf-8"))
    assert set(marker) == set(constants.INSTALL_MARKER_FIELDS)


def test_no_tracer_reaches_a_build_result(tmp_path: Path) -> None:
    plugin_dir = tmp_path / "plugin"
    plugin_dir.mkdir()

    def runner(command, cwd) -> int:  # noqa: ANN001
        (Path(cwd) / "main.js").write_bytes(
            E2E_MAIN + BUNDLE_TRACER.encode("utf-8") + b"\n"
        )
        return 0

    result = install.build_e2e_bundle(plugin_dir, runner=runner)
    assert BUNDLE_TRACER not in repr(result)
    # …and the result really did read the bundle, so the absence means something.
    assert result.size == (plugin_dir / "main.js").stat().st_size


def test_the_settings_and_plugin_list_are_byte_identical_throughout(
    vault: Path, source_bundle: Path
) -> None:
    watched = (constants.PLUGIN_DATA_REL, constants.COMMUNITY_PLUGINS_REL)
    before = {rel: sha((vault / rel).read_bytes()) for rel in watched}
    with install.installed_bundle(vault, constants.ROLE_A, source_bundle):
        for rel in watched:
            assert sha((vault / rel).read_bytes()) == before[rel]
    for rel in watched:
        assert sha((vault / rel).read_bytes()) == before[rel]


def test_a_refusal_carries_no_tracer(vault: Path, source_bundle: Path) -> None:
    (vault / constants.BUNDLE_BACKUP_REL).write_bytes(b"unattributed\n")
    with pytest.raises(install.InstallError) as excinfo:
        install.install_bundle(vault, constants.ROLE_A, source_bundle)
    message = f"{excinfo.value!s}{excinfo.value!r}"
    for tracer in TRACERS:
        assert tracer not in message
