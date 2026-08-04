"""WP69 — the one-shot E2E build and the reversible install of its bundle in a vault.

Outcome (charter §1): the gate can build, in one terminating command, the only bundle that
can host it — and both the shipped bundle and the owner's vaults are provably where they
were.

Why this module exists at all — the measured blocker
----------------------------------------------------
``plugin/esbuild.config.mjs`` had exactly two modes. ``npm run build`` folds
``__LS_E2E__`` to ``"false"``, so ``src/testing/`` is dead-code-eliminated and no control
server can ever answer, whatever port WP44 provisions; ``npm run dev`` keeps the
instrumentation but calls ``ctx.watch()`` and **never returns**. The only E2E-capable build
was the only build that could not be awaited. WP69 adds a third mode —
:data:`~obsidian_e2e.constants.E2E_BUILD_ARGV`, reachable through the single npm script
:data:`~obsidian_e2e.constants.E2E_BUILD_SCRIPT` — that builds once and exits, and this
module drives it.

Both vaults carry a *production* bundle (``PLUGIN_NOT_E2E_CAPABLE`` in
:mod:`obsidian_e2e.readiness`). Making them E2E-capable means replacing one file inside the
owner's live vault, which is why every rule below is about giving it back.

Success is exit status **and** markers — never file presence (AC3)
------------------------------------------------------------------
The rejected alternative was "fire and forget the watcher, poll ``main.js``, kill it". A
killed watcher leaves a *truncated* bundle, and that bundle is a file that exists, with a
fresh mtime, that would then be installed into the owner's vault. So a build is accepted
only when the process exited ``0`` **and** all of
:data:`~obsidian_e2e.constants.E2E_BUILD_MARKERS` are present in the emitted bytes. Neither
file presence, nor a moved mtime, nor "a watcher was killed at a plausible moment" is ever
consulted; :func:`verify_e2e_bundle` has no access to any of them.

The E2E bundle is **substantially larger** than the production one — the dev configuration
emits ``sourcemap: "inline"``. That size difference is expected, and is why size is
recorded rather than asserted.

The bundle is borrowed, never taken (AC4)
-----------------------------------------
Exactly one file per vault is written: ``<vault>/.obsidian/plugins/live-share/main.js``.
``manifest.json``, ``styles.css``, ``data.json``, ``community-plugins.json`` and the
owner's own backups (``main.js.bak``, ``main.js.0.5.9.bak``, ``manifest.json.bak``,
``styles.css.bak``) are never written, moved, renamed or deleted — and, the part that is
easy to get wrong, they are never used as a restore point either. The rig restores from its
**own** namespace (:data:`~obsidian_e2e.constants.BUNDLE_BACKUP_REL`) and from nothing else;
faced with a corrupted rig backup it refuses loudly rather than reaching for the
owner's ``main.js.bak``, which may hold anything at all.

Restore is the criterion, not the intention: the restore point is written, read back and
verified **before** the live bundle is touched, so an install that cannot establish one does
not install. Restore runs on normal exit, on an exception, on ``KeyboardInterrupt`` and —
via an ``atexit`` guard — on an interpreter shutdown that skips the ``finally``.

This module follows WP44's discipline (:mod:`obsidian_e2e.ports`) rather than inventing its
own: raw bytes, atomic replace, a marker carrying fingerprints and structure only, adoption
of a consistent leftover borrow, refusal of a contradictory one.

The record is never trusted, at any entry point
-----------------------------------------------
A restore point is a *claim* stored in two files, and the whole of AC4 lives in what happens
when that claim and the thing it describes disagree. So the rule here is not "check the
hash" but:

├── the marker is validated **field by field** over the whole pinned set (§4.1) — a record
│   that was truncated, hand-edited, half-written or produced by something else is refused,
│   not partially believed, whichever field carries the damage;
├── **every** fingerprint the marker records about the displaced bundle — its sha256 *and*
│   its byte length — is checked against the backup file itself. WP44's marker records one;
│   this one records two, and recording a second fingerprint that nothing ever verifies is
│   strictly worse than not recording it, because it reads like corroboration;
├── the same checks run at **every** entry point that consumes that state —
│   :func:`capture_bundle_state`, :func:`install_bundle` (through it) and
│   :func:`restore_bundle` — since a record refused by one and accepted by another is a
│   record that gets used by whichever path happens to run; and
├── the restore point is read back **through the validator teardown will use** before the
│   live bundle is touched, and a failure to establish it undoes every artefact this call
│   created. "An install that cannot establish its restore point does not install" is a
│   statement about the failure path, so the failure path leaves the vault byte-for-byte as
│   it was rather than half-borrowed.

Structural damage (a field that cannot be what this module writes) is
:data:`~obsidian_e2e.constants.INSTALL_CONFLICT`; an intact record that the bytes contradict
is :data:`~obsidian_e2e.constants.BUNDLE_RESTORE_MISMATCH` once teardown is the caller —
the same discriminator ``ports.py`` draws, so a reader who knows one module knows this one.

``data.json`` is not this WP's business
---------------------------------------
It holds live credentials. Nothing here reads it, moves it or needs it: the string
``PLUGIN_DATA_REL`` does not appear below, no record or marker field can carry file content,
and no refusal message contains anything but paths, sizes, hashes and a named reason (S4).

Failure reasons come from :mod:`obsidian_e2e.constants` (contract §7); this module defines
none of its own and re-declares no constant that ``constants.py`` already owns.
"""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import shutil
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional, Sequence, Tuple, Union

from . import constants

__all__ = [
    "InstallError",
    "E2EBuildFailed",
    "BundleNotE2ECapable",
    "BundleRestoreMismatch",
    "InstallConflict",
    "PluginNotInstalled",
    "BuildResult",
    "BundleState",
    "InstallRecord",
    "RestoreBundleResult",
    "count_build_markers",
    "build_command",
    "verify_e2e_bundle",
    "build_e2e_bundle",
    "capture_bundle_state",
    "install_bundle",
    "restore_bundle",
    "installed_bundle",
]

PathLike = Union[str, "os.PathLike[str]"]

#: ``runner(command, cwd) -> exit_status``. The seam exists so the build can be driven by a
#: test without ever spawning npm, and so a caller may route the real build through the
#: workspace's ``visible-console`` tools instead of :func:`subprocess.run`.
Runner = Callable[[Sequence[str], str], int]

#: The emitted bundle's file name, derived from the path WP43 already pins — the name is
#: not spelled a second time anywhere in this batch.
BUNDLE_NAME = constants.PLUGIN_MAIN_REL.rsplit("/", 1)[-1]

#: The esbuild ``define`` whose value separates a production bundle from an instrumented
#: one. It is a *build-input* name, not part of the pinned §4.1 namespace (whose contents
#: the shared-ownership contract enumerates exhaustively), so it lives here — once.
E2E_DEFINE_NAME = "__LS_E2E__"

#: The package manager that runs the added script. Resolved through :func:`shutil.which` at
#: call time so Windows' ``npm.cmd`` shim is found without a shell.
_PACKAGE_MANAGER = "npm"
_PACKAGE_MANAGER_RUN = "run"

#: Prefix of the temporary file used for atomic replacement. It exists only between an
#: ``open`` and an ``os.replace`` in the same directory, and is removed on every error.
_TMP_PREFIX = ".main.js.e2e-tmp-"


# ---------------------------------------------------------------------------
# Errors — every abort names exactly one reason from constants.py (contract §7)
# ---------------------------------------------------------------------------


class InstallError(RuntimeError):
    """Base class for a named abort.

    ``reason`` is always one of :data:`obsidian_e2e.constants.FAILURE_REASONS`. Neither the
    message nor the repr ever carries file content (S4) — only paths, hashes, sizes, marker
    names and the reason itself.
    """

    reason: str = ""

    def __init__(self, message: str, *, reason: Optional[str] = None) -> None:
        if reason is not None:
            self.reason = reason
        super().__init__(f"{self.reason}: {message}" if self.reason else message)


class E2EBuildFailed(InstallError):
    """The build process reported a non-zero exit status (AC1, AC3).

    Raised **before** the emitted file is looked at, because a completed-looking bundle at
    the outfile proves nothing about the build that was supposed to produce it: it may be
    the previous build's, or a truncated write.
    """

    reason = constants.E2E_BUILD_FAILED


class BundleNotE2ECapable(InstallError):
    """A bundle that cannot host the control server (AC3).

    A clean exit with a missing marker is exactly the shape a truncated or wrongly
    configured build takes, and it is the state the pre-flight measured in both vaults.
    """

    reason = constants.BUNDLE_NOT_E2E_CAPABLE


class BundleRestoreMismatch(InstallError):
    """A restore that would not be, or was not, byte-exact (AC4)."""

    reason = constants.BUNDLE_RESTORE_MISMATCH


class InstallConflict(InstallError):
    """A pre-existing install state that cannot be reconciled (AC4).

    The discriminator against :class:`BundleRestoreMismatch` is the same one WP44 uses:
    *structural vs. content*. A missing, unexpected or unreadable half of the record is a
    conflict; a present record whose bytes do not hash to the captured original is a restore
    mismatch.
    """

    reason = constants.INSTALL_CONFLICT


class PluginNotInstalled(InstallError):
    """The vault has no ``.obsidian/plugins/live-share/`` directory.

    The rig does not create a plugin directory inside a vault — that would be a write the
    owner did not have before the run, and on the wrong path it would silently install
    nothing. WP43 already owns this state's name.
    """

    reason = constants.PLUGIN_MISSING


# ---------------------------------------------------------------------------
# Result types — fingerprints and structure only, never file content (S4)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class BuildResult:
    """What one build produced, and why it was accepted.

    Both halves of AC3's oracle are recorded, not just the verdict: ``exit_status`` and the
    marker sets. ``size`` is reported rather than checked — the E2E bundle is far larger
    than the production one because of the inline sourcemap.
    """

    mode: str
    command: Tuple[str, ...]
    exit_status: int
    bundle_path: str
    size: int
    sha256: str
    markers_found: Tuple[str, ...]
    markers_missing: Tuple[str, ...]
    e2e_capable: bool


@dataclass(frozen=True)
class BundleState:
    """The vault's borrow record as it exists on disk, already validated.

    ``original_bytes`` is present only while a caller holds this object; it is never written
    anywhere except back into ``main.js`` or the rig's backup file.
    """

    has_marker: bool
    had_original: bool
    original_sha256: Optional[str]
    original_bytes: Optional[bytes]
    marker: Optional[dict]


@dataclass(frozen=True)
class InstallRecord:
    """What one installation actually did.

    Note what is absent: no settings, no bundle bytes, no field that could carry content out
    of the vault. ``original_sha256`` is the hash of the displaced production bundle — the
    value AC4's restore is checked against.
    """

    role: str
    vault_path: str
    bundle_path: str
    backup_path: str
    marker_path: str
    had_original: bool
    original_sha256: Optional[str]
    original_size: Optional[int]
    installed_sha256: str
    installed_size: int
    run_id: str
    pid: int
    created_at: str
    #: ``True`` when this call adopted a borrow left by an earlier (crashed) run rather than
    #: starting one. The captured original is then that run's, not this one's.
    adopted_existing_backup: bool


@dataclass(frozen=True)
class RestoreBundleResult:
    """What teardown did.

    ``restored`` is ``False`` only for the safe no-op: there was nothing borrowed. A restore
    that *should* have happened and could not be made byte-exact raises instead of returning
    ``restored=False``.
    """

    restored: bool
    had_original: bool
    #: State of ``main.js`` **after** teardown. ``False`` is the correct outcome when the
    #: vault had no bundle before the run: the rig's addition is removed, not emptied.
    bundle_file_present: bool
    vault_path: str
    bundle_path: str
    reason: Optional[str] = None
    restored_sha256: Optional[str] = None
    restored_size: Optional[int] = None


# ---------------------------------------------------------------------------
# Paths and small pure helpers
# ---------------------------------------------------------------------------


def _vault(vault_path: PathLike) -> Path:
    return Path(vault_path)


def _plugin_dir(vault: Path) -> Path:
    return vault / constants.PLUGIN_DIR_REL


def _bundle_path(vault: Path) -> Path:
    return vault / constants.PLUGIN_MAIN_REL


def _backup_path(vault: Path) -> Path:
    return vault / constants.BUNDLE_BACKUP_REL


def _marker_path(vault: Path) -> Path:
    return vault / constants.INSTALL_MARKER_REL


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _read_bytes_or_none(path: Path) -> Optional[bytes]:
    """Read a file as raw bytes, or ``None`` when it does not exist.

    Raw bytes only — a bundle is not text and must never be decoded to be handled.
    """
    try:
        with open(path, "rb") as handle:
            return handle.read()
    except FileNotFoundError:
        return None
    except IsADirectoryError:
        return None


def _atomic_write_bytes(path: Path, data: bytes) -> None:
    """Write ``data`` to ``path`` atomically, leaving no temporary file behind.

    The temporary lives in the same directory so ``os.replace`` is a rename, never a copy
    across volumes, and is removed on every failure path — a half-written ``main.js`` inside
    the owner's vault is precisely the outcome this WP exists to make impossible.
    """
    tmp = path.parent / f"{_TMP_PREFIX}{secrets.token_hex(6)}"
    try:
        with open(tmp, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


def _remove_if_present(path: Path) -> None:
    try:
        os.remove(path)
    except FileNotFoundError:
        pass


def _is_int(value: object) -> bool:
    """``True`` for a genuine integer. ``bool`` is excluded: it is not a size or a pid."""
    return isinstance(value, int) and not isinstance(value, bool)


def _is_digest(value: object) -> bool:
    """``True`` for something shaped like a sha256 hex digest.

    Shape only — 64 characters of *some* string. Whether those characters are the right
    ones is a **content** question, answered by comparing against the file the digest
    claims to describe. Keeping the two apart is what makes ``INSTALL_CONFLICT`` (a
    damaged record) distinguishable from ``BUNDLE_RESTORE_MISMATCH`` (an intact record
    that the file contradicts) — the same discriminator WP44's ``ports.py`` uses.
    """
    return isinstance(value, str) and len(value) == 64


# ---------------------------------------------------------------------------
# The marker counter — AC3's oracle, and the helper AC2's measurement quotes
# ---------------------------------------------------------------------------


def count_build_markers(data: bytes) -> dict:
    """Count each pinned E2E build marker, and the build flag, in ``data``.

    Counted over **raw bytes**: ``main.js`` is a bundle, it may hold any byte sequence, and a
    helper that decoded it as UTF-8 would die on a real one. Each marker is counted
    independently — a helper that OR-ed them together would report a bundle carrying one
    marker as fully instrumented.

    The keys are :data:`~obsidian_e2e.constants.E2E_BUILD_MARKERS` plus
    :data:`E2E_DEFINE_NAME`. AC3 reads the former (all three present ⇒ capable); AC2's
    recorded measurement reads both (all zero ⇒ the production signature, ``src/testing/``
    shaken out).
    """
    counts = {marker: data.count(marker.encode("utf-8")) for marker in constants.E2E_BUILD_MARKERS}
    counts[E2E_DEFINE_NAME] = data.count(E2E_DEFINE_NAME.encode("utf-8"))
    return counts


# ---------------------------------------------------------------------------
# The build (AC1, AC3)
# ---------------------------------------------------------------------------


def build_command() -> Tuple[str, ...]:
    """Return the exact command that produces the E2E bundle.

    One-shot by construction: the script passes
    :data:`~obsidian_e2e.constants.E2E_BUILD_ARGV` as ``argv[2]``, and that branch calls
    ``ctx.rebuild()`` then ``process.exit(0)``. It is never ``npm run dev`` — that mode
    calls ``ctx.watch()`` and does not return, so awaiting it blocks until a timeout and the
    obvious diagnosis ("the build is slow") is wrong.
    """
    return (_PACKAGE_MANAGER, _PACKAGE_MANAGER_RUN, constants.E2E_BUILD_SCRIPT)


def _default_runner(command: Sequence[str], cwd: str) -> int:
    """Run ``command`` in ``cwd`` and return its exit status.

    The executable is resolved through :func:`shutil.which` so Windows' ``npm.cmd`` shim is
    found without handing the command line to a shell. The build terminates on its own; no
    timeout is used as an oracle and nothing is killed.
    """
    argv = list(command)
    resolved = shutil.which(argv[0])
    if resolved is None:
        raise E2EBuildFailed(
            f"{argv[0]!r} is not on PATH, so the E2E bundle cannot be built in {cwd}"
        )
    argv[0] = resolved
    completed = subprocess.run(argv, cwd=cwd, check=False)  # noqa: S603 - fixed argv
    return int(completed.returncode)


def verify_e2e_bundle(
    bundle_path: PathLike,
    *,
    exit_status: int,
    command: Sequence[str] = (),
    mode: str = constants.E2E_BUILD_ARGV,
) -> BuildResult:
    """Decide whether a build produced an installable E2E bundle.

    Both halves of the oracle can veto on their own:

    ├── exit ``0`` and every marker present  → capable
    ├── non-zero exit, whatever is on disk   → :class:`E2EBuildFailed`
    └── clean exit, one marker missing       → :class:`BundleNotE2ECapable`

    The status is checked first and without reading the file, because "a bundle is there"
    is the exact non-signal C69 rejects: a failed or interrupted build leaves the *previous*
    ``main.js`` in place, complete and plausible. Neither ``mtime`` nor mere existence is
    consulted anywhere in this function.
    """
    path = Path(bundle_path)
    if not isinstance(exit_status, int):
        # Acceptance needs a *proven* zero. A runner that returned something that is not an
        # exit status did not report a successful build, and coercing it into one is how a
        # missing return value becomes a shipped bundle.
        raise E2EBuildFailed(
            f"the build reported {type(exit_status).__name__} instead of an exit status; "
            f"{path} is not accepted as a bundle"
        )
    if exit_status != 0:
        raise E2EBuildFailed(
            f"the build exited {exit_status}; {path} is not accepted as a bundle "
            "regardless of what is on disk"
        )

    data = _read_bytes_or_none(path)
    if data is None:
        raise BundleNotE2ECapable(
            f"the build exited 0 but emitted no bundle at {path}"
        )

    counts = count_build_markers(data)
    found = tuple(marker for marker in constants.E2E_BUILD_MARKERS if counts[marker] > 0)
    missing = tuple(marker for marker in constants.E2E_BUILD_MARKERS if counts[marker] == 0)
    if missing:
        raise BundleNotE2ECapable(
            f"{path} ({len(data)} bytes) is missing the E2E build marker(s) "
            f"{missing!r}; a bundle without them cannot host a control server, whatever "
            "port is provisioned"
        )

    return BuildResult(
        mode=mode,
        command=tuple(command),
        exit_status=exit_status,
        bundle_path=str(path),
        size=len(data),
        sha256=_sha256(data),
        markers_found=found,
        markers_missing=missing,
        e2e_capable=True,
    )


def build_e2e_bundle(plugin_dir: PathLike, *, runner: Optional[Runner] = None) -> BuildResult:
    """Build the E2E bundle in ``plugin_dir`` and verify it before returning.

    ``runner(command, cwd) -> exit_status`` is the injection seam. The default shells out to
    the added npm script; a caller that must keep a long command visible passes its own
    runner (the workspace's ``visible-console`` tools), and tests pass a fake so that no
    test ever spawns a real build.

    A non-zero status raises :class:`E2EBuildFailed` **without touching the outfile**, so a
    complete bundle left by an earlier build stays exactly where it was.
    """
    cwd = Path(plugin_dir)
    command = build_command()
    reported = (runner or _default_runner)(command, str(cwd))
    if not isinstance(reported, int):
        raise E2EBuildFailed(
            f"{' '.join(command)} reported {type(reported).__name__} instead of an exit "
            f"status in {cwd}; the previous bundle was left untouched and nothing is "
            "installed"
        )
    status = int(reported)
    if status != 0:
        raise E2EBuildFailed(
            f"{' '.join(command)} exited {status} in {cwd}; the previous bundle was left "
            "untouched and nothing is installed"
        )
    return verify_e2e_bundle(cwd / BUNDLE_NAME, exit_status=status, command=command)


# ---------------------------------------------------------------------------
# Install state — reading and validating what an earlier run left behind (AC4)
# ---------------------------------------------------------------------------


def _load_marker(vault: Path) -> Optional[dict]:
    """Return the parsed install marker, or ``None`` when there is none.

    An unreadable or structurally wrong marker is a **conflict**, not a missing marker: the
    difference between "nothing borrowed" and "a borrow whose record is damaged" is exactly
    the difference between proceeding and refusing.

    **Every** field of the pinned set is validated, not the two that a happy path happens to
    read back. A record is only a restore point if it is intact as a whole: a marker that
    was truncated, hand-edited, half-written or produced by something other than this module
    can have any of its fields wrong, and one that is trusted because nothing looked at it is
    indistinguishable from one that is correct — until the restore it authorises destroys the
    owner's bundle. So a field that cannot be what this module writes there is a refusal,
    whichever field it is:

    ├── ``runId`` · ``role`` · ``createdAt``  ← non-empty strings; ``role`` names a real role
    ├── ``pid``                               ← a non-negative integer, never a bool
    ├── ``hadOriginal``                       ← a boolean, never a truthy stand-in
    ├── ``installedSha256``                   ← always a digest; the rig always installs one
    └── ``originalSha256`` / ``originalSize`` ← a digest **and** a byte length exactly when
                                                ``hadOriginal``, and both absent otherwise

    Shape is all that is decided here. Whether the recorded digest and length describe the
    file they claim to describe is a content question, answered against the backup itself by
    :func:`capture_bundle_state` and :func:`restore_bundle`.
    """
    raw = _read_bytes_or_none(_marker_path(vault))
    if raw is None:
        return None
    try:
        marker = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as err:
        raise InstallConflict(
            f"the install marker at {_marker_path(vault)} is unreadable"
        ) from err
    if not isinstance(marker, dict):
        raise InstallConflict(f"the install marker at {_marker_path(vault)} is not an object")
    if set(marker) != set(constants.INSTALL_MARKER_FIELDS):
        raise InstallConflict(
            f"the install marker at {_marker_path(vault)} does not carry the pinned field "
            f"set {constants.INSTALL_MARKER_FIELDS!r}"
        )

    for field in ("runId", "role", "createdAt"):
        if not isinstance(marker[field], str) or not marker[field]:
            raise InstallConflict(
                f"the install marker's {field!r} is not a non-empty string"
            )
    if marker["role"] not in constants.ROLES:
        raise InstallConflict(
            f"the install marker names a role that is not one of {constants.ROLES!r}"
        )
    if not _is_int(marker["pid"]) or marker["pid"] < 0:
        raise InstallConflict("the install marker's 'pid' is not a non-negative integer")
    if not isinstance(marker["hadOriginal"], bool):
        raise InstallConflict("the install marker's 'hadOriginal' is not a boolean")
    if not _is_digest(marker["installedSha256"]):
        raise InstallConflict(
            "the install marker's 'installedSha256' is not a sha256 digest; the rig never "
            "records a borrow without recording what it installed"
        )

    sha = marker["originalSha256"]
    size = marker["originalSize"]
    if marker["hadOriginal"]:
        if not _is_digest(sha):
            raise InstallConflict(
                "the install marker claims a displaced bundle but carries no sha256 for it"
            )
        if not _is_int(size) or size < 0:
            raise InstallConflict(
                "the install marker claims a displaced bundle but carries no byte length "
                "for it"
            )
    else:
        if sha is not None:
            raise InstallConflict(
                "the install marker claims there was no bundle yet carries a sha256"
            )
        if size is not None:
            raise InstallConflict(
                "the install marker claims there was no bundle yet carries a byte length"
            )
    return marker


def capture_bundle_state(vault_path: PathLike) -> BundleState:
    """Validate and return the install state of ``vault_path`` **without writing anything**.

    This is the single decision point for AC4's "an install that cannot establish its
    restore point does not install". Three shapes are legal:

    ├── no marker, no rig backup                       ← nothing borrowed; the live
    │                                                    ``main.js`` is the owner's
    ├── marker(hadOriginal=True) + a rig backup hashing to the recorded sha256
    └── marker(hadOriginal=False) + no rig backup      ← the vault had no bundle

    Anything else is contradictory: the two halves are one statement about the owner's file,
    so a disagreement means the original is unknown. Guessing there is how data gets
    destroyed, so it aborts as ``INSTALL_CONFLICT`` with nothing written. The owner's own
    ``main.js.bak`` is never consulted — by any branch, for any purpose.
    """
    vault = _vault(vault_path)
    marker = _load_marker(vault)
    backup = _read_bytes_or_none(_backup_path(vault))

    if marker is None:
        if backup is not None:
            raise InstallConflict(
                f"a saved bundle exists at {_backup_path(vault)} with no marker to say what "
                "it is; refusing to treat it as either a restore point or debris"
            )
        live = _read_bytes_or_none(_bundle_path(vault))
        return BundleState(
            has_marker=False,
            had_original=live is not None,
            original_sha256=_sha256(live) if live is not None else None,
            original_bytes=live,
            marker=None,
        )

    if marker["hadOriginal"]:
        if backup is None:
            raise InstallConflict(
                f"the marker records a saved bundle but {_backup_path(vault)} is gone; the "
                "owner's bundle can no longer be reconstructed"
            )
        actual = _sha256(backup)
        if actual != marker["originalSha256"]:
            raise InstallConflict(
                f"the saved bundle at {_backup_path(vault)} ({len(backup)} bytes, sha256 "
                f"{actual}) does not match the sha256 the marker recorded "
                f"({marker['originalSha256']})"
            )
        # Both halves of the recorded fingerprint, not the one that is hardest to fake. A
        # digest that matches while the recorded length does not can only come from a
        # record that was edited after it was written, and a record that disagrees with
        # itself is not a restore point.
        if len(backup) != marker["originalSize"]:
            raise InstallConflict(
                f"the saved bundle at {_backup_path(vault)} is {len(backup)} bytes, but the "
                f"marker records the displaced bundle as {marker['originalSize']} bytes"
            )
        return BundleState(
            has_marker=True,
            had_original=True,
            original_sha256=marker["originalSha256"],
            original_bytes=backup,
            marker=marker,
        )

    if backup is not None:
        raise InstallConflict(
            f"the marker records that no bundle existed, yet a saved bundle is present at "
            f"{_backup_path(vault)}"
        )
    return BundleState(
        has_marker=True,
        had_original=False,
        original_sha256=None,
        original_bytes=None,
        marker=marker,
    )


def _marker_blob(
    *,
    run_id: str,
    role: str,
    had_original: bool,
    original_sha256: Optional[str],
    original_size: Optional[int],
    installed_sha256: str,
    pid: int,
    created_at: str,
) -> bytes:
    """Serialise the marker with exactly the pinned field set (contract §4.1).

    Fingerprints and structure only — no path is stored inside it and no field can carry a
    byte of any file the rig read (S4).
    """
    marker = {
        "runId": run_id,
        "role": role,
        "hadOriginal": had_original,
        "originalSha256": original_sha256,
        "originalSize": original_size,
        "installedSha256": installed_sha256,
        "pid": pid,
        "createdAt": created_at,
    }
    assert set(marker) == set(constants.INSTALL_MARKER_FIELDS)
    return json.dumps(marker, indent=2).encode("utf-8") + b"\n"


# ---------------------------------------------------------------------------
# Install (AC4)
# ---------------------------------------------------------------------------


def install_bundle(
    vault_path: PathLike,
    role: str,
    source_bundle: PathLike,
    *,
    run_id: Optional[str] = None,
) -> InstallRecord:
    """Install ``source_bundle`` as ``vault_path``'s plugin bundle, reversibly.

    Order is the acceptance criterion, not the outcome. In sequence:

    1. the plugin directory must already exist — the rig never creates one inside a vault,
       and ``obsidian-live-share`` is the *repo* folder while ``live-share`` is the plugin
       id, so a hand-built path would install nothing, silently;
    2. the source bundle is verified E2E-capable, before it is placed anywhere;
    3. :func:`capture_bundle_state` validates any leftover borrow — a contradictory one
       aborts here, with the vault byte-for-byte as it was;
    4. the displaced bundle is written to the rig's **own** backup path and the marker
       beside it, and the pair is then read back **through
       :func:`capture_bundle_state`** — the same oracle :func:`restore_bundle` will use —
       so the restore point is not merely written but proven to be one *this module can
       restore from*, before anything irreversible happens;
    5. only then is ``main.js`` replaced, atomically.

    Steps 4 and 5 are all-or-nothing. If the restore point cannot be established, every
    artefact **this call** created is removed and any marker it overwrote is put back, so a
    refusal leaves the vault byte-for-byte as it was rather than half-borrowed — a state
    that would block the next run and tell a human nothing. An artefact an earlier run left
    behind is never removed by that rollback: it may be the only copy of the owner's bundle.

    Exactly one pre-existing file changes identity. The two files the rig adds are its
    backup and its marker; nothing else in the vault is written, moved, renamed or deleted.

    ``role`` is recorded, not resolved: this function has no notion of a "current" vault and
    cannot act on the owner's vault unless a caller passes that path explicitly. It must
    still *be* a role — an unrecognised one is a programming error, not a run outcome, so it
    raises :class:`ValueError` exactly as WP44's ``ports.provision_port`` does, and never
    reaches the marker.
    """
    vault = _vault(vault_path)
    if role not in constants.ROLES:
        raise ValueError(f"unknown role {role!r}; expected one of {constants.ROLES!r}")
    plugin_dir = _plugin_dir(vault)
    if not plugin_dir.is_dir():
        raise PluginNotInstalled(
            f"no plugin directory at {plugin_dir}; the rig does not create one inside a "
            "vault (and the plugin id is not the repo folder name)"
        )

    source = Path(source_bundle)
    payload = _read_bytes_or_none(source)
    if payload is None:
        raise BundleNotE2ECapable(f"there is no bundle to install at {source}")
    counts = count_build_markers(payload)
    missing = tuple(marker for marker in constants.E2E_BUILD_MARKERS if counts[marker] == 0)
    if missing:
        raise BundleNotE2ECapable(
            f"{source} ({len(payload)} bytes) is missing the E2E build marker(s) "
            f"{missing!r}; it is not installed anywhere"
        )

    # Validate first: a refusal must leave the vault byte-for-byte as it was.
    state = capture_bundle_state(vault)

    bundle_path = _bundle_path(vault)
    backup_path = _backup_path(vault)
    marker_path = _marker_path(vault)
    adopted = state.has_marker
    identity = run_id or constants.new_run_id()
    created_at = datetime.now(timezone.utc).isoformat()
    pid = os.getpid()
    installed_sha = _sha256(payload)

    original_size = len(state.original_bytes) if state.original_bytes is not None else None

    # The restore point is established and VERIFIED before the live bundle is touched. The
    # backup is written once per borrow and never overwritten by the already-installed
    # state, so a run that crashes before teardown leaves a vault the next run can still
    # restore correctly.
    #
    # Everything written between here and the `main.js` replacement is undone on any
    # failure: until the live bundle changes, the rig's own artefacts are the only trace of
    # this call, and a refusal owes the owner a vault that looks untouched.
    wrote_backup = False
    prior_marker = _read_bytes_or_none(marker_path)
    try:
        if state.had_original and not backup_path.exists():
            _atomic_write_bytes(backup_path, state.original_bytes or b"")
            wrote_backup = True
            written_backup = _read_bytes_or_none(backup_path)
            if (
                written_backup is None
                or len(written_backup) != (original_size or 0)
                or _sha256(written_backup) != state.original_sha256
            ):
                raise BundleRestoreMismatch(
                    f"the restore point at {backup_path} does not reproduce the displaced "
                    f"bundle (expected {original_size} bytes / sha256 "
                    f"{state.original_sha256}); nothing was installed"
                )

        _atomic_write_bytes(
            marker_path,
            _marker_blob(
                run_id=identity,
                role=role,
                had_original=state.had_original,
                original_sha256=state.original_sha256,
                original_size=original_size,
                installed_sha256=installed_sha,
                pid=pid,
                created_at=created_at,
            ),
        )

        # Read the restore point back through the SAME validator teardown will run against
        # it. Writing a backup and a marker is not the criterion; being able to restore from
        # them is. Anything this pair cannot survive — a marker that did not land intact, a
        # backup the record no longer describes — is caught here, while `main.js` is still
        # the owner's and the refusal costs nothing.
        verified = capture_bundle_state(vault)
        if (
            not verified.has_marker
            or verified.had_original != state.had_original
            or verified.original_sha256 != state.original_sha256
            or (verified.original_bytes is None) != (state.original_bytes is None)
            or (
                verified.original_bytes is not None
                and len(verified.original_bytes) != original_size
            )
        ):
            raise BundleRestoreMismatch(
                f"the restore point written for {bundle_path} does not read back as the "
                f"borrow it records (expected hadOriginal={state.had_original}, "
                f"{original_size} bytes / sha256 {state.original_sha256}); nothing was "
                "installed"
            )
    except BaseException:
        # Undo only what this call added. An adopted backup or marker belongs to an earlier
        # run and may be the only surviving copy of the owner's bundle.
        if prior_marker is None:
            _remove_if_present(marker_path)
        else:
            try:
                _atomic_write_bytes(marker_path, prior_marker)
            except OSError:
                pass
        if wrote_backup:
            _remove_if_present(backup_path)
        raise

    _atomic_write_bytes(bundle_path, payload)

    return InstallRecord(
        role=role,
        vault_path=str(vault),
        bundle_path=str(bundle_path),
        backup_path=str(backup_path),
        marker_path=str(marker_path),
        had_original=state.had_original,
        original_sha256=state.original_sha256,
        original_size=original_size,
        installed_sha256=installed_sha,
        installed_size=len(payload),
        run_id=identity,
        pid=pid,
        created_at=created_at,
        adopted_existing_backup=adopted,
    )


# ---------------------------------------------------------------------------
# Restore (AC4)
# ---------------------------------------------------------------------------


def restore_bundle(vault_path: PathLike) -> RestoreBundleResult:
    """Return ``vault_path``'s plugin bundle to exactly its pre-install state.

    The restore path does not depend on the install path: it writes back the bytes captured
    in the rig's backup verbatim, then verifies the result by **sha256 and exact byte
    length** against the fingerprint the marker recorded.

    The rig's backup is the *only* restore point it recognises. The owner's ``main.js.bak``
    sits in the same directory and looks like one, but nothing states what it holds — so a
    corrupted rig backup raises :class:`BundleRestoreMismatch` and leaves backup, marker and
    the installed bundle in place for a human. A file nobody can reconstruct is strictly
    worse than a loud refusal.

    When the vault had **no** bundle, teardown removes the rig's file entirely rather than
    leaving an empty one. Calling this with nothing borrowed is a safe no-op
    (``restored=False``), so it is correct to call it unconditionally from a ``finally``,
    twice, or after a completed restore.
    """
    vault = _vault(vault_path)
    bundle_path = _bundle_path(vault)
    backup_path = _backup_path(vault)
    marker_path = _marker_path(vault)

    marker = _load_marker(vault)
    backup = _read_bytes_or_none(backup_path)

    if marker is None:
        if backup is not None:
            raise InstallConflict(
                f"a saved bundle exists at {backup_path} with no marker to say what it is; "
                "refusing to restore from an unattributed file"
            )
        return RestoreBundleResult(
            restored=False,
            had_original=False,
            bundle_file_present=bundle_path.is_file(),
            vault_path=str(vault),
            bundle_path=str(bundle_path),
            reason=None,
        )

    had_original = bool(marker["hadOriginal"])

    if had_original:
        if backup is None:
            raise InstallConflict(
                f"the marker records a saved bundle but {backup_path} is gone; the owner's "
                "bundle can no longer be reconstructed"
            )
        expected_sha = marker["originalSha256"]
        expected_size = marker["originalSize"]
        actual_sha = _sha256(backup)
        if actual_sha != expected_sha:
            # Verified BEFORE anything is written: the installed bundle is left in place and
            # the evidence (backup + marker) stays for a human.
            raise BundleRestoreMismatch(
                f"the saved bundle at {backup_path} ({len(backup)} bytes, sha256 "
                f"{actual_sha}) does not match the captured sha256 {expected_sha}; "
                "the plugin bundle was left untouched"
            )
        # Both halves of the fingerprint, at this entry point exactly as at the other one
        # (:func:`capture_bundle_state`). A record whose length contradicts the file it
        # describes is a record that was edited after the fact, and this is the last moment
        # at which refusing is still free.
        if len(backup) != expected_size:
            raise BundleRestoreMismatch(
                f"the saved bundle at {backup_path} is {len(backup)} bytes, but the marker "
                f"records the displaced bundle as {expected_size} bytes; the plugin bundle "
                "was left untouched"
            )

        _atomic_write_bytes(bundle_path, backup)

        # Checked against what the MARKER recorded, not against the bytes just written: a
        # readback compared only to its own source proves the write, never the restore.
        written = _read_bytes_or_none(bundle_path)
        if (
            written is None
            or len(written) != expected_size
            or _sha256(written) != expected_sha
        ):
            raise BundleRestoreMismatch(
                f"after writing {bundle_path} the file does not reproduce the captured "
                f"bundle (expected {expected_size} bytes / sha256 {expected_sha})"
            )

        _remove_if_present(backup_path)
        _remove_if_present(marker_path)
        return RestoreBundleResult(
            restored=True,
            had_original=True,
            bundle_file_present=True,
            vault_path=str(vault),
            bundle_path=str(bundle_path),
            reason=None,
            restored_sha256=expected_sha,
            restored_size=expected_size,
        )

    if backup is not None:
        raise InstallConflict(
            f"the marker records that no bundle existed, yet a saved bundle is present at "
            f"{backup_path}"
        )

    # There was no bundle before the run, so "byte-exact" means: none after it either.
    _remove_if_present(bundle_path)
    if bundle_path.exists():
        raise BundleRestoreMismatch(
            f"{bundle_path} still exists after teardown; the vault must look untouched"
        )
    _remove_if_present(marker_path)
    return RestoreBundleResult(
        restored=True,
        had_original=False,
        bundle_file_present=False,
        vault_path=str(vault),
        bundle_path=str(bundle_path),
        reason=None,
    )


# ---------------------------------------------------------------------------
# Every exit path — including failure, abort and interruption (AC4)
# ---------------------------------------------------------------------------


class _InstallGuard:
    """Restores a borrowed bundle on interpreter exit if teardown never ran.

    A ``finally`` covers a raised exception; it does not cover a ``SystemExit`` from a signal
    handler. The guard is a second, cheap net: registered while the borrow is live,
    unregistered the moment teardown succeeds.
    """

    def __init__(self, vault: Path) -> None:
        self._vault = vault
        self._active = True

    def release(self) -> None:
        self._active = False

    def __call__(self) -> None:
        if not self._active:
            return
        self._active = False
        try:
            restore_bundle(self._vault)
        except Exception:
            # An exit-time hook cannot usefully raise. The backup and marker survive, so the
            # next run — or a human — can still restore the vault.
            pass


def installed_bundle(
    vault_path: PathLike,
    role: str,
    source_bundle: PathLike,
    *,
    run_id: Optional[str] = None,
):
    """Context manager: install on entry, restore on **every** exit path.

    Yields the :class:`InstallRecord`. Teardown runs on normal exit, on an exception, on
    ``KeyboardInterrupt`` — which derives from ``BaseException``, so a bare
    ``except Exception`` teardown would leave the owner's vault holding an instrumented
    bundle — and, via an ``atexit`` guard, on an interpreter shutdown that skips the
    ``finally``.
    """
    return _InstalledBundle(vault_path, role, source_bundle, run_id=run_id)


class _InstalledBundle:
    def __init__(
        self,
        vault_path: PathLike,
        role: str,
        source_bundle: PathLike,
        *,
        run_id: Optional[str],
    ) -> None:
        self._vault = _vault(vault_path)
        self._role = role
        self._source = Path(source_bundle)
        self._run_id = run_id
        self._guard: Optional[_InstallGuard] = None

    def __enter__(self) -> InstallRecord:
        import atexit

        record = install_bundle(self._vault, self._role, self._source, run_id=self._run_id)
        self._guard = _InstallGuard(self._vault)
        atexit.register(self._guard)
        return record

    def __exit__(self, exc_type, exc, tb) -> bool:
        try:
            restore_bundle(self._vault)
        finally:
            if self._guard is not None:
                self._guard.release()
        return False
