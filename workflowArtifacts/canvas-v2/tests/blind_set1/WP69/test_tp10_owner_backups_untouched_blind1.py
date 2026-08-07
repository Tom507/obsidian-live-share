# WP69 / AC4 — blind 1. Same subject (nothing that is not ours is touched),
# different angle: **neighbour filenames chosen to catch a glob**.
#
# The natural way to clean up after yourself is `for p in plugin_dir.glob("main.js.*")`
# or `if name.startswith("main.js")`. In the owner's real plugin directories that
# sweeps up `main.js.bak` and `main.js.0.5.9.bak` — files the charter names as never
# written, moved, renamed or deleted. The fixture below adds four more names that
# any plausible pattern would also catch, including one that contains the rig's own
# suffix.
#
# The whole plugin subtree is fingerprinted, so a rename shows up as both a
# disappearance and an appearance rather than as nothing.
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

PRODUCTION_MAIN = b"// production bundle\n" * 30
PRODUCTION_SHA = hashlib.sha256(PRODUCTION_MAIN).hexdigest()
E2E_MAIN = (
    b"var __LS_E2E__=true;\n"
    + b"".join(b"(" + m.encode("utf-8") + b")\n" for m in constants.E2E_BUILD_MARKERS)
)

RIG_BACKUP_NAME = Path(constants.BUNDLE_BACKUP_REL).name
RIG_MARKER_NAME = Path(constants.INSTALL_MARKER_REL).name

#: Three measured by the pre-flight, four more chosen to be caught by any pattern a
#: cleanup routine might reach for. None of them is ours.
NEIGHBOURS = {
    "main.js.bak": b"owner: previous bundle\n",
    "main.js.0.5.9.bak": b"owner: 0.5.9 bundle\n",
    "manifest.json.bak": b'{"id":"live-share","version":"0.5.9"}\n',
    "main.js.orig": b"owner: pre-patch copy\n",
    "main.js.map": b'{"version":3,"sources":[]}\n',
    f"{RIG_BACKUP_NAME}.bak": b"owner: a copy someone made of a rig file\n",
    "main.js.0.6.0.bak": b"owner: 0.6.0 bundle\n",
}


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def subtree(plugin_dir: Path) -> dict[str, str]:
    return {
        p.relative_to(plugin_dir).as_posix(): sha(p.read_bytes())
        for p in sorted(plugin_dir.rglob("*"))
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
    (plugin_dir / "manifest.json").write_bytes(b'{"id":"live-share","version":"0.6.1"}\n')
    (plugin_dir / "styles.css").write_bytes(b".live-share{}\n")
    for name, data in NEIGHBOURS.items():
        (plugin_dir / name).write_bytes(data)
    try:
        yield root
    finally:
        shutil.rmtree(root, ignore_errors=True)


@pytest.fixture()
def source_bundle(tmp_path: Path) -> Path:
    path = tmp_path / "e2e-main.js"
    path.write_bytes(E2E_MAIN)
    return path


def test_no_neighbour_is_removed_or_renamed_by_the_install(
    vault: Path, source_bundle: Path
) -> None:
    plugin_dir = vault / constants.PLUGIN_DIR_REL
    before = subtree(plugin_dir)

    install.install_bundle(vault, constants.ROLE_A, source_bundle)
    after = subtree(plugin_dir)

    assert set(before) - set(after) == set(), "a pre-existing file disappeared"
    for name in NEIGHBOURS:
        assert after[name] == before[name], f"{name} was rewritten"


def test_no_neighbour_is_removed_or_renamed_by_the_restore(
    vault: Path, source_bundle: Path
) -> None:
    plugin_dir = vault / constants.PLUGIN_DIR_REL
    before = subtree(plugin_dir)

    install.install_bundle(vault, constants.ROLE_A, source_bundle)
    install.restore_bundle(vault)

    assert subtree(plugin_dir) == before


def test_the_rig_writes_exactly_two_names_and_they_are_new(
    vault: Path, source_bundle: Path
) -> None:
    plugin_dir = vault / constants.PLUGIN_DIR_REL
    before = set(subtree(plugin_dir))
    assert RIG_BACKUP_NAME not in before
    assert RIG_MARKER_NAME not in before

    install.install_bundle(vault, constants.ROLE_A, source_bundle)
    assert set(subtree(plugin_dir)) - before == {RIG_BACKUP_NAME, RIG_MARKER_NAME}


def test_a_neighbour_that_shares_the_rigs_suffix_is_not_adopted(
    vault: Path, source_bundle: Path
) -> None:
    """`<rig backup>.bak` is the owner's; a prefix or glob match must not claim it."""
    plugin_dir = vault / constants.PLUGIN_DIR_REL
    decoy = plugin_dir / f"{RIG_BACKUP_NAME}.bak"

    install.install_bundle(vault, constants.ROLE_A, source_bundle)
    assert decoy.read_bytes() == NEIGHBOURS[f"{RIG_BACKUP_NAME}.bak"]

    install.restore_bundle(vault)
    assert decoy.read_bytes() == NEIGHBOURS[f"{RIG_BACKUP_NAME}.bak"]
    assert (plugin_dir / "main.js").read_bytes() == PRODUCTION_MAIN


def test_a_neighbour_holding_the_production_bytes_is_not_used_as_the_restore_point(
    vault: Path, source_bundle: Path
) -> None:
    """`main.js.orig` is made to hold exactly the right bytes. The module must still
    refuse when its own backup is unusable, rather than restore from a stranger."""
    plugin_dir = vault / constants.PLUGIN_DIR_REL
    (plugin_dir / "main.js.orig").write_bytes(PRODUCTION_MAIN)

    install.install_bundle(vault, constants.ROLE_A, source_bundle)
    (vault / constants.BUNDLE_BACKUP_REL).write_bytes(b"unusable\n")

    with pytest.raises(install.BundleRestoreMismatch):
        install.restore_bundle(vault)
    assert (plugin_dir / "main.js").read_bytes() == E2E_MAIN
    assert (plugin_dir / "main.js.orig").read_bytes() == PRODUCTION_MAIN


def test_a_healthy_borrow_restores_the_recorded_production_bytes(
    vault: Path, source_bundle: Path
) -> None:
    """The refusal above must not be unconditional."""
    install.install_bundle(vault, constants.ROLE_A, source_bundle)
    result = install.restore_bundle(vault)
    assert result.restored_sha256 == PRODUCTION_SHA
    assert (vault / constants.PLUGIN_MAIN_REL).read_bytes() == PRODUCTION_MAIN
