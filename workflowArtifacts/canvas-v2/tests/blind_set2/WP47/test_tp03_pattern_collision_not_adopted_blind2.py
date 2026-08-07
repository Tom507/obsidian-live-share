# WP47 / AC1 — name collision, third angle: the vault contains a whole FAMILY of
# near-miss names (prefix-only, ext-only, prefix+ext but in a sibling folder,
# prefix+ext with a trailing space, and one with the rig folder as a *file*).
# The rig must claim exactly one name and leave the entire family alone.

import hashlib
import sys
from pathlib import Path

import pytest

for _parent in Path(__file__).resolve().parents:
    if (_parent / "tools").is_dir() and (_parent / "plugin").is_dir():
        _TOOLS = _parent / "tools"
        break
else:  # pragma: no cover
    raise RuntimeError(f"obsidian-live-share repo root not found from {__file__}")
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, scratch  # noqa: E402

BODY = b"user content that must survive\n"

FAMILY = [
    f"{constants.SCRATCH_PREFIX}only-prefix.md",
    f"only-ext{constants.SCRATCH_EXT}",
    f"sub/{constants.SCRATCH_PREFIX}sibling{constants.SCRATCH_EXT}",
    f"{constants.SCRATCH_PREFIX}root-level{constants.SCRATCH_EXT}",
    f"sub/{constants.SCRATCH_FOLDER}/{constants.SCRATCH_PREFIX}deep{constants.SCRATCH_EXT}",
]


def build_vault(root: Path) -> None:
    (root / ".obsidian").mkdir(parents=True, exist_ok=True)
    (root / ".obsidian" / "app.json").write_bytes(b"{}\n")
    plugin_dir = root / constants.PLUGIN_DIR_REL
    plugin_dir.mkdir(parents=True, exist_ok=True)
    (plugin_dir / "data.json").write_bytes(b'{"e2e-fixture":"synthetic"}\n')

    for i in range(20):
        (root / f"note-{i:03d}.md").write_bytes(f"# note {i}\n".encode("utf-8"))
    for rel in FAMILY:
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(BODY)


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture()
def vault(tmp_path: Path) -> Path:
    v = tmp_path / "ObsidianOrga"
    v.mkdir()
    build_vault(v)
    return v


@pytest.mark.parametrize("rel", FAMILY)
def test_no_family_member_is_a_scratch_path(rel: str) -> None:
    assert scratch.is_scratch_relpath(rel) is False


def test_the_whole_family_survives_a_run_byte_identical(vault: Path) -> None:
    before = {rel: sha(vault / rel) for rel in FAMILY}

    with scratch.scratch_run(vault) as run:
        assert run.relpath not in FAMILY

    for rel in FAMILY:
        assert (vault / rel).is_file()
        assert sha(vault / rel) == before[rel]


def test_reclaim_ignores_the_whole_family(vault: Path) -> None:
    before = {rel: sha(vault / rel) for rel in FAMILY}

    for _ in range(3):
        assert scratch.reclaim_stale_scratch(vault) == ()

    for rel in FAMILY:
        assert sha(vault / rel) == before[rel]


def test_the_family_is_inside_the_fingerprint(vault: Path) -> None:
    fp = scratch.fingerprint_vault(vault)
    for rel in FAMILY:
        assert rel in fp, f"{rel} is not a rig artefact and must be fingerprinted"


def test_a_nested_lookalike_folder_is_not_the_rig_folder(vault: Path) -> None:
    nested = f"sub/{constants.SCRATCH_FOLDER}"
    assert (vault / nested).is_dir()

    with scratch.scratch_run(vault) as run:
        assert run.folder == vault / constants.SCRATCH_FOLDER
        assert run.folder != vault / nested

    assert (vault / nested).is_dir()
    assert (vault / f"{nested}/{constants.SCRATCH_PREFIX}deep{constants.SCRATCH_EXT}").is_file()


def test_overwriting_any_family_member_would_fail_the_run(vault: Path) -> None:
    victim = FAMILY[3]
    with pytest.raises(scratch.ScratchError) as excinfo:
        with scratch.scratch_run(vault):
            (vault / victim).write_bytes(b"clobbered\n")

    assert excinfo.value.reason == constants.FINGERPRINT_MISMATCH
    assert victim in excinfo.value.changed
