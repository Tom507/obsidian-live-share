"""WP44 — per-vault control-port provisioning with byte-exact capture and restore.

Outcome (charter §1): two plugin instances inside one Obsidian process are independently
addressable, and the owner's plugin settings survive every run **unchanged**.

Why the per-vault settings file and not a process environment variable — **D14**
-------------------------------------------------------------------------------
Obsidian is single-instance. Opening a second vault does not start a second program; it
opens another renderer window inside the **same Obsidian process tree**. A process-level
channel therefore cannot distinguish the two roles: both windows would read the identical
``process.env.LIVESHARE_E2E`` value, one control server would win the bind, and the rig
would drive one vault twice while believing it drove two — a silent, total failure with a
green-looking run.

``<vault>/.obsidian/plugins/live-share/data.json`` lives **inside the vault**, so it is the
only channel that can carry two different values at the same instant. That is why the port
is provisioned as the hidden loose setting
:data:`~obsidian_e2e.constants.SETTINGS_PORT_KEY` and never through the process
environment. This module consequently reads no environment flag and mutates no environment
variable — structurally, not incidentally: the name ``os.environ`` does not appear in it.

``resolvePort`` in ``plugin/src/testing/e2e-control.ts`` is **frozen** (AC4). Its precedence
(numeric env → loose ``e2eControlPort`` setting → truthy-non-numeric env → ephemeral ``0`` →
``null`` = no server) is unchanged by this WP, and a vault with no provisioned port still
starts no control server at all. The only change made there is the D14 rationale comment.

Settings are borrowed, never taken (AC2)
----------------------------------------
The file being modified is the owner's live plugin configuration.

- The prior file is captured as **raw bytes** before anything is written, and teardown
  writes exactly those bytes back. There is no parse/serialise round-trip anywhere on the
  restore path — such a round-trip silently rewrites tab indentation, CRLF line endings,
  trailing-newline presence, key order, number formatting and non-ASCII escaping, all of
  which are part of "the owner's file".
- The **restore path does not depend on the modify path at all.** Restore reads the backup
  file and copies it verbatim; it never re-derives content from the provisioned state.
- The modify path also leaves the untouched remainder byte-identical: the port member is
  spliced into the top-level object textually (see :func:`_with_port`), never re-emitted.
- Every restore is verified — sha256 **and** exact byte length — and a failure is reported
  as :data:`~obsidian_e2e.constants.SETTINGS_RESTORE_MISMATCH` with the backup left in
  place for a human, never as a silent success.
- The **no-prior-file** case restores to *no file at all* — not an empty file, not ``{}``.

Idempotence and crash recovery (AC3)
------------------------------------
The backup is the statement "this is what the owner had". It is written **once**, on the
first borrow, and is never overwritten by the current (already-provisioned) state — so a
run that crashes before teardown leaves a vault that the *next* run can still restore
correctly. The marker file records the borrow so that statement survives the process:
``{runId, role, port, hadOriginal, originalSha256, pid, createdAt}`` — a sha256 fingerprint
and structure only, **never** the original content (contract S4; ``data.json`` holds a live
production secret). Consistent leftovers are adopted; contradictory ones
(backup/marker disagreement, missing backup, unexpected backup, unreadable marker, backup
with no marker) are refused as :data:`~obsidian_e2e.constants.PROVISION_CONFLICT` with
nothing written, because a rig that guesses there destroys data.

Pointability
------------
Every entry point takes the vault as an argument and the port as an override, so the whole
module can be — and in its tests only ever is — pointed at a fixture vault under
``tmp_path``. It has no notion of a "current" or "default" vault; nothing here can act on
the owner's real vault unless a caller passes that path explicitly.

Failure reasons come from :mod:`obsidian_e2e.constants` (contract §7); this module defines
none of its own and re-declares no constant that WP43 already owns.
"""

from __future__ import annotations

import hashlib
import json
import os
import secrets
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Mapping, Optional, Union

from . import constants

__all__ = [
    "ProvisionError",
    "ProvisionConflict",
    "SettingsRestoreMismatch",
    "PluginNotInstalled",
    "ProvisionRecord",
    "RestoreResult",
    "default_port_for_role",
    "provision_port",
    "restore_port",
    "provisioned_port",
    "provision_pair",
    "restore_pair",
    "capture_state",
]

PathLike = Union[str, "os.PathLike[str]"]

#: Whitespace JSON permits between tokens, plus the BOM code point, which a UTF-8-with-BOM
#: settings file decodes to and which must survive the round trip untouched.
_JSON_WS = " \t\r\n\ufeff"

#: Prefix of the temporary file used for atomic replacement. It only ever exists between
#: an ``open`` and an ``os.replace`` in the same directory, and is removed on every error.
_TMP_PREFIX = "data.json.e2e-tmp-"


# ---------------------------------------------------------------------------
# Errors — every abort names exactly one reason from constants.py (contract §7)
# ---------------------------------------------------------------------------


class ProvisionError(RuntimeError):
    """Base class for a named abort.

    ``reason`` is always one of :data:`obsidian_e2e.constants.FAILURE_REASONS`. Neither the
    message nor the repr ever carries settings content (S4) — only paths, hashes, sizes and
    the reason itself.
    """

    reason: str = ""

    def __init__(self, message: str, *, reason: Optional[str] = None) -> None:
        if reason is not None:
            self.reason = reason
        super().__init__(f"{self.reason}: {message}" if self.reason else message)


class ProvisionConflict(ProvisionError):
    """A pre-existing borrow state that cannot be reconciled (AC3).

    Raised when the backup and the marker disagree about what the owner's file was. The
    discriminator against :class:`SettingsRestoreMismatch` is *structural vs. content*: a
    missing, unexpected or unreadable half of the record is a conflict; a present record
    whose bytes do not hash to the captured original is a restore mismatch.
    """

    reason = constants.PROVISION_CONFLICT


class SettingsRestoreMismatch(ProvisionError):
    """A restore that would not be, or was not, byte-exact (AC2)."""

    reason = constants.SETTINGS_RESTORE_MISMATCH


class PluginNotInstalled(ProvisionError):
    """The vault has no ``.obsidian/plugins/live-share/`` directory.

    The rig does not create a plugin directory inside a vault; that would be a write the
    owner did not have before the run. WP43 already owns this state's name.
    """

    reason = constants.PLUGIN_MISSING


# ---------------------------------------------------------------------------
# Result types — fingerprints and structure only, never settings content (S4)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ProvisionRecord:
    """What one provisioning actually did.

    Note what is absent: no settings bytes, no parsed settings, no field that could carry a
    value out of ``data.json``. ``original_sha256`` is the sha256 of the captured original
    bytes — the hash, never a copy and never a truncation (S4).
    """

    role: str
    port: int
    vault_path: str
    settings_path: str
    backup_path: str
    marker_path: str
    had_original: bool
    original_sha256: Optional[str]
    original_size: Optional[int]
    run_id: str
    pid: int
    created_at: str
    #: ``True`` when this call adopted a borrow left by an earlier (crashed) run rather
    #: than starting one. The captured original is then that run's, not this one's.
    adopted_existing_backup: bool


@dataclass(frozen=True)
class RestoreResult:
    """What teardown did.

    ``restored`` is ``False`` only for the safe no-op: there was nothing borrowed. A restore
    that *should* have happened and could not be made byte-exact raises instead of
    returning ``restored=False``.
    """

    restored: bool
    had_original: bool
    #: State of ``data.json`` **after** teardown. ``False`` is the correct outcome when the
    #: owner had no settings file: the rig's addition is removed, not emptied.
    settings_file_present: bool
    vault_path: str
    settings_path: str
    reason: Optional[str] = None
    restored_sha256: Optional[str] = None
    restored_size: Optional[int] = None


@dataclass(frozen=True)
class BorrowState:
    """The vault's borrow record as it exists on disk, already validated.

    ``original_bytes`` is present only while a caller holds this object; it is never
    written anywhere except back into ``data.json`` or the backup file (S4).
    """

    has_marker: bool
    had_original: bool
    original_sha256: Optional[str]
    original_bytes: Optional[bytes]
    marker: Optional[dict]


# ---------------------------------------------------------------------------
# Paths and small pure helpers
# ---------------------------------------------------------------------------


def default_port_for_role(role: str) -> int:
    """Return the pinned real-rig control port for ``role`` (contract §3).

    The pair is disjoint from the headless mock rig's 39421/39422 (D13), so a stale mock
    process can never satisfy a real-rig readiness check. Unknown roles are a programming
    error, not a run outcome, so this raises :class:`ValueError` rather than a named abort.
    """
    try:
        return constants.REAL_CONTROL_PORTS[role]
    except KeyError:
        raise ValueError(
            f"unknown role {role!r}; expected one of {constants.ROLES!r}"
        ) from None


def _vault(vault_path: PathLike) -> Path:
    return Path(vault_path)


def _plugin_dir(vault: Path) -> Path:
    return vault / constants.PLUGIN_DIR_REL


def _settings_path(vault: Path) -> Path:
    return vault / constants.PLUGIN_DATA_REL


def _backup_path(vault: Path) -> Path:
    return vault / constants.SETTINGS_BACKUP_REL


def _marker_path(vault: Path) -> Path:
    return vault / constants.PROVISION_MARKER_REL


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _read_bytes_or_none(path: Path) -> Optional[bytes]:
    """Read a file as raw bytes, or ``None`` when it does not exist.

    Raw bytes only — the content is never decoded, parsed or logged here.
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
    across volumes, and is removed on every failure path.
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


# ---------------------------------------------------------------------------
# The modify path — a textual splice, never a re-serialisation
# ---------------------------------------------------------------------------
#
# The provisioned file must be valid JSON carrying the port, and everything the rig did not
# add must stay byte-identical. Both hold here because the port member is inserted into (or
# its value replaced inside) the original text: no token outside the spliced span is ever
# rewritten. Restore does not depend on any of this — it copies the backup verbatim — but a
# provisioned file that a human opens mid-run should still look like their file.


class _MalformedSettings(Exception):
    """Internal: the settings text is not a JSON object this module can splice."""


def _read_json_string(text: str, start: int) -> tuple[str, int]:
    """Return ``(raw_slice, index_after)`` for the JSON string starting at ``text[start]``."""
    index = start + 1
    length = len(text)
    while index < length:
        char = text[index]
        if char == "\\":
            index += 2
            continue
        if char == '"':
            return text[start : index + 1], index + 1
        index += 1
    raise _MalformedSettings("unterminated string")


def _skip_value(text: str, start: int) -> int:
    """Return the index just past the JSON value beginning at ``text[start]``."""
    char = text[start]
    if char == '"':
        _, end = _read_json_string(text, start)
        return end
    if char in "{[":
        depth = 0
        index = start
        length = len(text)
        while index < length:
            current = text[index]
            if current == '"':
                _, index = _read_json_string(text, index)
                continue
            if current in "{[":
                depth += 1
            elif current in "}]":
                depth -= 1
                if depth == 0:
                    return index + 1
            index += 1
        raise _MalformedSettings("unterminated container")
    index = start
    length = len(text)
    while index < length and text[index] not in ",}] \t\r\n":
        index += 1
    if index == start:
        raise _MalformedSettings("empty value")
    return index


def _top_level_members(text: str, open_index: int) -> tuple[list, int]:
    """Scan the root object, returning ``([(key, value_start, value_end)], close_index)``."""
    members = []
    index = open_index + 1
    length = len(text)
    while index < length:
        char = text[index]
        if char in _JSON_WS:
            index += 1
            continue
        if char == "}":
            return members, index
        if char == ",":
            index += 1
            continue
        if char != '"':
            raise _MalformedSettings("unexpected token in object")
        raw_key, index = _read_json_string(text, index)
        while index < length and text[index] in _JSON_WS:
            index += 1
        if index >= length or text[index] != ":":
            raise _MalformedSettings("missing ':' after key")
        index += 1
        while index < length and text[index] in _JSON_WS:
            index += 1
        if index >= length:
            raise _MalformedSettings("missing value")
        value_start = index
        value_end = _skip_value(text, value_start)
        try:
            key = json.loads(raw_key)
        except ValueError as err:
            raise _MalformedSettings("undecodable key") from err
        members.append((key, value_start, value_end))
        index = value_end
    raise _MalformedSettings("unterminated object")


def _with_port(original: Optional[bytes], members: Mapping[str, object]) -> bytes:
    """Return ``original`` with every member of ``members`` set to its given value.

    This is **the one generalisation WP70 makes to this module** (WP70 AC1): the splice
    that wrote a single member writes an ordered member set. Everything else about it is
    unchanged, and the single-member case reduces exactly — ``json.dumps(39431)`` is
    ``"39431"``, the same literal ``str(int(port))`` produced — so provisioning the port
    alone still emits byte-identical output to the pre-change implementation. That is a
    property to be *measured*, not asserted: the byte-identity test compares this against
    a frozen copy of the pre-change function rather than against this function itself.

    ``None`` (the owner had no settings file) yields a minimal fresh document. Otherwise
    each member is spliced in textually: an existing value is replaced in place, and every
    member the file does not already carry is inserted directly after the opening brace —
    in the caller's order, reusing whatever whitespace already follows the brace so the
    file keeps its own indentation and line endings. Every byte outside the spliced spans
    is carried over unchanged, which is what lets the owner's key order, CRLF endings,
    BOM, tabs, number formatting and unicode escaping survive ten members exactly as they
    survived one.

    Values are emitted with :func:`json.dumps`, so ``[]``, ``true``, ``false`` and strings
    all serialise correctly; no member is special-cased and no falsy member is skipped.
    """
    if not members:
        raise ValueError("the member set must not be empty")
    if original is None:
        return json.dumps(dict(members), indent=2).encode("utf-8") + b"\n"

    try:
        text = original.decode("utf-8")
    except UnicodeDecodeError as err:
        raise _MalformedSettings("settings file is not valid UTF-8") from err

    index = 0
    while index < len(text) and text[index] in _JSON_WS:
        index += 1
    if index >= len(text) or text[index] != "{":
        raise _MalformedSettings("settings file is not a JSON object")
    open_index = index

    present, _close_index = _top_level_members(text, open_index)
    spans: dict = {}
    for member_key, value_start, value_end in present:
        # First occurrence wins, exactly as the single-member splice's `break` did.
        spans.setdefault(member_key, (value_start, value_end))

    replacements = []
    insertions = []
    for key, value in members.items():
        literal = json.dumps(value)
        span = spans.get(key)
        if span is None:
            insertions.append((key, literal))
        else:
            replacements.append((span[0], span[1], literal))

    # Descending by position, so each edit leaves every not-yet-applied span's indices
    # valid. The insertion point sits before all of them and is therefore applied last.
    spliced = text
    for value_start, value_end, literal in sorted(replacements, reverse=True):
        spliced = spliced[:value_start] + literal + spliced[value_end:]

    if insertions:
        lead_start = open_index + 1
        lead_end = lead_start
        while lead_end < len(text) and text[lead_end] in _JSON_WS:
            lead_end += 1
        lead_ws = text[lead_start:lead_end]
        separator = ": " if lead_ws else ":"
        member = ",".join(
            f'{lead_ws}"{key}"{separator}{literal}' for key, literal in insertions
        )
        if present:
            member += ","
        spliced = spliced[:lead_start] + member + spliced[lead_start:]

    return spliced.encode("utf-8")


# ---------------------------------------------------------------------------
# Borrow state — reading and validating what an earlier run left behind (AC3)
# ---------------------------------------------------------------------------


def _load_marker(vault: Path) -> Optional[dict]:
    """Return the parsed marker, or ``None`` when there is none.

    An unreadable or structurally wrong marker is a conflict, not a missing marker: the
    difference between "no borrow in progress" and "a borrow whose record is damaged" is
    exactly the difference between proceeding and refusing.
    """
    raw = _read_bytes_or_none(_marker_path(vault))
    if raw is None:
        return None
    try:
        marker = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as err:
        raise ProvisionConflict(
            f"the provisioning marker at {_marker_path(vault)} is unreadable"
        ) from err
    if not isinstance(marker, dict):
        raise ProvisionConflict(
            f"the provisioning marker at {_marker_path(vault)} is not an object"
        )
    if set(marker) != set(constants.PROVISION_MARKER_FIELDS):
        raise ProvisionConflict(
            f"the provisioning marker at {_marker_path(vault)} does not carry the "
            f"pinned field set {constants.PROVISION_MARKER_FIELDS!r}"
        )
    if not isinstance(marker["hadOriginal"], bool):
        raise ProvisionConflict("the provisioning marker's 'hadOriginal' is not a boolean")
    sha = marker["originalSha256"]
    if marker["hadOriginal"]:
        if not isinstance(sha, str) or len(sha) != 64:
            raise ProvisionConflict(
                "the provisioning marker claims an original but carries no sha256 for it"
            )
    elif sha is not None:
        raise ProvisionConflict(
            "the provisioning marker claims there was no original yet carries a sha256"
        )
    return marker


def capture_state(vault_path: PathLike) -> BorrowState:
    """Validate and return the borrow state of ``vault_path`` without writing anything.

    This is the single decision point for AC3. Four shapes are legal:

    ├── no marker, no backup            ← nothing borrowed; the live file is the original
    ├── marker(hadOriginal=True) + backup hashing to the recorded sha256
    ├── marker(hadOriginal=False) + no backup
    └── (any of the above) whatever ``data.json`` currently holds — it is *never* consulted
        as the original once a marker exists

    Anything else is contradictory. Since the two halves are one statement about the
    owner's file, a disagreement means the original is unknown, and guessing there is how
    data gets destroyed — so it aborts as ``PROVISION_CONFLICT`` with nothing written.
    """
    vault = _vault(vault_path)
    marker = _load_marker(vault)
    backup = _read_bytes_or_none(_backup_path(vault))

    if marker is None:
        if backup is not None:
            raise ProvisionConflict(
                f"a saved original exists at {_backup_path(vault)} with no marker to say "
                "what it is; refusing to treat it as either an original or debris"
            )
        live = _read_bytes_or_none(_settings_path(vault))
        return BorrowState(
            has_marker=False,
            had_original=live is not None,
            original_sha256=_sha256(live) if live is not None else None,
            original_bytes=live,
            marker=None,
        )

    if marker["hadOriginal"]:
        if backup is None:
            raise ProvisionConflict(
                f"the marker records a saved original but {_backup_path(vault)} is gone; "
                "the owner's file can no longer be reconstructed"
            )
        actual = _sha256(backup)
        if actual != marker["originalSha256"]:
            raise ProvisionConflict(
                f"the saved original at {_backup_path(vault)} ({len(backup)} bytes, "
                f"sha256 {actual}) does not match the sha256 the marker recorded "
                f"({marker['originalSha256']})"
            )
        return BorrowState(
            has_marker=True,
            had_original=True,
            original_sha256=marker["originalSha256"],
            original_bytes=backup,
            marker=marker,
        )

    if backup is not None:
        raise ProvisionConflict(
            f"the marker records that no settings file existed, yet a saved original is "
            f"present at {_backup_path(vault)}"
        )
    return BorrowState(
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
    port: int,
    had_original: bool,
    original_sha256: Optional[str],
    pid: int,
    created_at: str,
) -> bytes:
    """Serialise the marker with exactly the pinned field set (contract §4).

    It carries a fingerprint of the original and never the original itself (S4).
    """
    marker = {
        "runId": run_id,
        "role": role,
        "port": port,
        "hadOriginal": had_original,
        "originalSha256": original_sha256,
        "pid": pid,
        "createdAt": created_at,
    }
    assert set(marker) == set(constants.PROVISION_MARKER_FIELDS)
    return json.dumps(marker, indent=2).encode("utf-8") + b"\n"


# ---------------------------------------------------------------------------
# Provision (AC1, AC3)
# ---------------------------------------------------------------------------


def provision_port(
    vault_path: PathLike,
    role: str,
    port: Optional[int] = None,
    *,
    run_id: Optional[str] = None,
    members: Optional[Mapping[str, object]] = None,
) -> ProvisionRecord:
    """Provision ``role``'s control port into ``vault_path``'s plugin settings file.

    **D14 — why this writes a per-vault settings file and not an environment variable.**
    Obsidian is single-instance: opening the second vault adds a window to the *same
    Obsidian process*, so both roles would see one and the same ``process.env`` value and
    one control server would win the bind, leaving the rig driving a single vault while it
    believes it is driving two. ``data.json`` sits inside the vault, so it is the only
    channel that can differ between role a and role b. Nothing in this module reads or
    writes the process environment.

    Before writing, the prior file is captured **byte-exactly** into
    ``data.json.e2e-original`` and fingerprinted in the marker (AC2). The capture happens
    once per borrow: on a second call — including one after a crashed run — the existing
    backup is adopted as the original and never overwritten by the already-provisioned
    state (AC3). A contradictory leftover state raises
    :class:`ProvisionConflict` and writes nothing.

    ``port`` defaults to the pinned port for ``role``. Passing the vault explicitly is the
    only way to name a target: this function has no default vault.

    **``members`` is WP70's one added argument** (WP70 AC1). It is an *ordered* mapping of
    settings key → value, and it generalises what this one borrow writes from a single
    member to a member set. It changes nothing else: the same capture, the same backup
    namespace, the same marker with the same pinned field set, and the same restore path,
    which does not consult it at all. Omitting it provisions exactly the control port and
    produces byte-identical output to the pre-change implementation. There is still
    **one** borrow per vault per run; a caller that finds itself wanting a second capture,
    a second backup file or a ``data.json`` write from outside this module has found a
    design error, not a missing feature.
    """
    vault = _vault(vault_path)
    resolved_port = default_port_for_role(role) if port is None else int(port)
    if port is not None and role not in constants.REAL_CONTROL_PORTS:
        raise ValueError(f"unknown role {role!r}; expected one of {constants.ROLES!r}")
    if resolved_port <= 0:
        raise ValueError(f"control port must be a positive integer, got {resolved_port!r}")

    if members is None:
        resolved_members: Mapping[str, object] = {constants.SETTINGS_PORT_KEY: resolved_port}
    else:
        resolved_members = dict(members)
        if not resolved_members:
            raise ValueError("members must name at least one settings key")

    plugin_dir = _plugin_dir(vault)
    if not plugin_dir.is_dir():
        raise PluginNotInstalled(
            f"no plugin directory at {plugin_dir}; the rig does not create one inside a vault"
        )

    # Validate everything first: a refusal must leave the vault byte-for-byte as it was.
    state = capture_state(vault)

    settings_path = _settings_path(vault)
    backup_path = _backup_path(vault)
    marker_path = _marker_path(vault)

    try:
        provisioned = _with_port(state.original_bytes, resolved_members)
    except _MalformedSettings as err:
        # No content in the message: only the path and the structural complaint (S4).
        raise ProvisionConflict(
            f"the settings file at {settings_path} cannot carry the control-port setting "
            f"({err})"
        ) from err

    adopted = state.has_marker
    identity = run_id or constants.new_run_id()
    created_at = datetime.now(timezone.utc).isoformat()
    pid = os.getpid()

    # Order matters: the original is durably saved before the live file is touched, so a
    # crash between the two leaves a recoverable vault rather than an unrecoverable one.
    if state.had_original and not backup_path.exists():
        _atomic_write_bytes(backup_path, state.original_bytes or b"")

    _atomic_write_bytes(
        marker_path,
        _marker_blob(
            run_id=identity,
            role=role,
            port=resolved_port,
            had_original=state.had_original,
            original_sha256=state.original_sha256,
            pid=pid,
            created_at=created_at,
        ),
    )

    _atomic_write_bytes(settings_path, provisioned)

    return ProvisionRecord(
        role=role,
        port=resolved_port,
        vault_path=str(vault),
        settings_path=str(settings_path),
        backup_path=str(backup_path),
        marker_path=str(marker_path),
        had_original=state.had_original,
        original_sha256=state.original_sha256,
        original_size=len(state.original_bytes) if state.original_bytes is not None else None,
        run_id=identity,
        pid=pid,
        created_at=created_at,
        adopted_existing_backup=adopted,
    )


# ---------------------------------------------------------------------------
# Restore (AC2)
# ---------------------------------------------------------------------------


def restore_port(vault_path: PathLike) -> RestoreResult:
    """Return ``vault_path``'s plugin settings to exactly their pre-borrow state.

    The restore path is independent of the modify path: it writes back the bytes captured in
    ``data.json.e2e-original`` verbatim — no parse, no re-serialise, no normalisation — and
    then verifies the result by **sha256 and exact byte length** against the fingerprint the
    marker recorded. A verification failure raises :class:`SettingsRestoreMismatch` and
    leaves the backup and marker in place, because a file nobody can reconstruct any more is
    strictly worse than a loud refusal.

    When the owner had **no** settings file, teardown removes the rig's file entirely; it
    does not leave an empty file or ``{}`` behind.

    Calling this with nothing borrowed is a safe no-op (``restored=False``, ``reason=None``),
    so it is correct to call it unconditionally from a ``finally``.
    """
    vault = _vault(vault_path)
    settings_path = _settings_path(vault)
    backup_path = _backup_path(vault)
    marker_path = _marker_path(vault)

    marker = _load_marker(vault)
    backup = _read_bytes_or_none(backup_path)

    if marker is None:
        if backup is not None:
            raise ProvisionConflict(
                f"a saved original exists at {backup_path} with no marker to say what it "
                "is; refusing to restore from an unattributed file"
            )
        return RestoreResult(
            restored=False,
            had_original=False,
            settings_file_present=settings_path.is_file(),
            vault_path=str(vault),
            settings_path=str(settings_path),
            reason=None,
        )

    had_original = bool(marker["hadOriginal"])

    if had_original:
        if backup is None:
            raise ProvisionConflict(
                f"the marker records a saved original but {backup_path} is gone; the "
                "owner's file can no longer be reconstructed"
            )
        expected_sha = marker["originalSha256"]
        actual_sha = _sha256(backup)
        if actual_sha != expected_sha:
            # Verified BEFORE anything is written: the settings file is left untouched and
            # the evidence (backup + marker) stays for a human. No content in the message.
            raise SettingsRestoreMismatch(
                f"the saved original at {backup_path} ({len(backup)} bytes, sha256 "
                f"{actual_sha}) does not match the captured sha256 {expected_sha}; "
                "the settings file was left untouched"
            )

        _atomic_write_bytes(settings_path, backup)

        written = _read_bytes_or_none(settings_path)
        if written is None or len(written) != len(backup) or _sha256(written) != expected_sha:
            raise SettingsRestoreMismatch(
                f"after writing {settings_path} the file does not reproduce the captured "
                f"original (expected {len(backup)} bytes / sha256 {expected_sha}, found "
                f"{'no file' if written is None else f'{len(written)} bytes / sha256 {_sha256(written)}'})"
            )

        _remove_if_present(backup_path)
        _remove_if_present(marker_path)
        return RestoreResult(
            restored=True,
            had_original=True,
            settings_file_present=True,
            vault_path=str(vault),
            settings_path=str(settings_path),
            reason=None,
            restored_sha256=expected_sha,
            restored_size=len(backup),
        )

    if backup is not None:
        raise ProvisionConflict(
            f"the marker records that no settings file existed, yet a saved original is "
            f"present at {backup_path}"
        )

    # There was no file before the run, so "byte-exact" means: no file after it either.
    _remove_if_present(settings_path)
    if settings_path.exists():
        raise SettingsRestoreMismatch(
            f"{settings_path} still exists after teardown; the vault must look untouched"
        )
    _remove_if_present(marker_path)
    return RestoreResult(
        restored=True,
        had_original=False,
        settings_file_present=False,
        vault_path=str(vault),
        settings_path=str(settings_path),
        reason=None,
    )


def _remove_if_present(path: Path) -> None:
    try:
        os.remove(path)
    except FileNotFoundError:
        pass


# ---------------------------------------------------------------------------
# Every exit path — including crash and interruption (AC2)
# ---------------------------------------------------------------------------


class _BorrowGuard:
    """Restores a borrowed settings file on interpreter exit if teardown never ran.

    A ``finally`` covers a raised exception; it does not cover ``SystemExit`` from a signal
    handler or an ``os._exit``-shaped end. The guard is a second, cheap net: it is
    registered while the borrow is live and unregistered the moment teardown succeeds.
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
            restore_port(self._vault)
        except Exception:
            # An exit-time hook cannot usefully raise, and it must not print settings
            # content. The backup and marker survive, so the next run recovers.
            pass


def provisioned_port(
    vault_path: PathLike,
    role: str,
    port: Optional[int] = None,
    *,
    run_id: Optional[str] = None,
    members: Optional[Mapping[str, object]] = None,
):
    """Context manager: provision on entry, restore on **every** exit path.

    Yields the :class:`ProvisionRecord`. Teardown runs on normal exit, on an exception and
    — via an ``atexit`` guard — on an interpreter shutdown that skips the ``finally``.

    ``members`` is WP70's added argument, threaded straight through to
    :func:`provision_port`; the restore path is unaffected by it.
    """
    return _ProvisionedPort(vault_path, role, port, run_id=run_id, members=members)


class _ProvisionedPort:
    def __init__(
        self,
        vault_path: PathLike,
        role: str,
        port: Optional[int],
        *,
        run_id: Optional[str],
        members: Optional[Mapping[str, object]] = None,
    ) -> None:
        self._vault = _vault(vault_path)
        self._role = role
        self._port = port
        self._run_id = run_id
        self._members = members
        self._guard: Optional[_BorrowGuard] = None

    def __enter__(self) -> ProvisionRecord:
        import atexit

        record = provision_port(
            self._vault,
            self._role,
            self._port,
            run_id=self._run_id,
            members=self._members,
        )
        self._guard = _BorrowGuard(self._vault)
        atexit.register(self._guard)
        return record

    def __exit__(self, exc_type, exc, tb) -> bool:
        try:
            restore_port(self._vault)
        finally:
            if self._guard is not None:
                self._guard.release()
        return False


# ---------------------------------------------------------------------------
# The pair — the shape the rig actually uses (charter §3 interfaces)
# ---------------------------------------------------------------------------


def provision_pair(
    vault_paths: Mapping[str, PathLike],
    ports: Optional[Mapping[str, int]] = None,
    *,
    run_id: Optional[str] = None,
    members: Optional[Mapping[str, Mapping[str, object]]] = None,
) -> dict:
    """Provision both roles, and roll back cleanly if the second one fails.

    ``vault_paths`` maps role → vault path (both roles required). ``ports`` overrides the
    pinned pair per role. A partial provisioning is never left behind: if role b aborts,
    role a is restored before the abort propagates.

    ``members`` is WP70's added argument in its pair form — role → member set, since the
    two roles are provisioned with *different* values (one host, one guest) out of the
    *same* room. It is threaded through unchanged; the restore path ignores it.
    """
    missing = [role for role in constants.ROLES if role not in vault_paths]
    if missing:
        raise ValueError(f"vault_paths is missing role(s) {missing!r}")

    identity = run_id or constants.new_run_id()
    records: dict = {}
    try:
        for role in constants.ROLES:
            port = None if ports is None else ports.get(role)
            role_members = None if members is None else members.get(role)
            records[role] = provision_port(
                vault_paths[role], role, port, run_id=identity, members=role_members
            )
    except BaseException:
        for role in reversed(list(records)):
            try:
                restore_port(vault_paths[role])
            except Exception:
                pass
        raise
    return records


def restore_pair(vault_paths: Mapping[str, PathLike]) -> dict:
    """Restore every role's vault, attempting all of them before re-raising.

    One vault refusing teardown must not leave the other borrowed.
    """
    results: dict = {}
    first_error: Optional[BaseException] = None
    for role, path in vault_paths.items():
        try:
            results[role] = restore_port(path)
        except BaseException as err:  # noqa: PERF203 - every vault must be attempted
            if first_error is None:
                first_error = err
    if first_error is not None:
        raise first_error
    return results
