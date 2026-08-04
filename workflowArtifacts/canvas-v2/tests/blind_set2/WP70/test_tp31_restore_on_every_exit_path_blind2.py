# WP70 / obsidian-git precondition — blind counterpart 2 for "restore runs on every exit
# path including exception and KeyboardInterrupt".
#
# Different angle again. The visible set and counterpart 1 vary *what the body raises*.
# This one varies **what happens during the unwinding itself**, and **what the vault looks
# like**, because those are the two ways an unconditional exit is quietly lost:
#
#   ├── an inner context manager whose own __exit__ raises — ordinary, KeyboardInterrupt,
#   │   and one that raises while already unwinding another exception
#   ├── an inner __exit__ that SWALLOWS the body's exception (returns True): the block ends
#   │   normally and the borrow must still be given back
#   ├── a `finally:` inside the body that itself raises SystemExit
#   ├── a contextlib.ExitStack callback registered after the borrow that raises on unwind
#   └── the same, over three vault shapes:
#         • no community-plugins.json at all (nothing to back up — still a borrow)
#         • a list that does not contain obsidian-git (nothing to remove — still restored)
#         • a list with a BOM and CRLFs that a JSON round trip destroys
#
# DATA SAFETY: synthetic fixture vaults under tmp_path, guarded against both owner vaults.
# No process is started, no socket opened.

from __future__ import annotations

import contextlib
import hashlib
import json
import sys
from pathlib import Path

import pytest

# --- repo bootstrap (T3_SharedContract §0.2) --------------------------------------
for _parent in Path(__file__).resolve().parents:
    if (_parent / "tools").is_dir() and (_parent / "plugin").is_dir():
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

RUN_ID = "20260804T112500Z-71-4de62f"

SENTINEL = "s3nt1nel-blind2-tp31-do-not-leak"

#: Three vault shapes. `None` means the file does not exist at all.
SHAPES = {
    "absent": None,
    "without_obsidian_git": b'[\r\n\t"periodic-notes",\r\n\t"live-share"\r\n]',
    "bom_and_crlf": b"\xef\xbb\xbf" + b'[\r\n  "obsidian-git",\r\n  "live-share"\r\n]',
}


class Boom(RuntimeError):
    pass


class TeardownBoom(RuntimeError):
    """Raised by an inner teardown — the rig's own cleanup failing, not the body's."""


def assert_synthetic(path: Path) -> Path:
    resolved = Path(path).resolve()
    for owner in OWNER_VAULTS:
        owner_resolved = Path(owner).resolve()
        assert resolved != owner_resolved, f"ABORT: {resolved} is an owner vault"
        assert owner_resolved not in resolved.parents, f"ABORT: {resolved} is inside an owner vault"
        assert resolved not in owner_resolved.parents, f"ABORT: {resolved} contains an owner vault"
    return resolved


def make_vault(tmp_path: Path, name: str, shape: str = "bom_and_crlf") -> Path:
    vault = assert_synthetic(tmp_path / name)
    (vault / ".obsidian").mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(
        json.dumps({"encryptionSalt": SENTINEL}).encode("utf-8")
    )
    original = SHAPES[shape]
    if original is not None:
        (vault / constants.COMMUNITY_PLUGINS_REL).write_bytes(original)
    return vault


def assert_restored(vault: Path, shape: str = "bom_and_crlf") -> None:
    path = vault / constants.COMMUNITY_PLUGINS_REL
    original = SHAPES[shape]
    if original is None:
        assert not path.exists(), "the borrow left a list where the owner had none"
    else:
        raw = path.read_bytes()
        assert len(raw) == len(original)
        assert hashlib.sha256(raw).hexdigest() == hashlib.sha256(original).hexdigest()
        assert raw == original
    assert not (vault / constants.COMMUNITY_PLUGINS_BACKUP_REL).exists()
    assert not (vault / constants.COMMUNITY_PLUGINS_MARKER_REL).exists()
    assert (vault / constants.PLUGIN_DATA_REL).exists(), "the borrow disturbed data.json"


def borrow(vault: Path, role: str = constants.ROLE_A):
    return provisioning.borrowed_community_plugins(vault, role, run_id=RUN_ID)


class InnerTeardown:
    """An inner context manager standing in for any rig cleanup nested in the borrow."""

    def __init__(self, *, raises: BaseException = None, swallow: bool = False) -> None:
        self._raises = raises
        self._swallow = swallow
        self.exited = False

    def __enter__(self) -> "InnerTeardown":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        self.exited = True
        if self._raises is not None:
            raise self._raises
        return self._swallow


# --- the unwinding itself misbehaves ---------------------------------------------------


@pytest.mark.parametrize("shape", sorted(SHAPES))
def test_an_inner_teardown_that_raises_does_not_cancel_the_restore(
    tmp_path: Path, shape: str
) -> None:
    """The borrow is the outermost thing in the run and the last to be given back. An inner
    cleanup that blows up on the way out must not take the owner's plugin list with it."""
    vault = make_vault(tmp_path, f"vault-inner-raises-{shape}", shape)
    inner = InnerTeardown(raises=TeardownBoom("the scratch folder could not be removed"))

    with pytest.raises(TeardownBoom):
        with borrow(vault):
            with inner:
                pass

    assert inner.exited
    assert_restored(vault, shape)


@pytest.mark.parametrize("shape", sorted(SHAPES))
def test_an_inner_teardown_raising_keyboard_interrupt_does_not_cancel_the_restore(
    tmp_path: Path, shape: str
) -> None:
    vault = make_vault(tmp_path, f"vault-inner-interrupt-{shape}", shape)
    inner = InnerTeardown(raises=KeyboardInterrupt())

    with pytest.raises(KeyboardInterrupt):
        with borrow(vault, constants.ROLE_B):
            with inner:
                pass

    assert inner.exited
    assert_restored(vault, shape)


def test_an_inner_teardown_that_raises_while_already_unwinding_still_restores(
    tmp_path: Path,
) -> None:
    """Two failures at once — the body's and the cleanup's. The second replaces the first
    as the propagating exception, and neither of them is a reason to keep the borrow."""
    vault = make_vault(tmp_path, "vault-double-failure")
    inner = InnerTeardown(raises=TeardownBoom("cleanup failed too"))

    with pytest.raises(TeardownBoom) as excinfo:
        with borrow(vault):
            with inner:
                raise Boom("the gate failed mid-run")

    assert isinstance(excinfo.value.__context__, Boom), "the first failure was lost entirely"
    assert_restored(vault)


def test_an_inner_teardown_that_swallows_the_failure_still_gives_the_borrow_back(
    tmp_path: Path,
) -> None:
    """The mirror image: the body raised, an inner handler decided the run may continue,
    and the borrow's block therefore ends *normally*. A restore wired only to the failure
    path never runs here — and the owner's list stays modified with nothing having failed."""
    vault = make_vault(tmp_path, "vault-swallowed")
    inner = InnerTeardown(swallow=True)

    with borrow(vault):
        with inner:
            raise Boom("handled and forgiven")

    assert inner.exited
    assert_restored(vault)


@pytest.mark.parametrize("shape", sorted(SHAPES))
def test_a_finally_in_the_body_that_raises_system_exit_still_restores(
    tmp_path: Path, shape: str
) -> None:
    vault = make_vault(tmp_path, f"vault-finally-exit-{shape}", shape)

    with pytest.raises(SystemExit):
        with borrow(vault):
            try:
                raise Boom("the gate failed mid-run")
            finally:
                raise SystemExit(7)

    assert_restored(vault, shape)


def test_an_exit_stack_callback_that_raises_after_the_borrow_still_restores(
    tmp_path: Path,
) -> None:
    """An ExitStack unwinds LIFO, so a callback pushed after the borrow runs first. If it
    raises, the borrow's own __exit__ is called with that exception in flight — exactly the
    situation a `try: ... except Exception: restore()` teardown gets wrong."""
    vault = make_vault(tmp_path, "vault-exitstack")
    seen = []

    def later() -> None:
        seen.append("callback")
        raise TeardownBoom("the relay refused to stop")

    with pytest.raises(TeardownBoom):
        with contextlib.ExitStack() as stack:
            stack.enter_context(borrow(vault))
            stack.callback(later)
            assert (vault / constants.COMMUNITY_PLUGINS_MARKER_REL).is_file()

    assert seen == ["callback"]
    assert_restored(vault)


# --- the three vault shapes are genuinely borrowed --------------------------------------


@pytest.mark.parametrize("shape", sorted(SHAPES))
def test_the_borrow_is_real_for_every_shape(tmp_path: Path, shape: str) -> None:
    """Without this, every restore assertion in this file would also hold for a context
    manager that never touched the vault."""
    vault = make_vault(tmp_path, f"vault-real-{shape}", shape)
    original = SHAPES[shape]

    with borrow(vault) as record:
        assert (vault / constants.COMMUNITY_PLUGINS_MARKER_REL).is_file()
        if original is None:
            assert record.had_original is False
            assert not (vault / constants.COMMUNITY_PLUGINS_BACKUP_REL).exists()
        else:
            assert record.had_original is True
            assert (vault / constants.COMMUNITY_PLUGINS_BACKUP_REL).read_bytes() == original
            during = (vault / constants.COMMUNITY_PLUGINS_REL).read_bytes()
            assert during != original
            assert b"obsidian-git" not in during

    assert_restored(vault, shape)


def test_a_list_without_obsidian_git_is_still_handed_back_unrewritten(tmp_path: Path) -> None:
    """Nothing to disable is not nothing to restore: the rig rewrites the file anyway, and
    the owner's CRLFs and tabs are theirs whether or not an id was removed."""
    vault = make_vault(tmp_path, "vault-no-git", "without_obsidian_git")
    original = SHAPES["without_obsidian_git"]

    with pytest.raises(KeyboardInterrupt):
        with borrow(vault):
            assert (vault / constants.COMMUNITY_PLUGINS_REL).read_bytes() != original
            raise KeyboardInterrupt

    assert (vault / constants.COMMUNITY_PLUGINS_REL).read_bytes() == original
    assert_restored(vault, "without_obsidian_git")


def test_an_absent_list_is_not_conjured_into_existence_by_an_aborted_borrow(
    tmp_path: Path,
) -> None:
    """The owner had no community-plugins.json. "Byte-exact" for that vault means there is
    still no file — a restored `[]` is a file Obsidian did not have."""
    vault = make_vault(tmp_path, "vault-absent", "absent")

    with pytest.raises(SystemExit):
        with borrow(vault, constants.ROLE_B):
            raise SystemExit(1)

    assert not (vault / constants.COMMUNITY_PLUGINS_REL).exists()
    assert_restored(vault, "absent")


def test_the_bom_is_handed_back_and_was_not_stripped_mid_borrow(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-bom", "bom_and_crlf")
    with pytest.raises(Boom):
        with borrow(vault):
            during = (vault / constants.COMMUNITY_PLUGINS_REL).read_bytes()
            assert during.startswith(b"\xef\xbb\xbf"), "the modify path ate the BOM"
            raise Boom("mid-run")
    assert (vault / constants.COMMUNITY_PLUGINS_REL).read_bytes() == SHAPES["bom_and_crlf"]
    assert_restored(vault, "bom_and_crlf")


def test_nothing_the_borrow_writes_carries_the_sentinel(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-noleak")
    with pytest.raises(TeardownBoom):
        with borrow(vault) as record:
            assert SENTINEL not in repr(record)
            marker_raw = (vault / constants.COMMUNITY_PLUGINS_MARKER_REL).read_bytes()
            assert SENTINEL.encode("utf-8") not in marker_raw
            raise TeardownBoom("mid-run")
    assert_restored(vault)
    assert SENTINEL.encode("utf-8") in (vault / constants.PLUGIN_DATA_REL).read_bytes()


def test_fixture_audit_the_shapes_are_what_they_claim() -> None:
    assert SHAPES["absent"] is None
    assert b"obsidian-git" not in SHAPES["without_obsidian_git"]
    assert SHAPES["bom_and_crlf"].startswith(b"\xef\xbb\xbf")
    for label, raw in SHAPES.items():
        if raw is None:
            continue
        parsed = json.loads(raw.decode("utf-8-sig"))
        assert json.dumps(parsed, indent=2).encode("utf-8") != raw, label
        assert not raw.endswith(b"\n"), label
