# WP70 / obsidian-git precondition — blind counterpart 1 for "restore runs on every exit
# path including exception and KeyboardInterrupt".
#
# Different angle from the visible set. The visible cases name three exits by hand
# (Exception, KeyboardInterrupt, SystemExit). This one enumerates the exit paths a Python
# `with` block actually has, including the ones no one raises on purpose:
#
#   ├── the whole BaseException family, parametrised — MemoryError, asyncio.CancelledError,
#   │   a custom direct BaseException subclass, SystemExit(0) (a *successful* exit code),
#   │   GeneratorExit raised in the body
#   ├── a real GeneratorExit: a generator suspended inside the borrow and then closed
#   ├── the non-exception exits — `return` out of the block, `break` out of a loop in it
#   ├── the restore has ALREADY happened by the time the caller's `except` handler runs,
#   │   not merely by the time the test's last line does
#   └── two borrows over two different vaults, the inner one aborted: both come back
#
# The fixture list carries tabs and no trailing newline, so "restored" means the owner's
# bytes and not a JSON round trip that happens to contain the same ids.
#
# DATA SAFETY: synthetic fixture vaults under tmp_path, guarded against both owner vaults.
# No process is started, no socket opened.

from __future__ import annotations

import asyncio
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

RUN_ID = "20260804T101500Z-71-9ab4c7"

#: Tab indent, three ids, no trailing newline.
ORIGINAL = b'[\n\t"obsidian-git",\n\t"quickadd",\n\t"live-share"\n]'
ORIGINAL_SHA = hashlib.sha256(ORIGINAL).hexdigest()

SENTINEL = "s3nt1nel-blind1-tp31-do-not-leak"


class Abort(BaseException):
    """A direct BaseException subclass — the shape an operator-abort signal takes."""


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
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(
        json.dumps({"serverPassword": SENTINEL}).encode("utf-8")
    )
    (vault / constants.COMMUNITY_PLUGINS_REL).write_bytes(ORIGINAL)
    return vault


def community(vault: Path) -> bytes:
    return (vault / constants.COMMUNITY_PLUGINS_REL).read_bytes()


def assert_borrow_is_open(vault: Path) -> bytes:
    """The borrow is genuinely in effect — otherwise every restore assertion below would
    also hold for a context manager that does nothing at all."""
    during = community(vault)
    assert during != ORIGINAL
    assert hashlib.sha256(during).hexdigest() != ORIGINAL_SHA
    assert b"obsidian-git" not in during
    assert (vault / constants.COMMUNITY_PLUGINS_BACKUP_REL).read_bytes() == ORIGINAL
    return during


def assert_restored(vault: Path) -> None:
    raw = community(vault)
    assert len(raw) == len(ORIGINAL)
    assert hashlib.sha256(raw).hexdigest() == ORIGINAL_SHA
    assert raw == ORIGINAL
    assert not (vault / constants.COMMUNITY_PLUGINS_BACKUP_REL).exists()
    assert not (vault / constants.COMMUNITY_PLUGINS_MARKER_REL).exists()
    assert (vault / constants.PLUGIN_DATA_REL).exists(), "the borrow disturbed data.json"


def borrow(vault: Path, role: str = constants.ROLE_B):
    return provisioning.borrowed_community_plugins(vault, role, run_id=RUN_ID)


# --- the whole BaseException family ---------------------------------------------------

EXITS = {
    "runtime_error": Boom("the gate failed mid-run"),
    "memory_error": MemoryError(),
    "os_error": OSError("the vault went away under us"),
    "cancelled": asyncio.CancelledError(),
    "custom_base_exception": Abort("operator aborted the run"),
    "keyboard_interrupt": KeyboardInterrupt(),
    "system_exit_zero": SystemExit(0),
    "system_exit_message": SystemExit("the harness asked us to stop"),
    "generator_exit": GeneratorExit(),
    "base_exception_itself": BaseException("something no one anticipated"),
}


@pytest.mark.parametrize("label", sorted(EXITS))
def test_every_exit_path_restores_the_owners_list(tmp_path: Path, label: str) -> None:
    """`except Exception` catches exactly three of these ten. The other seven would each
    leave the owner's Obsidian starting up with obsidian-git silently off."""
    vault = make_vault(tmp_path, f"vault-{label}")
    thrown = EXITS[label]

    with pytest.raises(type(thrown)):
        with borrow(vault):
            assert_borrow_is_open(vault)
            raise thrown

    assert_restored(vault)


def test_a_generator_closed_inside_the_borrow_still_restores(tmp_path: Path) -> None:
    """Nobody raises GeneratorExit on purpose — the interpreter does, when a suspended
    generator is collected or closed. A run driven by a generator-based harness reaches
    this path without anything in the rig having failed."""
    vault = make_vault(tmp_path, "vault-generator")

    def driver():
        with borrow(vault):
            yield community(vault)

    gen = driver()
    during = next(gen)
    assert during != ORIGINAL
    gen.close()

    assert_restored(vault)


def test_returning_out_of_the_block_restores(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-return")

    def run() -> bytes:
        with borrow(vault):
            return assert_borrow_is_open(vault)

    during = run()
    assert during != ORIGINAL
    assert_restored(vault)


def test_breaking_out_of_a_loop_inside_the_block_restores(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-break")
    for attempt in range(5):
        with borrow(vault):
            assert_borrow_is_open(vault)
            if attempt == 0:
                break
    assert_restored(vault)


def test_the_restore_is_already_done_when_the_handler_runs(tmp_path: Path) -> None:
    """`__exit__` before the caller's `except` is what makes an outer teardown that reads
    the vault see the owner's file rather than the rig's. A restore hung off the caller's
    own `finally` would satisfy the visible assertions and fail this one."""
    vault = make_vault(tmp_path, "vault-ordering")
    observed = None

    try:
        with borrow(vault):
            assert_borrow_is_open(vault)
            raise Boom("mid-run")
    except Boom:
        observed = community(vault)

    assert observed == ORIGINAL
    assert_restored(vault)


def test_an_exception_chained_from_another_still_restores(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-chained")
    with pytest.raises(Boom) as excinfo:
        with borrow(vault):
            try:
                raise ValueError("the first failure")
            except ValueError as err:
                raise Boom("the failure that surfaced") from err
    assert isinstance(excinfo.value.__cause__, ValueError)
    assert_restored(vault)


def test_two_vaults_borrowed_at_once_both_come_back(tmp_path: Path) -> None:
    """The gate borrows both vaults. An abort inside the inner one must not leave the
    outer one borrowed — the unwinding is per-context, not per-run."""
    outer = make_vault(tmp_path, "vault-outer")
    inner = make_vault(tmp_path, "vault-inner")

    with pytest.raises(KeyboardInterrupt):
        with borrow(outer, constants.ROLE_A):
            assert_borrow_is_open(outer)
            with borrow(inner, constants.ROLE_B):
                assert_borrow_is_open(inner)
                raise KeyboardInterrupt

    assert_restored(outer)
    assert_restored(inner)


def test_the_borrow_survives_an_abort_and_can_be_taken_again(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-reentry")
    for thrown in (SystemExit(3), KeyboardInterrupt(), Abort("again")):
        with pytest.raises(type(thrown)):
            with borrow(vault):
                raise thrown
        assert_restored(vault)

    with borrow(vault) as record:
        assert record.original_sha256 == ORIGINAL_SHA
        assert_borrow_is_open(vault)
    assert_restored(vault)


def test_nothing_the_borrow_writes_carries_the_sentinel(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-noleak")
    with borrow(vault) as record:
        marker_raw = (vault / constants.COMMUNITY_PLUGINS_MARKER_REL).read_bytes()
        assert SENTINEL.encode("utf-8") not in marker_raw
        assert SENTINEL.encode("utf-8") not in community(vault)
        assert SENTINEL not in repr(record)
    assert_restored(vault)
    assert SENTINEL.encode("utf-8") in (vault / constants.PLUGIN_DATA_REL).read_bytes()


def test_fixture_audit_the_exit_set_covers_more_than_except_exception() -> None:
    ordinary = {label for label, exc in EXITS.items() if isinstance(exc, Exception)}
    beyond = {label for label, exc in EXITS.items() if not isinstance(exc, Exception)}
    assert len(ordinary) >= 3 and len(beyond) >= 4
    assert json.dumps(json.loads(ORIGINAL.decode("utf-8")), indent=2).encode("utf-8") != ORIGINAL
    assert b"\t" in ORIGINAL and not ORIGINAL.endswith(b"\n")
