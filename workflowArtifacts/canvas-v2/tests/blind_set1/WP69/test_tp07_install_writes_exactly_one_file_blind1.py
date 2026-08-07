# WP69 / AC4 — blind 1. Same subject (exactly one file per vault is written),
# different angle: a **vault whose path contains spaces**, a plugin directory with
# a nested subfolder and non-ASCII names, and role `b`.
#
# The pre-flight calls the spaces in `ObsidianOrga - Kopie` "load-bearing" and names
# the nested-quote trap the single most likely mechanical failure of the batch. A
# module that builds paths by string concatenation or shells out with an unquoted
# path installs nothing, silently, and the failure surfaces three layers later as
# `PLUGIN_NOT_E2E_CAPABLE`. That is exactly the confusion the pre-flight had to
# untangle once already.
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

#: Deliberately not JSON-ish and not ASCII-only: a bundle is arbitrary bytes.
PRODUCTION_MAIN = bytes(range(256)) * 40 + b"\r\n// production\r\n"
E2E_MAIN = (
    b"\xef\xbb\xbf"  # a BOM, because nothing may normalise these bytes
    + b'var __LS_E2E__=true;\n'
    + b"".join(b"[" + m.encode("utf-8") + b"]\n" for m in constants.E2E_BUILD_MARKERS)
    + bytes(range(128))
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
    # The name mirrors the real vault B: spaces, a hyphen, mixed case.
    root = (base / f"WP69 Fixture Vault - Kopie {uuid.uuid4().hex}").resolve()
    for owner in OWNER_VAULTS:
        resolved = owner.resolve()
        assert root != resolved and resolved not in root.parents, (
            "ABORT: a WP69 fixture vault must never be rooted at or inside an owner vault"
        )
    plugin_dir = root / constants.PLUGIN_DIR_REL
    plugin_dir.mkdir(parents=True)
    (plugin_dir / "main.js").write_bytes(PRODUCTION_MAIN)
    (plugin_dir / "manifest.json").write_bytes(b'{"id":"live-share"}\n')
    (plugin_dir / "styles.css").write_bytes(b".x{}\n")
    (plugin_dir / "data.json").write_bytes(b'{"roomId":"fixture-room"}\n')
    (plugin_dir / "assets").mkdir()
    (plugin_dir / "assets" / "icon ünïcode.svg").write_bytes(b"<svg/>\n")
    (root / constants.COMMUNITY_PLUGINS_REL).write_bytes(b'["live-share","obsidian-git"]\n')
    (root / "Notes with spaces").mkdir()
    (root / "Notes with spaces" / "Ünïcode Näme.md").write_bytes(b"# note\n")
    try:
        yield root
    finally:
        shutil.rmtree(root, ignore_errors=True)


@pytest.fixture()
def source_bundle(tmp_path: Path) -> Path:
    # The source path has spaces too — it is the freshly built plugin/main.js in
    # real life, and the rig may be invoked from anywhere.
    folder = tmp_path / "built bundle dir"
    folder.mkdir()
    path = folder / "main.js"
    path.write_bytes(E2E_MAIN)
    return path


def test_the_vault_path_really_does_contain_a_space(vault: Path) -> None:
    """Guards the whole file: without a space this is just the visible test again."""
    assert " " in vault.name


def test_installation_into_a_spaced_path_actually_lands(
    vault: Path, source_bundle: Path
) -> None:
    install.install_bundle(vault, constants.ROLE_B, source_bundle)
    installed = (vault / constants.PLUGIN_MAIN_REL).read_bytes()
    assert installed == E2E_MAIN, "silent no-op: nothing was installed"
    assert sha(installed) != sha(PRODUCTION_MAIN)


def test_exactly_one_pre_existing_file_changes(vault: Path, source_bundle: Path) -> None:
    before = digest_map(vault)
    install.install_bundle(vault, constants.ROLE_B, source_bundle)
    after = digest_map(vault)
    assert {k for k in before if before[k] != after.get(k)} == {constants.PLUGIN_MAIN_REL}


def test_the_added_paths_are_only_the_rigs_own_two(
    vault: Path, source_bundle: Path
) -> None:
    before = set(digest_map(vault))
    install.install_bundle(vault, constants.ROLE_B, source_bundle)
    added = set(digest_map(vault)) - before
    assert added == {constants.BUNDLE_BACKUP_REL, constants.INSTALL_MARKER_REL}


def test_the_nested_and_non_ascii_neighbours_are_untouched(
    vault: Path, source_bundle: Path
) -> None:
    watched = [
        constants.PLUGIN_DIR_REL + "/assets/icon ünïcode.svg",
        constants.PLUGIN_DIR_REL + "/styles.css",
        constants.PLUGIN_DIR_REL + "/manifest.json",
        constants.PLUGIN_DATA_REL,
        constants.COMMUNITY_PLUGINS_REL,
        "Notes with spaces/Ünïcode Näme.md",
    ]
    before = {rel: sha((vault / rel).read_bytes()) for rel in watched}
    install.install_bundle(vault, constants.ROLE_B, source_bundle)
    install.restore_bundle(vault)
    for rel in watched:
        assert sha((vault / rel).read_bytes()) == before[rel], f"{rel} was modified"


def test_the_binary_production_bundle_survives_the_round_trip_byte_for_byte(
    vault: Path, source_bundle: Path
) -> None:
    """256 distinct byte values, CRLF and a BOM — no text mode, no normalisation."""
    with install.installed_bundle(vault, constants.ROLE_B, source_bundle):
        assert (vault / constants.PLUGIN_MAIN_REL).read_bytes() == E2E_MAIN
    assert (vault / constants.PLUGIN_MAIN_REL).read_bytes() == PRODUCTION_MAIN


def test_the_record_points_at_the_plugin_id_not_the_repo_folder_name(
    vault: Path, source_bundle: Path
) -> None:
    record = install.install_bundle(vault, constants.ROLE_B, source_bundle)
    posix = Path(record.bundle_path).as_posix()
    assert posix.endswith(f"plugins/{constants.PLUGIN_ID}/main.js")
    assert "obsidian-live-share" not in posix
