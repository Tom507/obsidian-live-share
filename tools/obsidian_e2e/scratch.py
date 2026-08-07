"""WP47 — scratch canvas lifecycle and vault data safety for the real-Obsidian rig.

Outcome (charter §1): **the owner's two working vaults are provably unchanged by any
run, including a failed one.**

Everything here exists to make that a structural property rather than a promise:

- **AC1 — nothing pre-existing is ever opened for writing.** Every mutation this module
  performs goes through exactly three call sites — :func:`_write_scratch_file`,
  :func:`_remove_scratch_file` and :func:`_remove_scratch_folder` — and each of them
  first calls :func:`assert_write_allowed`, which refuses any vault path outside
  :data:`~obsidian_e2e.constants.SCRATCH_FOLDER` (and, for WP44's port provisioning,
  :data:`~obsidian_e2e.constants.PLUGIN_DIR_REL`). There is no parameter and no branch
  that can steer a write elsewhere, so auditing the claim is one grep for
  ``assert_write_allowed``. The scratch path itself is *derived* from the pinned
  constants (:func:`scratch_relpath`), never chosen; a pre-existing note that merely
  *looks* like a scratch file is not in the rig folder and is therefore an ordinary
  protected note — the rig owns a **folder**, not a name.
- **AC2 — teardown runs on every exit path.** :func:`scratch_run` is a context manager
  whose cleanup runs for success, assertion failure, arbitrary exceptions and
  ``BaseException`` (``KeyboardInterrupt``), and it re-raises the original failure
  unmasked — *including* when its own cleanup then fails, which is the case a plain
  ``except: cleanup(); raise`` silently gets wrong (an error raised out of the handler
  replaces the exception in flight). Cleanup errors land on ``run.teardown_errors``
  instead. The cleanup also runs at the right *moment*: it executes while the original
  exception is propagating, so every context manager the body opened has already unwound
  and an outer teardown sees this one finished. In teardown the rig folder is removed
  **only** when this run created it **and** it is empty — a stray user file or a concurrent
  run's live artefact stops the removal and is never deleted along with it. Removing the
  folder is a courtesy; never deleting a file somebody else still owns is the requirement.
  Start-up is a different situation and has its own rule: see
  :func:`reclaim_scratch_folder`.
- **AC3 — the fingerprint is the verdict, not a log line (D16).**
  :func:`fingerprint_vault` records ``(relative_posix_path, size, sha256_of_bytes)`` —
  **hash only, never content**, because ``data.json`` holds a live production secret
  (S4, STANDING). The before-run and after-teardown fingerprints must be equal; any
  difference makes :func:`scratch_run` raise :class:`ScratchError` with reason
  :data:`~obsidian_e2e.constants.FINGERPRINT_MISMATCH`, so a mutated vault **cannot**
  produce a green run. The hash is load-bearing, not decorative: a content change that
  preserves the file size is exactly the case a ``(path, size, mtime)`` fingerprint
  misses.
- **AC4 — identity and stale reclaim.** ``run_id`` comes from
  :func:`~obsidian_e2e.constants.new_run_id`, whose tail is a per-process counter rather
  than a per-call random draw, so two runs started in the same second in the same process
  cannot collide — not merely probably do not. A scratch artefact
  left behind by an earlier crashed run is **removed at start-up, never reused**
  (:func:`reclaim_stale_scratch`), and reclaiming is idempotent so it is safe to call
  unconditionally at every start-up. "Stale" means *not owned by a run that is live in
  this process* — a live run's artefact is registered in :data:`_LIVE_RUNS` and skipped,
  which is what lets two overlapping runs share one vault.

**No constant is re-declared here.** ``SCRATCH_FOLDER``, ``SCRATCH_PREFIX``,
``SCRATCH_EXT``, ``PLUGIN_DIR_REL``, ``FINGERPRINT_EXCLUDED``, ``FINGERPRINT_MISMATCH``,
``SCRATCH_STALE_UNRECLAIMED``, ``new_run_id()`` and ``scratch_rel_path()`` are imported
from :mod:`obsidian_e2e.constants` (WP43), the single owning module.
:data:`DEFAULT_SCRATCH_CONTENT` is the Python mirror of the constant of the same name in
``plugin/src/testing/e2e-control.ts``, which is where the TS side pins it
(T3_SharedContract §5/§6.1); the two must stay byte-identical.

Standard library only — no new dependency, on either side of the rig. Every function is
pointable at a fixture vault by argument; nothing here knows or hardcodes a real vault
path.
"""

from __future__ import annotations

import hashlib
import os
import threading
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterator, Mapping, Optional, Tuple

from . import constants

__all__ = [
    "DEFAULT_SCRATCH_CONTENT",
    "Fingerprint",
    "ScratchError",
    "ScratchRun",
    "VaultWriteRefused",
    "Verdict",
    "assert_write_allowed",
    "diff_fingerprints",
    "fingerprint_vault",
    "is_scratch_relpath",
    "reclaim_scratch_folder",
    "reclaim_stale_scratch",
    "scratch_relpath",
    "scratch_run",
    "stale_scratch_relpaths",
]

#: A vault fingerprint: vault-relative POSIX path -> ``(size, sha256_hex)``.
#: Deliberately *not* the bytes (S4) — a fingerprint that carried content would carry
#: the production secret in ``data.json`` with it.
Fingerprint = Dict[str, Tuple[int, str]]

#: Empty canvas document written when the caller supplies no content. Mirrors
#: ``DEFAULT_SCRATCH_CONTENT`` in ``plugin/src/testing/e2e-control.ts`` byte for byte;
#: the TS module is the pin, this is the Python side of the same value.
DEFAULT_SCRATCH_CONTENT = '{"nodes":[],"edges":[]}'

#: The only vault-relative prefixes any rig write may target (S1). ``SCRATCH_FOLDER`` is
#: this WP's; ``PLUGIN_DIR_REL`` belongs to WP44's port provisioning and is listed so the
#: guard is the *whole* sanctioned set rather than a WP-local view of it.
SANCTIONED_WRITE_PREFIXES = (constants.SCRATCH_FOLDER, constants.PLUGIN_DIR_REL)

_HASH_CHUNK_BYTES = 1 << 20


# ---------------------------------------------------------------------------
# Failure surface
# ---------------------------------------------------------------------------


class ScratchError(RuntimeError):
    """A run-failing scratch/data-safety condition, naming one sanctioned reason.

    ``reason`` is always one of :data:`~obsidian_e2e.constants.FAILURE_REASONS` — this
    module invents no reason string of its own. ``changed`` carries the vault-relative
    paths that differed, and **only** the paths: never a size delta interpretation and
    never a byte of content (S4).
    """

    def __init__(
        self,
        reason: str,
        message: str = "",
        changed: Tuple[str, ...] = (),
    ) -> None:
        self.reason = reason
        self.changed = tuple(changed)
        super().__init__(message or reason)


class VaultWriteRefused(RuntimeError):
    """A write was aimed at a vault path outside the sanctioned prefixes.

    This is a *programming* error, not a run condition: it means a code path tried to
    reach a pre-existing note, canvas or attachment. It is raised rather than logged so
    the attempt cannot proceed, and it is deliberately not a :class:`ScratchError` —
    there is no sanctioned failure reason for it because it must never happen.
    """


# ---------------------------------------------------------------------------
# Verdict
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Verdict:
    """The data-safety verdict of a run — part of the run's outcome, not a diagnostic.

    ``ok`` is ``True`` only when the after-teardown fingerprint equals the before-run
    one. ``reason`` is ``None`` on success and
    :data:`~obsidian_e2e.constants.FINGERPRINT_MISMATCH` on failure; ``changed`` lists
    every vault-relative path that was added, removed or altered.
    """

    ok: bool
    reason: Optional[str] = None
    changed: Tuple[str, ...] = ()


# ---------------------------------------------------------------------------
# Path derivation and confinement (AC1)
# ---------------------------------------------------------------------------


def scratch_relpath(run_id: str) -> str:
    """Vault-relative path of the scratch canvas for ``run_id``.

    Delegates to :func:`~obsidian_e2e.constants.scratch_rel_path` so the composition
    ``SCRATCH_FOLDER/SCRATCH_PREFIX + run_id + SCRATCH_EXT`` exists in exactly one place.
    """
    return constants.scratch_rel_path(run_id)


def is_scratch_relpath(relpath: str) -> bool:
    """Is ``relpath`` a rig-owned scratch artefact — one level inside the rig folder?

    The predicate is deliberately narrow, because everything it accepts is something the
    rig is willing to delete. It requires exactly ``<SCRATCH_FOLDER>/<PREFIX><id><EXT>``:
    a vault-relative POSIX path, one level deep, with a non-empty id. Root-level and
    other-folder look-alikes, nested paths, traversals, absolute paths, backslash
    separators, a missing prefix and a wrong extension are all rejected — a user note
    that merely resembles a scratch name is an ordinary protected note.
    """
    if not isinstance(relpath, str) or not relpath:
        return False
    if "\\" in relpath or "\x00" in relpath:
        return False

    parts = relpath.split("/")
    if len(parts) != 2:  # exactly one level deep; kills "", "/x/y", "a/b/c"
        return False

    folder, name = parts
    if folder != constants.SCRATCH_FOLDER:
        return False
    if name in ("", ".", ".."):
        return False
    if not name.startswith(constants.SCRATCH_PREFIX):
        return False
    if not name.endswith(constants.SCRATCH_EXT):
        return False

    run_id = name[len(constants.SCRATCH_PREFIX) : len(name) - len(constants.SCRATCH_EXT)]
    return len(run_id) > 0


def assert_write_allowed(vault: Path, target: Path) -> str:
    """Return ``target``'s vault-relative POSIX path, or refuse the write.

    **This is the single funnel every vault mutation in this module passes through**
    (AC1). A path outside the vault, or inside it but outside
    :data:`SANCTIONED_WRITE_PREFIXES`, raises :class:`VaultWriteRefused` before anything
    is opened, created or unlinked.
    """
    root = Path(vault).resolve()
    resolved = Path(target).resolve()
    try:
        rel = resolved.relative_to(root).as_posix()
    except ValueError as exc:  # pragma: no cover - defensive; no call site can do this
        raise VaultWriteRefused(
            f"refused: write target is outside the vault: {resolved}"
        ) from exc

    for prefix in SANCTIONED_WRITE_PREFIXES:
        if rel == prefix or rel.startswith(prefix + "/"):
            return rel

    raise VaultWriteRefused(
        "refused: a rig write may only target "
        + " or ".join(SANCTIONED_WRITE_PREFIXES)
        + f"; got {rel!r}"
    )


# ---------------------------------------------------------------------------
# Fingerprint (AC3)
# ---------------------------------------------------------------------------


def _is_excluded(rel: str) -> bool:
    """Is this vault-relative path inside one of the fingerprint's excluded trees?"""
    return any(
        rel == excluded or rel.startswith(excluded + "/")
        for excluded in constants.FINGERPRINT_EXCLUDED
    )


def _hash_file(path: Path) -> Tuple[int, str]:
    """``(size, sha256_hex)`` of a file, read in chunks and never retained.

    Opened read-only. The bytes exist only inside this function and only long enough to
    be folded into the digest — no caller ever sees content (S4).
    """
    digest = hashlib.sha256()
    size = 0
    with open(path, "rb") as handle:
        while True:
            chunk = handle.read(_HASH_CHUNK_BYTES)
            if not chunk:
                break
            size += len(chunk)
            digest.update(chunk)
    return size, digest.hexdigest()


def fingerprint_vault(vault: Path) -> Fingerprint:
    """Fingerprint every file in ``vault`` outside the excluded trees.

    Excluded (T3_SharedContract §5): the rig folder — its contents are *supposed* to
    change — the live-share plugin dir (WP44's own borrow-and-restore territory), and
    ``.git/`` / ``.trash/``. The rest of ``.obsidian/`` is **not** excluded: a run that
    rewrote ``app.json`` would be changing the vault.

    Read-only. Returns ``rel_posix -> (size, sha256_hex)``.
    """
    root = Path(vault)
    out: Fingerprint = {}

    for dirpath, dirnames, filenames in os.walk(root):
        rel_dir = Path(dirpath).relative_to(root).as_posix()
        prefix = "" if rel_dir == "." else rel_dir + "/"

        # Prune excluded trees in place so os.walk never descends into them at all.
        dirnames[:] = [d for d in dirnames if not _is_excluded(prefix + d)]

        for filename in filenames:
            rel = prefix + filename
            if _is_excluded(rel):
                continue
            path = Path(dirpath) / filename
            try:
                out[rel] = _hash_file(path)
            except OSError:
                # A file that vanished or cannot be read is still a fact about the
                # vault: record it as an unreadable entry rather than silently
                # dropping it, so it still shows up in a diff.
                out[rel] = (-1, "unreadable")

    return out


def diff_fingerprints(before: Mapping[str, Tuple[int, str]], after: Mapping[str, Tuple[int, str]]) -> Tuple[str, ...]:
    """Vault-relative paths that differ between two fingerprints — sorted, deduplicated.

    Catches all four change classes: **added** (absent before), **deleted** (absent
    after), **renamed** (both of the above, so both names appear) and **content changed**
    — including a change that preserves the file size, which is precisely why the entry
    carries a sha256 and not just a size.
    """
    changed = {
        rel
        for rel in set(before) | set(after)
        if before.get(rel) != after.get(rel)
    }
    return tuple(sorted(changed))


# ---------------------------------------------------------------------------
# Live-run registry — what makes "stale" decidable (AC4)
# ---------------------------------------------------------------------------

#: vault key -> set of scratch relpaths owned by runs that are live **in this process**.
#: The reclaim rule is "not owned by a live run here", which is what lets two
#: overlapping runs share a vault without either eating the other's artefact. It is
#: data-safe in every case (only rig-owned artefacts are ever removed), but it is an
#: assumption about single-process operation — see charter §7b item 3.
_LIVE_RUNS: Dict[str, set] = {}
_LIVE_LOCK = threading.Lock()


def _vault_key(vault: Path) -> str:
    """Case- and separator-normalised identity of a vault path (Windows-safe)."""
    return os.path.normcase(str(Path(vault).resolve()))


def _register_live(vault: Path, relpath: str) -> None:
    with _LIVE_LOCK:
        _LIVE_RUNS.setdefault(_vault_key(vault), set()).add(relpath)


def _unregister_live(vault: Path, relpath: str) -> None:
    with _LIVE_LOCK:
        key = _vault_key(vault)
        live = _LIVE_RUNS.get(key)
        if live is None:
            return
        live.discard(relpath)
        if not live:
            _LIVE_RUNS.pop(key, None)


def _live_relpaths(vault: Path) -> frozenset:
    with _LIVE_LOCK:
        return frozenset(_LIVE_RUNS.get(_vault_key(vault), ()))


# ---------------------------------------------------------------------------
# Stale reclaim (AC4)
# ---------------------------------------------------------------------------


def reclaim_stale_scratch(vault: Path) -> Tuple[str, ...]:
    """Remove scratch artefacts left behind by earlier crashed runs. Idempotent.

    Removed, **never reused**: adopting a leftover file would make a run inherit another
    run's state and would hide the crash that produced it.

    Only files that satisfy :func:`is_scratch_relpath` directly inside the rig folder are
    candidates. A non-rig file the user parked there, a subfolder, and a file belonging
    to a run that is live in this process are all left alone. The rig folder itself is
    never created and never removed here — reclaim inspects, it does not provision.

    Returns the sorted tuple of reclaimed vault-relative paths; ``()`` when there was
    nothing to do, which is what makes repeated calls a no-op.
    """
    root = Path(vault)
    folder = root / constants.SCRATCH_FOLDER
    if not folder.is_dir():
        return ()

    live = _live_relpaths(root)
    reclaimed: list = []

    for entry in sorted(folder.iterdir(), key=lambda p: p.name):
        rel = f"{constants.SCRATCH_FOLDER}/{entry.name}"
        if not is_scratch_relpath(rel):
            continue  # a user file, or a look-alike we do not own
        if rel in live:
            continue  # a concurrent run's live artefact, not stale
        if not entry.is_file():
            continue  # never recurse into a directory
        try:
            _remove_scratch_file(root, entry)
        except OSError:
            # Locked or otherwise undeletable: it stays, and it stays *stale*. The
            # caller's start-up check turns that into SCRATCH_STALE_UNRECLAIMED rather
            # than letting the run proceed over an artefact it could not clear.
            continue
        reclaimed.append(rel)

    return tuple(sorted(reclaimed))


def reclaim_scratch_folder(vault: Path) -> bool:
    """Remove the whole rig-owned folder at **start-up**, debris and all. Idempotent.

    Two different situations need two different rules, and conflating them is the bug this
    function exists to avoid:

    ├── **teardown** (:func:`scratch_run`) removes the folder only when *this run* created
    │   it and it is *empty*. Everything else in there belongs to somebody who is still
    │   around — a concurrent run's live artefact, a file the user just dropped in — so
    │   the folder stays. That rule is unchanged.
    └── **start-up** (this function) is looking at the wreckage of a run that is already
        gone. The rig owns :data:`~obsidian_e2e.constants.SCRATCH_FOLDER` outright: it
        creates it, it is the only thing that writes into it, and nothing outside the rig
        has a reason to put anything there. Its whole contents are therefore that run's
        debris — a partial write, a ``.tmp`` sibling, a log, a subdirectory a crash left
        behind — and an "only if empty" test would leave the folder standing forever after
        the first crash, with the rig's own leftovers inside it. Completeness is the
        requirement here.

    The guard that keeps this from becoming a vault cleaner is **confinement**, and it is
    unchanged: :func:`assert_write_allowed` is called for every single entry and for the
    folder itself, so nothing outside the rig folder can be reached from here — a
    user-owned canvas elsewhere in the vault that merely *looks* like a scratch file is
    untouchable, and so is every note, attachment and setting. A folder still holding an
    artefact of a run **live in this process** is left completely alone: that is not
    wreckage, that is a running peer.

    There is no ``rmtree``: the tree is walked bottom-up and every removal goes through the
    guarded single-file / single-directory primitives. Any failure abandons the removal
    where it stands and returns ``False`` — the caller reports what is left rather than
    forcing it.

    Returns ``True`` when the folder is gone because this call removed it.
    """
    root = Path(vault)
    folder = root / constants.SCRATCH_FOLDER
    if not folder.is_dir():
        return False

    live = _live_relpaths(root)
    if any(rel.startswith(constants.SCRATCH_FOLDER + "/") for rel in live):
        return False  # a run in this process is using the folder; it is not wreckage

    try:
        for dirpath, dirnames, filenames in os.walk(folder, topdown=False):
            here = Path(dirpath)
            for name in filenames:
                _remove_scratch_file(root, here / name)
            for name in dirnames:
                _remove_scratch_folder(root, here / name)
        _remove_scratch_folder(root, folder)
    except (OSError, VaultWriteRefused):
        return False
    return True


def stale_scratch_relpaths(vault: Path) -> Tuple[str, ...]:
    """Scratch artefacts present in the vault that no live run in this process owns."""
    root = Path(vault)
    folder = root / constants.SCRATCH_FOLDER
    if not folder.is_dir():
        return ()

    live = _live_relpaths(root)
    return tuple(
        sorted(
            rel
            for rel in (
                f"{constants.SCRATCH_FOLDER}/{entry.name}"
                for entry in folder.iterdir()
                if entry.is_file()
            )
            if is_scratch_relpath(rel) and rel not in live
        )
    )


# ---------------------------------------------------------------------------
# The three — and only three — mutation sites (AC1)
# ---------------------------------------------------------------------------


def _write_scratch_file(vault: Path, path: Path, content: str) -> None:
    assert_write_allowed(vault, path)
    path.write_bytes(content.encode("utf-8"))


def _remove_scratch_file(vault: Path, path: Path) -> None:
    assert_write_allowed(vault, path)
    path.unlink()


def _remove_scratch_folder(vault: Path, folder: Path) -> None:
    assert_write_allowed(vault, folder)
    folder.rmdir()  # never rmtree: an unexpected entry must make this fail, not delete


def _create_scratch_folder(vault: Path, folder: Path) -> None:
    assert_write_allowed(vault, folder)
    folder.mkdir()


# ---------------------------------------------------------------------------
# The run
# ---------------------------------------------------------------------------


@dataclass
class ScratchRun:
    """One run's disposable canvas plus the data-safety evidence around it."""

    vault: Path
    run_id: str
    relpath: str
    path: Path
    folder: Path
    #: Did *this* run create the rig folder? Only then may teardown remove it.
    folder_created: bool = False
    #: Stale artefacts removed at start-up (sorted, vault-relative).
    reclaimed: Tuple[str, ...] = ()
    #: Fingerprint taken at start-up; ``after`` stays ``None`` until teardown.
    before: Fingerprint = field(default_factory=dict)
    after: Optional[Fingerprint] = None
    removed: bool = False
    folder_removed: bool = False
    #: Anything that went wrong *while tearing down*, in the order it happened. On a failed
    #: or interrupted run these are recorded rather than raised, because replacing the
    #: reason the run failed with the reason its cleanup failed loses the more important
    #: fact. They are still visible here, so a swallowed error is not a silent one.
    teardown_errors: Tuple[BaseException, ...] = ()
    #: Green until teardown proves otherwise; the mismatch case replaces it.
    verdict: Verdict = field(default_factory=lambda: Verdict(ok=True))

    def write(self, content: str) -> None:
        """Overwrite the scratch canvas. The only write this object offers."""
        _write_scratch_file(self.vault, self.path, content)


@contextmanager
def scratch_run(
    vault: Path,
    run_id: Optional[str] = None,
    content: Optional[str] = None,
) -> Iterator[ScratchRun]:
    """Give the run its own disposable canvas, and prove the vault survived it.

    Start-up: reclaim stale artefacts (AC4), fingerprint the vault (AC3), ensure the rig
    folder, write the scratch file (AC1).

    Teardown — on **every** exit path including ``KeyboardInterrupt`` (AC2): remove the
    scratch file, remove the rig folder if and only if this run created it and it is now
    empty, re-fingerprint, and compare.

    A mismatch raises :class:`ScratchError` with reason
    :data:`~obsidian_e2e.constants.FINGERPRINT_MISMATCH` — the comparison is the run's
    verdict, not a diagnostic (D16). When the body already failed, that original
    exception propagates unmasked and is *not* replaced by the fingerprint error: the run
    has already failed, and hiding why would be worse. ``run.verdict`` still records the
    mismatch in that case.

    ``run_id`` and ``content`` are injectable for tests; the defaults are
    :func:`~obsidian_e2e.constants.new_run_id` and :data:`DEFAULT_SCRATCH_CONTENT`.
    Pinning ``run_id`` cannot aim the run at a pre-existing note — the path is always
    derived folder-scoped.
    """
    root = Path(vault)
    if not root.is_dir():
        raise ScratchError(
            constants.VAULT_PATH_MISSING,
            f"vault path does not exist or is not a directory: {root}",
        )

    identity = run_id if run_id is not None else constants.new_run_id()
    relpath = scratch_relpath(identity)
    folder = root / constants.SCRATCH_FOLDER
    path = root / relpath

    run = ScratchRun(
        vault=root,
        run_id=identity,
        relpath=relpath,
        path=path,
        folder=folder,
    )

    # --- start-up -----------------------------------------------------------
    run.reclaimed = reclaim_stale_scratch(root)
    unreclaimed = stale_scratch_relpaths(root)
    if unreclaimed:
        # Reclaim ran and something rig-owned survived it (locked file, permissions).
        # Starting anyway would mean running beside an artefact we cannot account for,
        # so the run stops with the named reason instead (AC4, WP48 AC4).
        raise ScratchError(
            constants.SCRATCH_STALE_UNRECLAIMED,
            "stale scratch artefacts could not be reclaimed: " + ", ".join(unreclaimed),
            changed=unreclaimed,
        )
    run.before = fingerprint_vault(root)

    run.folder_created = not folder.exists()
    if run.folder_created:
        _create_scratch_folder(root, folder)

    _register_live(root, relpath)
    try:
        _write_scratch_file(root, path, content if content is not None else DEFAULT_SCRATCH_CONTENT)
    except BaseException:
        _unregister_live(root, relpath)
        if run.folder_created and folder.is_dir() and not any(folder.iterdir()):
            _remove_scratch_folder(root, folder)
            run.folder_removed = True
        raise

    # --- body, then teardown on every exit path ------------------------------
    try:
        yield run
    except BaseException:
        # The body failed — it may have been interrupted. Two properties matter here and
        # neither is incidental:
        #
        # 1. ORDER. Python unwinds inside-out, so every context manager the body opened has
        #    already finished unwinding by the time control reaches this handler. Teardown
        #    therefore always observes a fully-unwound state, and an outer teardown (WP48's
        #    ``run_with_teardown``) observes this one as finished.
        # 2. NO MASKING. A cleanup failure during an interruption must not replace the
        #    interruption: ``raise`` re-raises the original ``KeyboardInterrupt`` whatever
        #    teardown ran into, and what teardown ran into is kept on ``run.teardown_errors``.
        _teardown(run, mask_errors=True)
        raise  # never mask the reason the run failed — not even with a teardown error

    _teardown(run)

    if not run.verdict.ok:
        raise ScratchError(
            run.verdict.reason or constants.FINGERPRINT_MISMATCH,
            "vault changed outside the run's scratch artefacts: "
            + ", ".join(run.verdict.changed),
            changed=run.verdict.changed,
        )


def _teardown(run: ScratchRun, *, mask_errors: bool = False) -> None:
    """Remove this run's artefacts and settle the verdict. Idempotent.

    The two removals are attempted **independently**: a file that cannot be unlinked must
    not also cost the folder removal, the live-run deregistration or the after-fingerprint.
    Errors are collected on the run rather than thrown from the middle of the sequence, so
    teardown always reaches its end and always leaves a settled state behind.

    ``mask_errors`` says what to do with them afterwards. On the failure path it is
    ``True``: the caller is already propagating the reason the run failed — very possibly a
    ``KeyboardInterrupt`` — and raising a cleanup error over it would replace the answer to
    "why did this run stop?" with the answer to "what else went wrong on the way out?".
    On the clean path it is ``False`` and the first error is raised, because there is
    nothing more important to report.
    """
    if run.after is not None:  # already torn down
        return

    errors: list = []
    try:
        try:
            if run.path.exists():
                _remove_scratch_file(run.vault, run.path)
                run.removed = True
        except BaseException as exc:  # noqa: BLE001 - recorded, never silently dropped
            errors.append(exc)

        # A folder this run did not create is not ours to remove, and a folder holding
        # anything at all — a stray user file, a concurrent run's live artefact — stays.
        # rmdir (never rmtree) means "empty" is enforced by the OS as well as by us.
        try:
            if (
                run.folder_created
                and run.folder.is_dir()
                and not any(run.folder.iterdir())
            ):
                _remove_scratch_folder(run.vault, run.folder)
                run.folder_removed = True
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)
    finally:
        _unregister_live(run.vault, run.relpath)

    run.teardown_errors = tuple(errors)
    run.after = fingerprint_vault(run.vault)
    changed = diff_fingerprints(run.before, run.after)
    run.verdict = (
        Verdict(ok=True)
        if not changed
        else Verdict(ok=False, reason=constants.FINGERPRINT_MISMATCH, changed=changed)
    )

    if errors and not mask_errors:
        raise errors[0]
