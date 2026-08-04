# WP70 / obsidian-git precondition — "restore runs on every exit path including
# exception and `KeyboardInterrupt`."
#
# The precondition modifies the owner's *enabled plugin list*. A run that aborts without
# restoring it leaves the owner's Obsidian starting up with `obsidian-git` silently off —
# a change to the owner's working environment that nothing in the vault records. So the
# borrow is a context manager and its exit path is unconditional.
#
#   ├── T1 normal exit restores byte-exactly and removes the rig's artefacts
#   ├── T2 an exception inside the context restores and re-raises
#   ├── T3 a KeyboardInterrupt inside the context restores
#   ├── T4 a SystemExit inside the context restores
#   ├── T5 the list really was modified in between — a no-op borrow must not pass
#   └── T6 the borrow can be entered again afterwards, and restores again
#
# DATA SAFETY: synthetic fixture vaults under tmp_path, guarded against both owner
# vaults.

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

import pytest

# --- repo bootstrap (T3_SharedContract §0.2) --------------------------------------
for _parent in Path(__file__).resolve().parents:
    if (_parent / "tools").is_dir() and (_parent / "plugin").is_dir():
        _REPO = _parent
        _TOOLS = _parent / "tools"
        break
else:  # pragma: no cover
    raise RuntimeError(f"obsidian-live-share repo root not found from {__file__}")
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, provisioning  # noqa: E402

OWNER_VAULTS = (
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga"),
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie"),
)

RUN_ID = "20260804T000000Z-1-a1b2c3"
ORIGINAL = b'[\n\t"obsidian-git",\n\t"live-share"\n]'
ORIGINAL_SHA = hashlib.sha256(ORIGINAL).hexdigest()


class Boom(RuntimeError):
    pass


def assert_synthetic(path: Path) -> Path:
    resolved = Path(path).resolve()
    for owner in OWNER_VAULTS:
        owner_resolved = Path(owner).resolve()
        assert resolved != owner_resolved, f"ABORT: {resolved} is an owner vault"
        assert owner_resolved not in resolved.parents, f"ABORT: {resolved} is inside an owner vault"
        assert resolved not in owner_resolved.parents, f"ABORT: {resolved} contains an owner vault"
    return resolved


def make_vault(tmp_path: Path, name: str) -> Path:
    vault = assert_synthetic(tmp_path / name)
    (vault / ".obsidian").mkdir(parents=True, exist_ok=True)
    (vault / constants.COMMUNITY_PLUGINS_REL).write_bytes(ORIGINAL)
    return vault


def community(vault: Path) -> bytes:
    return (vault / constants.COMMUNITY_PLUGINS_REL).read_bytes()


def assert_restored(vault: Path) -> None:
    raw = community(vault)
    assert len(raw) == len(ORIGINAL)
    assert hashlib.sha256(raw).hexdigest() == ORIGINAL_SHA
    assert raw == ORIGINAL
    assert not (vault / constants.COMMUNITY_PLUGINS_BACKUP_REL).exists()
    assert not (vault / constants.COMMUNITY_PLUGINS_MARKER_REL).exists()


def test_normal_exit_restores_byte_exactly(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-normal")
    with provisioning.borrowed_community_plugins(
        vault, constants.ROLE_A, run_id=RUN_ID
    ) as record:
        assert record.original_sha256 == ORIGINAL_SHA
        assert b"obsidian-git" not in community(vault)
    assert_restored(vault)


def test_an_exception_inside_the_context_still_restores(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-boom")
    with pytest.raises(Boom):
        with provisioning.borrowed_community_plugins(vault, constants.ROLE_A, run_id=RUN_ID):
            assert b"obsidian-git" not in community(vault)
            raise Boom("the gate failed mid-run")
    assert_restored(vault)


def test_an_abort_inside_the_context_still_restores(tmp_path: Path) -> None:
    """KeyboardInterrupt derives from BaseException — a bare `except Exception:`
    teardown would leave the owner's plugin list modified."""
    vault = make_vault(tmp_path, "vault-abort")
    with pytest.raises(KeyboardInterrupt):
        with provisioning.borrowed_community_plugins(vault, constants.ROLE_B, run_id=RUN_ID):
            raise KeyboardInterrupt
    assert_restored(vault)


def test_a_system_exit_inside_the_context_still_restores(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-sysexit")
    with pytest.raises(SystemExit):
        with provisioning.borrowed_community_plugins(vault, constants.ROLE_A, run_id=RUN_ID):
            raise SystemExit(2)
    assert_restored(vault)


def test_the_list_really_was_modified_in_between(tmp_path: Path) -> None:
    # Without this, every restore assertion above would pass for a do-nothing borrow.
    vault = make_vault(tmp_path, "vault-genuine")
    with provisioning.borrowed_community_plugins(vault, constants.ROLE_A, run_id=RUN_ID):
        during = community(vault)
    assert during != ORIGINAL
    assert hashlib.sha256(during).hexdigest() != ORIGINAL_SHA
    assert_restored(vault)


def test_the_borrow_can_be_entered_again_afterwards(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-again")
    for _ in range(3):
        with provisioning.borrowed_community_plugins(vault, constants.ROLE_A, run_id=RUN_ID):
            assert b"obsidian-git" not in community(vault)
        assert_restored(vault)
