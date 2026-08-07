"""WP70 — preparing a vault for the gate, reversibly: settings, surface, order, borrow.

Three jobs live here, and they are one job seen from three sides — *make the run's
environment what the gate needs, and be able to put it back*:

├── the **gate settings**, provisioned through WP44's single existing ``data.json``
│   borrow (:func:`provision_gate_settings`) — one borrow per vault per run, reached
│   through the one keyword argument WP70 added to :func:`obsidian_e2e.ports.provision_port`
├── the **shared surface**, narrowed to the rig-owned scratch folder and *stated* rather
│   than trusted (:func:`verify_shared_surface`, :func:`shared_surface_record`)
├── the **ordering**, enforced at the boundary that owns it (:class:`GateSequence`)
└── the ``obsidian-git`` **precondition borrow** over ``community-plugins.json``
    (:func:`disable_community_plugins` and friends)

Why this is a module of its own, and not part of either neighbour
-----------------------------------------------------------------
It must **not** live in ``ports.py``, whose whole invariant is *one borrow over one
file*: ``community-plugins.json`` is a different file and a different borrow, and putting
a second borrow inside the module that owns the first is precisely the shape AC1 exists
to forbid. It must **not** live in ``relay.py``, which owns a process lifecycle and
nothing else.

The shared surface is a safety criterion, not plumbing
-------------------------------------------------------
``isSharedPath`` treats an **empty** ``sharedFolder`` as *the whole vault is shared*;
``resumeSession`` publishes the host's manifest with ``purge: true``; and the guest's
``cleanupStaleFiles`` **trashes every shared local file absent from that manifest**. Both
vaults are the owner's live working vaults, they were never asserted to be identical, and
their stored settings had never been read by anyone. So a run against an unconstrained
shared surface can destroy the owner's files in the second vault, and that is why
:func:`verify_shared_surface` **refuses** a member set that would leave the surface empty,
degenerate or excludable — before a byte is written, not after. ``excludePatterns`` is
provisioned empty for the mirror-image reason: an owner-side pattern could exclude the
scratch folder from a surface that now contains only it, leaving a shared surface
containing nothing and every matrix case converging trivially.

The rig **establishes** the state and records what it established. It never infers it
from a successful sync, and the independent detector (C50 AC5) must be satisfiable only
by the running instances' own view of what they share — never by a read-back of the file
this module wrote.

Credentials (S4, absolute)
--------------------------
``data.json`` holds live credentials. ``encryptionPassphrase``, ``encryptionSalt``,
``jwt`` and ``serverPassword`` are neither read nor written — they are disjoint from the
provisioned key set by construction in ``constants.py``, which is what makes that
statement enforceable rather than aspirational. No byte of the file and no value read
from it is ever printed, logged, returned in a record field, put in an error message or
written to a marker; comparison is sha256-of-bytes only. The minted room token is a
credential too: it reaches the provisioned file and never a record, a marker or a log.

⚠ This module contains no ``subprocess``, no ``Popen``, no ``os.system`` and no
``os.exec*``. Nothing here starts a process; the control-port probe is an injected seam
whose default opens one socket and closes it.

Failure reasons come from :mod:`obsidian_e2e.constants` (contract §7). The refusal for
provisioning a vault whose plugin is already loaded **reuses** WP45's existing
``RESTART_REQUIRED_OPERATOR``; no new reason is invented for it.
"""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterable, Mapping, Optional, Sequence, Union

from . import constants, ports, relay
from .constants import Secret
from .ports import ProvisionError, _atomic_write_bytes, _read_bytes_or_none, _remove_if_present
from .relay import GateOrderViolation, RelayRoom

__all__ = [
    "GateSequence",
    "GateProvisionRecord",
    "CommunityPluginsRecord",
    "CommunityRestoreResult",
    "TeardownReport",
    "provision_gate_settings",
    "restore_gate_settings",
    "gate_settings_members",
    "shared_surface_record",
    "verify_shared_surface",
    "verify_member_types",
    "disable_community_plugins",
    "restore_community_plugins",
    "borrowed_community_plugins",
    "run_teardown",
    "GateOrderViolation",
    "RestartRequiredOperator",
    "SharedSurfaceNotEstablished",
    "CommunityConfigMissing",
    "CommunityPluginsConflict",
    "CommunityPluginsRestoreMismatch",
]

PathLike = Union[str, "os.PathLike[str]"]

#: Values a ``sharedFolder`` may never take. Each of them is either "the whole vault" or
#: "unbounded" in ``isSharedPath`` terms, and none of them is the rig-owned scratch
#: folder — so all of them re-open the blast radius AC2 exists to close.
_DEGENERATE_SHARED_FOLDERS = ("", "/", ".", "./", "**", "*")


# ---------------------------------------------------------------------------
# Errors — every abort names exactly one reason from constants.py (contract §7)
# ---------------------------------------------------------------------------


class RestartRequiredOperator(ProvisionError):
    """The target vault's plugin is already loaded, so the rig refuses to provision it.

    Not a warning after the write: *rather than performed*. The settings are read once at
    load, so a late write is not read — and worse, any later ``saveSettings()`` in that
    live instance writes its in-memory copy back over the rig's file, silently reverting
    the provisioning and corrupting the borrow the restore depends on. A write followed by
    a complaint has already put the owner's file at risk.

    The reason is WP45's existing one. No new reason is invented for this state.
    """

    reason = constants.RESTART_REQUIRED_OPERATOR


class SharedSurfaceNotEstablished(ProvisionError):
    """The shared surface would not be the rig-owned scratch folder, and only it (AC2)."""

    reason = constants.SHARED_SURFACE_NOT_ESTABLISHED


class CommunityPluginsConflict(ProvisionError):
    """A leftover ``community-plugins.json`` borrow whose two halves disagree.

    The backup and the marker are two halves of **one** statement about what the owner
    had. When they disagree the original is unknown, and guessing there is how data gets
    destroyed — so this refuses with nothing written. A *consistent* leftover from a
    crashed run is adopted instead, which is what the marker exists for.
    """

    reason = constants.COMMUNITY_PLUGINS_CONFLICT


class CommunityConfigMissing(ProvisionError):
    """The vault has no ``.obsidian/`` configuration directory, so no borrow can be recorded.

    The rig does not create a configuration directory inside a vault — that would be a
    write the owner did not have before the run, and a path with no ``.obsidian`` is not
    an Obsidian vault in the first place. Named rather than left to a bare
    ``FileNotFoundError`` from the first write: an abort that does not name itself cannot
    be told apart from a bug, and this one is a statement about the target.
    """

    reason = constants.VAULT_PATH_MISSING


class CommunityPluginsRestoreMismatch(ProvisionError):
    """A restore of the enabled-plugin list that would not be, or was not, byte-exact.

    Same oracle and same reasoning as WP44's settings restore and WP69's bundle restore:
    a file nobody can reconstruct any more is strictly worse than a loud refusal, so the
    backup and the marker are left in place for a human.
    """

    reason = constants.COMMUNITY_PLUGINS_RESTORE_MISMATCH


# ---------------------------------------------------------------------------
# Records — fingerprints and structure only, never file content (S4)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class GateProvisionRecord:
    """What one vault's gate provisioning established.

    Note what is absent: the room **token**, and any value read out of ``data.json``. The
    record states what the rig *established* — which is exactly what AC2 asks it to state
    positively — and carries no credential and no owner value.
    """

    role: str
    vault_path: str
    settings_path: str
    run_id: str
    control_port: int
    room_id: str
    server_url: str
    session_role: str
    permission: str
    shared_folder: str
    exclude_patterns: tuple
    auto_reconnect: bool
    debug_logging: bool
    provisioned_keys: tuple
    provision: ports.ProvisionRecord


@dataclass(frozen=True)
class CommunityPluginsRecord:
    """What one vault's ``obsidian-git`` disable actually did."""

    role: str
    vault_path: str
    community_path: str
    backup_path: str
    marker_path: str
    had_original: bool
    original_sha256: Optional[str]
    original_size: Optional[int]
    disabled: tuple
    enabled_after: tuple
    run_id: str
    pid: int
    created_at: str
    adopted_existing_backup: bool


@dataclass(frozen=True)
class CommunityRestoreResult:
    """What the ``community-plugins.json`` teardown did.

    ``restored`` is ``False`` only for the safe no-op — there was nothing borrowed. A
    restore that *should* have happened and could not be made byte-exact raises.
    """

    restored: bool
    had_original: bool
    vault_path: str
    community_path: str
    file_present: bool
    reason: Optional[str] = None
    restored_sha256: Optional[str] = None
    restored_size: Optional[int] = None


@dataclass(frozen=True)
class TeardownReport:
    """Which teardown actions were attempted, which failed, and under what reason."""

    attempted: tuple
    succeeded: tuple
    failed: tuple
    reasons: dict
    complete: bool


# ---------------------------------------------------------------------------
# The provisioned member set (AC1) and the shared surface (AC2)
# ---------------------------------------------------------------------------


def gate_settings_members(role: str, room: RelayRoom) -> dict:
    """Return the ordered member set the gate provisions into one vault.

    Exactly :data:`~obsidian_e2e.constants.PROVISIONED_SETTINGS_KEYS`, in that order,
    every one an existing member of ``LiveShareSettings`` and no key invented. The values
    come from the pinned constants and from the room the rig minted on **its own** relay;
    nothing is re-spelled here, so a later rename of the scratch folder cannot silently
    produce a shared surface that does not contain the scratch canvas.

    ``debugLogging`` is ``False`` on purpose and is written as the JSON literal rather
    than skipped as falsy: a debug log written inside the vault is a vault write the
    fingerprint would report as a mismatch.

    The result is a :class:`~obsidian_e2e.relay.RedactedMapping`, not a plain ``dict``. It
    carries the minted room token — a live credential — and a member set is exactly the
    kind of thing a caller prints while debugging a provisioning. Subscripting still
    returns the real value; only the rendering is closed.
    """
    if role not in constants.SETTINGS_ROLES:
        raise ValueError(f"unknown role {role!r}; expected one of {constants.ROLES!r}")
    if room is None:
        raise GateOrderViolation(
            "the gate's settings cannot be built without a room minted on the run's relay"
        )
    members = relay.RedactedMapping(
        {
            "e2eControlPort": constants.REAL_CONTROL_PORTS[role],
            "serverUrl": room.base_url,
            "roomId": room.id,
            # The one legitimate reveal in this module, and it is spelled out so it is
            # greppable: the token has to reach the file the plugin reads at load.
            constants.SETTINGS_TOKEN_KEY: room.reveal_token(),
            "role": constants.SETTINGS_ROLES[role],
            "permission": constants.SETTINGS_PERMISSION,
            "sharedFolder": constants.SETTINGS_SHARED_FOLDER,
            "excludePatterns": list(constants.SETTINGS_EXCLUDE_PATTERNS),
            "autoReconnect": constants.SETTINGS_AUTO_RECONNECT,
            "debugLogging": constants.SETTINGS_DEBUG_LOGGING,
        }
    )
    assert tuple(members) == constants.PROVISIONED_SETTINGS_KEYS
    return members


def verify_shared_surface(members: Mapping[str, object]) -> None:
    """Return ``None`` when ``members`` narrows the surface correctly; refuse otherwise.

    This is the falsification gate for AC2, and it runs **before** anything is written.
    Nothing about the two vaults' stored values is assumed — not that they agree, not
    that they are empty, not that they are equal to each other. The only accepted state
    is the rig-owned scratch folder with an empty pattern list. No offending value is
    echoed in the refusal (S4).
    """
    if "sharedFolder" not in members:
        raise SharedSurfaceNotEstablished(
            "the member set names no 'sharedFolder'; an unprovisioned shared folder is "
            "the shipped default, and the shipped default means the whole vault"
        )
    shared = members["sharedFolder"]
    if not isinstance(shared, str) or shared.strip() in _DEGENERATE_SHARED_FOLDERS:
        raise SharedSurfaceNotEstablished(
            "the shared folder would be empty, degenerate or unbounded; the guest trashes "
            "every shared local file absent from the host's manifest, so an unconstrained "
            "surface can destroy the owner's files in the second vault"
        )
    if shared != constants.SETTINGS_SHARED_FOLDER:
        raise SharedSurfaceNotEstablished(
            "the shared folder is not the rig-owned scratch folder; the run's scratch "
            "canvas would be outside the shared surface and every matrix case would "
            "converge trivially"
        )
    if "excludePatterns" not in members:
        raise SharedSurfaceNotEstablished(
            "the member set names no 'excludePatterns'; an owner-side pattern left in "
            "place can exclude the scratch folder from a surface that now contains only it"
        )
    patterns = members["excludePatterns"]
    if not isinstance(patterns, (list, tuple)) or len(patterns) != 0:
        raise SharedSurfaceNotEstablished(
            "the exclude patterns are not empty; a surface that contains only the scratch "
            "folder and then excludes it is a shared surface containing nothing"
        )
    return None


#: The declared type of each provisioned member. A settings member is read by the plugin
#: as this type, so a value that merely *behaves* like it under `bool()` or `str()` is a
#: different setting wearing the right name — and a record built by coercing it states
#: something the file does not say. Validated before anything is written.
_MEMBER_TYPES = {
    "e2eControlPort": "port",
    "serverUrl": "text",
    "roomId": "text",
    constants.SETTINGS_TOKEN_KEY: "text",
    "role": "text",
    "permission": "text",
    "sharedFolder": "text",
    "excludePatterns": "list",
    "autoReconnect": "flag",
    "debugLogging": "flag",
}


def verify_member_types(members: Mapping[str, object]) -> None:
    """Refuse a member set whose values are not the types the plugin will read.

    **Validate the type, never the truthiness.** ``1`` is not ``True``, ``0`` is not
    ``False``, and ``""`` is not "a room id that happens to be short". Each of those
    passes a truthiness test and then means something different to the code that reads
    the file — and, worse, a record built with ``bool(value)`` would report the setting
    the rig *meant* rather than the one it wrote, which is the failure mode a record
    exists to make impossible.

    Raises :class:`ValueError`: a member set that does not typecheck is a programming
    error at the call site, not a state of the run — the same distinction
    :func:`obsidian_e2e.ports.default_port_for_role` already draws for an unknown role.
    No value is echoed in the message (S4).
    """
    missing = [key for key in constants.PROVISIONED_SETTINGS_KEYS if key not in members]
    if missing:
        raise ValueError(f"the gate member set is missing the pinned key(s) {missing!r}")
    for key, kind in _MEMBER_TYPES.items():
        value = members[key]
        if kind == "flag" and not isinstance(value, bool):
            raise ValueError(f"the {key!r} member must be a boolean, not a truthy stand-in")
        if kind == "text" and (not isinstance(value, str) or not value):
            raise ValueError(f"the {key!r} member must be a non-empty string")
        if kind == "port" and (
            not isinstance(value, int) or isinstance(value, bool) or value <= 0
        ):
            raise ValueError(f"the {key!r} member must be a positive integer")
        if kind == "list" and (
            not isinstance(value, (list, tuple))
            or not all(isinstance(entry, str) for entry in value)
        ):
            raise ValueError(f"the {key!r} member must be a list of strings")


def shared_surface_record(records: Iterable[GateProvisionRecord]) -> dict:
    """State positively, for **both** vaults, which folder the run shares.

    AC2 asks the rig to say what it established rather than to infer it from a successful
    sync, so a record covering one vault, or one whose two vaults disagree, is a refusal
    rather than a partial record. The result is JSON-serialisable — a run record that
    cannot be written is not a run record — and carries no room token and no owner value.
    """
    entries = list(records)
    roles = [entry.role for entry in entries]
    if len(entries) != len(constants.ROLES) or sorted(roles) != sorted(constants.ROLES):
        raise SharedSurfaceNotEstablished(
            f"the shared surface is a statement about both vaults; got role(s) "
            f"{sorted(roles)!r} instead of {sorted(constants.ROLES)!r}"
        )
    folders = {entry.shared_folder for entry in entries}
    if folders != {constants.SETTINGS_SHARED_FOLDER}:
        raise SharedSurfaceNotEstablished(
            "the two vaults do not share the same folder; two peers pointed at different "
            "surfaces cannot meet, and a run that proceeds anyway proves nothing"
        )
    if any(tuple(entry.exclude_patterns) != () for entry in entries):
        raise SharedSurfaceNotEstablished(
            "a vault carries a non-empty exclude pattern list over the shared surface"
        )
    # The pinned role order, not the order the caller happened to build the list in. A
    # record is read by a human comparing two runs, and a list whose order comes from an
    # accident of call sequence compares differently for reasons that are not about the
    # run. Ordering by `constants.ROLES` makes two records of the same state identical.
    ordered = sorted(entries, key=lambda entry: constants.ROLES.index(entry.role))
    return {
        "established": True,
        "sharedFolder": constants.SETTINGS_SHARED_FOLDER,
        "excludePatterns": [],
        "vaults": [
            {
                "role": entry.role,
                "vaultPath": entry.vault_path,
                "sharedFolder": entry.shared_folder,
                "excludePatterns": list(entry.exclude_patterns),
            }
            for entry in ordered
        ],
    }


# ---------------------------------------------------------------------------
# The gate settings borrow (AC1, AC4)
# ---------------------------------------------------------------------------


def _default_control_probe(port: int) -> bool:
    """Return ``True`` when something answers on ``port`` — i.e. the plugin is loaded.

    Injected everywhere it matters, so no test ever opens this socket and no test can
    reach a real Obsidian instance through it.
    """
    return relay.probe_port(constants.CONTROL_HOST, port, constants.RELAY_STOPPED_CONNECT_TIMEOUT_S)


def provision_gate_settings(
    vault_path: PathLike,
    role: str,
    *,
    room: Optional[RelayRoom],
    run_id: Optional[str] = None,
    members: Optional[Mapping[str, object]] = None,
    control_probe: Optional[Callable[[int], bool]] = None,
) -> GateProvisionRecord:
    """Provision one vault's gate settings through WP44's single existing borrow.

    Every check that can refuse runs **before** a byte is written, in the order the
    pinned table names:

    ├── no minted room ─────────────── ``GATE_ORDER_VIOLATION``
    ├── the surface would not be the rig's folder ── ``SHARED_SURFACE_NOT_ESTABLISHED``
    ├── that vault's control port answers ───────── ``RESTART_REQUIRED_OPERATOR``
    └── the borrow cannot be established ───────── ``PROVISION_CONFLICT`` / ``PLUGIN_MISSING``

    A run that cannot establish its borrow provisions nothing — not a settings file, not
    a backup, not a marker, not a temporary file.
    """
    vault = Path(vault_path)
    if role not in constants.REAL_CONTROL_PORTS:
        raise ValueError(f"unknown role {role!r}; expected one of {constants.ROLES!r}")

    if room is None:
        raise GateOrderViolation(
            f"vault {vault.name!r} was provisioned before a room was minted; the pinned "
            "order is relay healthy -> room minted -> settings provisioned, and a vault "
            "provisioned with no room is a peer pointed at nowhere"
        )

    # A caller-supplied member set is re-wrapped rather than copied into a plain dict:
    # redaction is a property of *what the mapping holds*, not of where it came from.
    resolved = (
        relay.RedactedMapping(members)
        if members is not None
        else gate_settings_members(role, room)
    )
    verify_shared_surface(resolved)
    verify_member_types(resolved)

    probe = control_probe if control_probe is not None else _default_control_probe
    control_port = constants.REAL_CONTROL_PORTS[role]
    if probe(control_port):
        raise RestartRequiredOperator(
            f"the plugin in vault {vault.name!r} is already loaded — its control port "
            f"{control_port} answers. The settings are read once at load, so this "
            "provisioning would not be read, and the instance's next save would write "
            "its in-memory copy back over the rig's file and corrupt the borrow. Close "
            "that vault's window and re-run; the rig does not restart it."
        )

    record = ports.provision_port(vault, role, run_id=run_id, members=resolved)

    return GateProvisionRecord(
        role=role,
        vault_path=str(vault),
        settings_path=record.settings_path,
        run_id=record.run_id,
        control_port=control_port,
        room_id=room.id,
        # Reported as written, never coerced: `verify_member_types` has already
        # established each of these is the type it claims to be, so a `str()`/`bool()`
        # here could only ever turn a value the record disagrees with into one it agrees
        # with — which is precisely the disagreement the record exists to surface.
        server_url=resolved["serverUrl"],
        session_role=resolved["role"],
        permission=resolved["permission"],
        shared_folder=resolved["sharedFolder"],
        exclude_patterns=tuple(resolved["excludePatterns"]),
        auto_reconnect=resolved["autoReconnect"],
        debug_logging=resolved["debugLogging"],
        provisioned_keys=tuple(resolved),
        provision=record,
    )


def restore_gate_settings(vault_path: PathLike) -> ports.RestoreResult:
    """Return the vault's settings to exactly their pre-borrow state.

    This is WP44's restore path, called and **not** re-implemented: WP70 added members to
    the modify path and nothing at all to this one. It copies the captured bytes back
    verbatim and verifies by sha256 and exact byte length, so a restore that is byte-exact
    for one provisioned key and not for ten would be a broken restore rather than a bigger
    diff. Calling it with nothing borrowed is a safe no-op, so it is correct to call it
    unconditionally from a ``finally``.
    """
    return ports.restore_port(vault_path)


# ---------------------------------------------------------------------------
# The obsidian-git precondition borrow
# ---------------------------------------------------------------------------


def _community_path(vault: Path) -> Path:
    return vault / constants.COMMUNITY_PLUGINS_REL


def _community_backup_path(vault: Path) -> Path:
    return vault / constants.COMMUNITY_PLUGINS_BACKUP_REL


def _community_marker_path(vault: Path) -> Path:
    return vault / constants.COMMUNITY_PLUGINS_MARKER_REL


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


#: The length of a sha256 hex digest. Spelled once; a shape check that hard-codes it in
#: three places is three places for it to drift.
_DIGEST_LENGTH = len(hashlib.sha256(b"").hexdigest())


def _is_int(value: object) -> bool:
    """``True`` for a genuine integer. ``bool`` is excluded: it is not a size or a pid."""
    return isinstance(value, int) and not isinstance(value, bool)


def _is_digest(value: object) -> bool:
    """``True`` for something **shaped** like a sha256 hex digest.

    Shape only — the right number of hex characters. Whether they are the *right*
    characters is a **content** question, answered against the file the digest claims to
    describe. Keeping the two apart is what keeps ``COMMUNITY_PLUGINS_CONFLICT`` (a
    damaged record) distinguishable from ``COMMUNITY_PLUGINS_RESTORE_MISMATCH`` (an
    intact record that the file contradicts) — the same discriminator ``ports.py`` and
    ``install.py`` use, and losing it would collapse two different human responses into
    one.
    """
    if not isinstance(value, str) or len(value) != _DIGEST_LENGTH:
        return False
    return all(character in "0123456789abcdefABCDEF" for character in value)


def _is_id_list(value: object) -> bool:
    """``True`` for a list of distinct non-empty plugin ids — the shape the rig writes."""
    if not isinstance(value, list) or not value:
        return False
    if not all(isinstance(entry, str) and entry for entry in value):
        return False
    return len(set(value)) == len(value)


def _load_community_marker(vault: Path) -> Optional[dict]:
    """Return the parsed borrow marker, or ``None`` when there is none.

    An unreadable or structurally wrong marker is a **conflict**, never a missing marker:
    "no borrow in progress" and "a borrow whose record is damaged" are exactly the
    difference between proceeding and refusing.

    **Every** field of the pinned set is validated, not the two a happy path happens to
    read back. A record is one statement about what the owner had, and a half-checked
    statement is not a weaker guarantee — it is a false one: the unchecked fields are
    trusted precisely because nothing looked at them, and a marker that was truncated,
    hand-edited, half-written or produced by something other than this module is then
    indistinguishable from a correct one until the restore it authorises destroys the
    owner's list. So a field that cannot be what this module writes is a refusal,
    whichever field it is:

    ├── ``runId`` · ``role`` · ``createdAt`` ← non-empty strings; ``role`` is a real role
    ├── ``pid``                              ← a non-negative integer, never a ``bool``
    ├── ``hadOriginal``                      ← a boolean, never a truthy stand-in
    ├── ``disabled``                         ← a list of distinct non-empty ids
    └── ``originalSha256`` / ``originalSize`` ← a digest **and** a byte length exactly
                                                when ``hadOriginal``, both ``None`` otherwise

    Shape is all that is decided here, and this function is called from **both** doors —
    the disable path and the restore path — so a record refused at one is refused
    identically at the other.
    """
    path = _community_marker_path(vault)
    raw = _read_bytes_or_none(path)
    if raw is None:
        return None
    try:
        marker = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as err:
        raise CommunityPluginsConflict(f"the borrow marker at {path} is unreadable") from err
    if not isinstance(marker, dict):
        raise CommunityPluginsConflict(f"the borrow marker at {path} is not an object")
    if set(marker) != set(constants.COMMUNITY_PLUGINS_MARKER_FIELDS):
        raise CommunityPluginsConflict(
            f"the borrow marker at {path} does not carry the pinned field set "
            f"{constants.COMMUNITY_PLUGINS_MARKER_FIELDS!r}"
        )

    for field in ("runId", "role", "createdAt"):
        if not isinstance(marker[field], str) or not marker[field]:
            raise CommunityPluginsConflict(
                f"the borrow marker's {field!r} is not a non-empty string"
            )
    if marker["role"] not in constants.ROLES:
        raise CommunityPluginsConflict(
            f"the borrow marker names a role that is not one of {constants.ROLES!r}"
        )
    if not _is_int(marker["pid"]) or marker["pid"] < 0:
        raise CommunityPluginsConflict("the borrow marker's 'pid' is not a non-negative integer")
    if not isinstance(marker["hadOriginal"], bool):
        raise CommunityPluginsConflict("the borrow marker's 'hadOriginal' is not a boolean")
    if not _is_id_list(marker["disabled"]):
        raise CommunityPluginsConflict(
            "the borrow marker's 'disabled' is not a list of distinct non-empty plugin "
            "ids; a borrow that does not say what it disabled cannot be undone"
        )

    sha = marker["originalSha256"]
    size = marker["originalSize"]
    if marker["hadOriginal"]:
        if not _is_digest(sha):
            raise CommunityPluginsConflict(
                "the borrow marker claims an original but carries no sha256 for it"
            )
        if not _is_int(size) or size < 0:
            raise CommunityPluginsConflict(
                "the borrow marker claims an original but carries no byte length for it"
            )
    else:
        if sha is not None:
            raise CommunityPluginsConflict(
                "the borrow marker claims there was no enabled list yet carries a sha256"
            )
        if size is not None:
            raise CommunityPluginsConflict(
                "the borrow marker claims there was no enabled list yet carries a byte length"
            )
    return marker


@dataclass(frozen=True, repr=False)
class _CommunityState:
    """The validated borrow state. It holds the owner's bytes and never renders them.

    ``original_bytes`` is the owner's file. A generated ``@dataclass`` repr would print
    it in full into any traceback that happens to hold this object — which is the same
    defect as a credential in a repr, one file away. The fingerprint is what a human
    needs; the content is what only the restore needs.

    **WP77 / S12 — why the handwritten repr below was not enough, measured.** WP70
    repaired this record by hand: ``repr=False`` plus the ``__repr__``/``__str__`` under
    this docstring. That closes ``repr()``, ``str()``, ``format()`` and ``%s`` — and
    ``dataclasses.asdict()`` does not consult ``__repr__`` at all. It walks the fields
    and deep-copies each leaf, so the raw bytes came straight back out of a record whose
    ``repr`` test was green. This is the audit-versus-type argument demonstrated inside
    this package, on a real landed attempt. The hole is closed the same way WP70 closed
    the room token and WP77 closed ``ports.BorrowState``: with the **type**. The
    handwritten repr is kept because its output (fingerprint + size) is more useful to a
    human than ``Secret(<redacted>)``, but it is no longer what makes this safe.
    """

    has_marker: bool
    had_original: bool
    original_sha256: Optional[str]
    original_bytes: Optional[Secret]

    def __post_init__(self) -> None:
        if self.original_bytes is not None and not isinstance(self.original_bytes, Secret):
            object.__setattr__(self, "original_bytes", Secret(self.original_bytes))

    def reveal_original_bytes(self) -> Optional[bytes]:
        """Return the borrowed enabled-list bytes. The only way out, spelled at the site."""
        return None if self.original_bytes is None else self.original_bytes.reveal()

    def __repr__(self) -> str:
        size = None if self.original_bytes is None else len(self.reveal_original_bytes())
        return (
            f"{type(self).__name__}(has_marker={self.has_marker!r}, "
            f"had_original={self.had_original!r}, "
            f"original_sha256={self.original_sha256!r}, original_size={size!r})"
        )

    def __str__(self) -> str:
        return self.__repr__()


def _capture_community_state(vault: Path) -> _CommunityState:
    """Validate the borrow state without writing anything (the single decision point).

    This is the **entry** door, and it decides one question the exit door does not have
    to answer: *may this leftover be adopted?* Adoption means continuing somebody's
    borrow as if it were this run's, and the rig may only do that for a leftover that is
    recognisably **its own**. The rig disables exactly
    :data:`~obsidian_e2e.constants.DISABLED_PLUGIN_IDS` and nothing else, so a marker
    whose ``disabled`` set is not that set was written by something that is not this rig
    — a different tool, a different version, or a hand edit — and taking it over would
    mean restoring a file this rig never captured, on behalf of a borrow it does not
    understand. That is a conflict, not an adoption.
    """
    marker = _load_community_marker(vault)
    backup = _read_bytes_or_none(_community_backup_path(vault))
    backup_path = _community_backup_path(vault)

    if marker is not None and tuple(marker["disabled"]) != tuple(constants.DISABLED_PLUGIN_IDS):
        raise CommunityPluginsConflict(
            f"the borrow marker at {_community_marker_path(vault)} records a disabled set "
            f"this rig never writes; the rig only ever disables "
            f"{constants.DISABLED_PLUGIN_IDS!r}, so this leftover is another owner's "
            "borrow and is not adoptable"
        )

    if marker is None:
        if backup is not None:
            raise CommunityPluginsConflict(
                f"a saved enabled list exists at {backup_path} with no marker to say what "
                "it is; refusing to treat it as either an original or debris"
            )
        live = _read_bytes_or_none(_community_path(vault))
        return _CommunityState(
            has_marker=False,
            had_original=live is not None,
            original_sha256=_sha256(live) if live is not None else None,
            original_bytes=live,
        )

    if marker["hadOriginal"]:
        if backup is None:
            raise CommunityPluginsConflict(
                f"the marker records a saved enabled list but {backup_path} is gone; the "
                "owner's list can no longer be reconstructed"
            )
        actual = _sha256(backup)
        if actual != marker["originalSha256"]:
            raise CommunityPluginsConflict(
                f"the saved enabled list at {backup_path} ({len(backup)} bytes, sha256 "
                f"{actual}) does not match the sha256 the marker recorded "
                f"({marker['originalSha256']})"
            )
        # Both halves of the recorded fingerprint, at this door exactly as at the other.
        if len(backup) != marker["originalSize"]:
            raise CommunityPluginsConflict(
                f"the saved enabled list at {backup_path} is {len(backup)} bytes, but the "
                f"marker records the captured list as {marker['originalSize']} bytes"
            )
        return _CommunityState(
            has_marker=True,
            had_original=True,
            original_sha256=marker["originalSha256"],
            original_bytes=backup,
        )

    if backup is not None:
        raise CommunityPluginsConflict(
            f"the marker records that no enabled list existed, yet a saved one is present "
            f"at {backup_path}"
        )
    return _CommunityState(
        has_marker=True, had_original=False, original_sha256=None, original_bytes=None
    )


def _community_marker_blob(
    *,
    run_id: str,
    role: str,
    had_original: bool,
    original_sha256: Optional[str],
    original_size: Optional[int],
    disabled: Sequence[str],
    pid: int,
    created_at: str,
) -> bytes:
    """Serialise the borrow marker with exactly the pinned field set.

    A fingerprint and the structure, never a copy of the list itself.
    """
    marker = {
        "runId": run_id,
        "role": role,
        "hadOriginal": had_original,
        "originalSha256": original_sha256,
        "originalSize": original_size,
        "disabled": list(disabled),
        "pid": pid,
        "createdAt": created_at,
    }
    assert set(marker) == set(constants.COMMUNITY_PLUGINS_MARKER_FIELDS)
    return json.dumps(marker, indent=2).encode("utf-8") + b"\n"


#: The UTF-8 byte-order mark. Obsidian's own writer does not emit one, but a file that
#: has been through an editor on Windows may carry it, and it is part of the owner's file.
_UTF8_BOM = b"\xef\xbb\xbf"

#: Whitespace JSON permits between tokens — the same set ``ports.py`` scans with.
_JSON_WS = " \t\r\n"


class _MalformedEnabledList(Exception):
    """Internal: the enabled list is not a JSON array this module can splice."""


def _read_json_string(text: str, start: int) -> tuple:
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
    raise _MalformedEnabledList("unterminated string")


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
        raise _MalformedEnabledList("unterminated container")
    index = start
    length = len(text)
    while index < length and text[index] not in ",}] \t\r\n":
        index += 1
    if index == start:
        raise _MalformedEnabledList("empty value")
    return index


def _array_elements(text: str, open_index: int) -> tuple:
    """Scan the root array, returning ``([(start, end)], close_index)``."""
    elements = []
    index = open_index + 1
    length = len(text)
    while index < length:
        char = text[index]
        if char in _JSON_WS:
            index += 1
            continue
        if char == "]":
            return elements, index
        if char == ",":
            index += 1
            continue
        start = index
        end = _skip_value(text, start)
        elements.append((start, end))
        index = end
    raise _MalformedEnabledList("unterminated array")


def _enabled_without_disabled(original: bytes, path: Path) -> tuple:
    """Return ``(remaining_ids, narrowed_bytes)`` — the rig's ids removed, and nothing else.

    Two properties, and the second is the one attempt 1 did not have:

    ├── **Removal is by exact id.** A substring or prefix match would disable the owner's
    │   unrelated plugins (``obsidian-git-sync``, ``my-obsidian-git``), and a rewrite from
    │   a filtered *set* would silently reorder or drop entries the rig knows nothing
    │   about. Every other entry survives, in its original relative order.
    └── **The modify path is a textual splice, never a re-serialisation.** Only the spans
        occupied by the removed entries are cut; every other byte of the file is carried
        over unchanged, so the owner's BOM, CRLFs, tabs, indentation depth, single-line
        spacing, escaped non-ASCII and missing trailing newline all survive the borrow.

    That second property is not decoration. The restore already gives the *original* bytes
    back from the backup — but the borrowed file is the owner's file too: their Obsidian
    may open it mid-run, a crashed run leaves it in place until the next teardown, and a
    ``json.dumps`` rewrite silently converts their file to this module's house style and
    calls it unchanged. This is the same discipline ``ports.py::_with_port`` applies to
    ``data.json``, applied to the file next to it.
    """
    prefix = _UTF8_BOM if original.startswith(_UTF8_BOM) else b""
    body = original[len(prefix) :]
    try:
        text = body.decode("utf-8")
    except UnicodeDecodeError as err:
        raise CommunityPluginsConflict(
            f"the enabled-plugin list at {path} is not readable JSON"
        ) from err

    index = 0
    while index < len(text) and text[index] in _JSON_WS:
        index += 1
    if index >= len(text) or text[index] != "[":
        raise CommunityPluginsConflict(
            f"the enabled-plugin list at {path} is not a JSON array"
        )
    open_index = index

    try:
        spans, _close_index = _array_elements(text, open_index)
        values = [json.loads(text[start:end]) for start, end in spans]
    except (_MalformedEnabledList, ValueError) as err:
        raise CommunityPluginsConflict(
            f"the enabled-plugin list at {path} is not readable JSON"
        ) from err

    remaining = [value for value in values if value not in constants.DISABLED_PLUGIN_IDS]

    cuts = []
    for position, (start, end) in enumerate(spans):
        if values[position] not in constants.DISABLED_PLUGIN_IDS:
            continue
        if position + 1 < len(spans):
            # Take the entry and the separator that follows it, so the entry after it
            # inherits this one's leading whitespace and the file keeps its own layout.
            cuts.append((start, spans[position + 1][0]))
        elif position > 0:
            # The last entry: take the separator that precedes it instead.
            cuts.append((spans[position - 1][1], end))
        else:
            # The only entry: take exactly the entry, leaving the brackets and whatever
            # whitespace the owner had between them.
            cuts.append((start, end))

    spliced = text
    for start, end in sorted(cuts, reverse=True):
        spliced = spliced[:start] + spliced[end:]
    narrowed = prefix + spliced.encode("utf-8")

    # The splice is verified rather than trusted: it must still be JSON, and it must be
    # exactly the list the id filter says it is. A splice that cannot be shown to have
    # done that refuses — with nothing written, because this runs before the first write.
    try:
        reparsed = json.loads(narrowed.decode("utf-8-sig"))
    except (UnicodeDecodeError, ValueError) as err:
        raise CommunityPluginsConflict(
            f"narrowing the enabled-plugin list at {path} would not leave readable JSON"
        ) from err
    if reparsed != remaining:
        raise CommunityPluginsConflict(
            f"narrowing the enabled-plugin list at {path} would not leave exactly the "
            "entries the rig does not own"
        )
    return remaining, narrowed


def disable_community_plugins(
    vault_path: PathLike, role: str, *, run_id: str
) -> CommunityPluginsRecord:
    """Borrow ``community-plugins.json`` and take ``obsidian-git`` out of it.

    ``obsidian-git`` is enabled in both vaults with ``autoPullOnBoot: true`` over dirty
    git work trees, so it can bring content into either vault by a path that has nothing
    to do with the relay — and it fires at **launch**, before a gesture is even made.
    Disabling it for the run is a precondition rather than a choice.

    The borrow follows the same discipline as WP44's and WP69's: the backup is written
    once and is never overwritten by the already-modified state, so a run that crashes
    before teardown leaves a vault the *next* run can still restore correctly. A
    consistent leftover is adopted; a contradictory one is refused with nothing written.
    """
    vault = Path(vault_path)
    config_dir = _community_path(vault).parent
    if not config_dir.is_dir():
        raise CommunityConfigMissing(
            f"no configuration directory at {config_dir}; the rig does not create one "
            "inside a vault, and a path without it is not an Obsidian vault"
        )
    state = _capture_community_state(vault)

    path = _community_path(vault)
    backup_path = _community_backup_path(vault)
    marker_path = _community_marker_path(vault)

    # Computed before the first write, so a list this module cannot narrow is a refusal
    # with the vault byte-identical rather than a half-finished borrow.
    if state.had_original:
        remaining, narrowed = _enabled_without_disabled(
            state.reveal_original_bytes() or b"", path
        )
    else:
        remaining, narrowed = [], b""

    created_at = datetime.now(timezone.utc).isoformat()
    pid = os.getpid()

    # Order matters: the original is durably saved before the live file is touched, so a
    # crash between the two leaves a recoverable vault rather than an unrecoverable one.
    if state.had_original and not backup_path.exists():
        _atomic_write_bytes(backup_path, state.reveal_original_bytes() or b"")

    _atomic_write_bytes(
        marker_path,
        _community_marker_blob(
            run_id=run_id,
            role=role,
            had_original=state.had_original,
            original_sha256=state.original_sha256,
            original_size=(
                len(state.reveal_original_bytes()) if state.original_bytes is not None else None
            ),
            disabled=constants.DISABLED_PLUGIN_IDS,
            pid=pid,
            created_at=created_at,
        ),
    )

    if state.had_original:
        _atomic_write_bytes(path, narrowed)

    return CommunityPluginsRecord(
        role=role,
        vault_path=str(vault),
        community_path=str(path),
        backup_path=str(backup_path),
        marker_path=str(marker_path),
        had_original=state.had_original,
        original_sha256=state.original_sha256,
        original_size=(
            len(state.reveal_original_bytes()) if state.original_bytes is not None else None
        ),
        disabled=tuple(constants.DISABLED_PLUGIN_IDS),
        enabled_after=tuple(remaining),
        run_id=run_id,
        pid=pid,
        created_at=created_at,
        adopted_existing_backup=state.has_marker,
    )


def restore_community_plugins(vault_path: PathLike) -> CommunityRestoreResult:
    """Put the owner's enabled-plugin list back, byte for byte, or refuse loudly.

    This is the oracle the whole safety argument of the borrow rests on — it is what
    proves the owner's file was *given back* — so it is written to be falsifiable rather
    than reassuring. An unreliable restore-verifier is worse than none, because it reads
    as corroboration.

    The property, stated once:

        A restore is verified against the fingerprint **the marker recorded** — sha256
        *and* exact byte length — before anything is written and again after, and the
        comparison is over **raw bytes**.

    Three corollaries, each of which is a way this has been got wrong before:

    ├── **Any path that decodes, parses, re-serialises or normalises the content is not
    │   a restore.** That the ids come back is not the criterion: a parse-and-rewrite
    │   reproduces every id and destroys the owner's BOM, tabs, CRLFs, missing trailing
    │   newline, escaped non-ASCII and single-line spacing, all of which are their file.
    │   Nothing on this path decodes the bytes at all.
    ├── **A backup replaced by a semantically-equal but byte-different copy is a
    │   mismatch, not a success.** The comparand is the recorded fingerprint, so a
    │   re-serialised copy of the same list fails on both halves of it.
    └── **A readback compared against the bytes just written proves the write, never the
        restore.** ``written == backup`` is true whenever the file system works, and says
        nothing about whether ``backup`` is still what was captured. Both halves of the
        readback are therefore compared against the *marker's* record.

    ``disabled`` is deliberately **not** consulted here — see :func:`_capture_community_state`
    for why that check belongs at the entry door and only there.
    """
    vault = Path(vault_path)
    path = _community_path(vault)
    backup_path = _community_backup_path(vault)
    marker_path = _community_marker_path(vault)

    marker = _load_community_marker(vault)
    backup = _read_bytes_or_none(backup_path)

    if marker is None:
        if backup is not None:
            raise CommunityPluginsConflict(
                f"a saved enabled list exists at {backup_path} with no marker to say what "
                "it is; refusing to restore from an unattributed file"
            )
        return CommunityRestoreResult(
            restored=False,
            had_original=False,
            vault_path=str(vault),
            community_path=str(path),
            file_present=path.is_file(),
        )

    if marker["hadOriginal"] is True:
        if backup is None:
            raise CommunityPluginsConflict(
                f"the marker records a saved enabled list but {backup_path} is gone; the "
                "owner's list can no longer be reconstructed"
            )
        expected_sha = marker["originalSha256"]
        expected_size = marker["originalSize"]
        actual_sha = _sha256(backup)

        # Verified BEFORE anything is written, so a refusal leaves the vault exactly as it
        # was and leaves the evidence — backup and marker — for a human. Both halves are
        # checked separately: a digest that matches while the recorded length does not can
        # only come from a record edited after it was written, and a record that disagrees
        # with itself is not a restore point.
        if actual_sha != expected_sha:
            raise CommunityPluginsRestoreMismatch(
                f"the saved enabled list at {backup_path} ({len(backup)} bytes, sha256 "
                f"{actual_sha}) does not match the captured sha256 {expected_sha}; the "
                "live file was left untouched"
            )
        if len(backup) != expected_size:
            raise CommunityPluginsRestoreMismatch(
                f"the saved enabled list at {backup_path} is {len(backup)} bytes, but the "
                f"marker records the captured list as {expected_size} bytes; the live "
                "file was left untouched"
            )

        _atomic_write_bytes(path, backup)

        # Against what the MARKER recorded, never against the bytes just written.
        written = _read_bytes_or_none(path)
        if (
            written is None
            or len(written) != expected_size
            or _sha256(written) != expected_sha
        ):
            raise CommunityPluginsRestoreMismatch(
                f"after writing {path} the file does not reproduce the captured enabled "
                f"list (expected {expected_size} bytes / sha256 {expected_sha})"
            )

        _remove_if_present(backup_path)
        _remove_if_present(marker_path)
        return CommunityRestoreResult(
            restored=True,
            had_original=True,
            vault_path=str(vault),
            community_path=str(path),
            file_present=True,
            restored_sha256=expected_sha,
            restored_size=expected_size,
        )

    if backup is not None:
        raise CommunityPluginsConflict(
            f"the marker records that no enabled list existed, yet a saved one is present "
            f"at {backup_path}"
        )

    # There was no list before the run, so "byte-exact" means: no list after it either —
    # not an empty file and not `[]`. And that is verified rather than attempted: the exit
    # door checks its own result exactly as hard as the other branch checks its write.
    _remove_if_present(path)
    if path.exists():
        raise CommunityPluginsRestoreMismatch(
            f"{path} still exists after teardown; the owner had no enabled list, so the "
            "vault must look as though the rig had never written one"
        )
    _remove_if_present(marker_path)
    return CommunityRestoreResult(
        restored=True,
        had_original=False,
        vault_path=str(vault),
        community_path=str(path),
        file_present=path.is_file(),
    )


class _BorrowedCommunityPlugins:
    def __init__(self, vault_path: PathLike, role: str, *, run_id: str) -> None:
        self._vault = Path(vault_path)
        self._role = role
        self._run_id = run_id

    def __enter__(self) -> CommunityPluginsRecord:
        return disable_community_plugins(self._vault, self._role, run_id=self._run_id)

    def __exit__(self, exc_type, exc, tb) -> bool:
        restore_community_plugins(self._vault)
        return False


def borrowed_community_plugins(vault_path: PathLike, role: str, *, run_id: str):
    """Context manager: disable on entry, restore on **every** exit path.

    The precondition modifies the owner's *enabled plugin list*. A run that aborts
    without restoring it leaves their Obsidian starting up with ``obsidian-git`` silently
    off — a change to their working environment that nothing in the vault records. So the
    exit is unconditional: ``__exit__`` runs for ``KeyboardInterrupt`` and ``SystemExit``
    too, which a teardown hung off ``except Exception`` would miss.
    """
    return _BorrowedCommunityPlugins(vault_path, role, run_id=run_id)


# ---------------------------------------------------------------------------
# Ordering (AC4) — enforced at the boundary, then recorded
# ---------------------------------------------------------------------------


class GateSequence:
    """The pinned start-up order, enforced as a refusal and recorded as a sequence.

    The gate run is **agent-mediated**: the rig plans, an agent executes. An ordering that
    only the plan expresses is an ordering an agent can step around, so each constraint is
    a refusal at the boundary that owns it and a step arriving out of order is refused
    wherever it arrives from. This class owns the whole-sequence half of that; the relay
    and the settings provisioner own their own boundaries and raise the *same* exception
    type.
    """

    #: Verbatim from AC4: install+verify bundle -> relay port free -> relay started ->
    #: relay healthz-ok -> room minted on THAT relay -> per vault: obsidian-git disabled
    #: -> data.json borrowed and provisioned -> launch/attach -> readiness+identity ->
    #: scratch -> matrix case 1.
    STEPS = (
        "install_bundle",
        "relay_port_free",
        "relay_started",
        "relay_healthy",
        "room_minted",
        "community_plugins_disabled",
        "settings_provisioned",
        "obsidian_launched",
        "readiness_identity",
        "scratch_created",
        "matrix_case_1",
    )

    def __init__(self, *, run_id: str) -> None:
        self.run_id = run_id
        self._completed: list = []
        self._current: Optional[str] = None
        self._order: list = []

    @property
    def completed(self) -> tuple:
        return tuple(self._completed)

    @property
    def current(self) -> Optional[str]:
        return self._current

    def begin(self, step: str) -> str:
        """Open ``step``, or refuse if it is not the one the pinned order expects next."""
        if step not in self.STEPS:
            raise GateOrderViolation(
                f"{step!r} is not a step of the gate sequence; the pinned order is "
                f"{self.STEPS!r}"
            )
        if self._current is not None:
            raise GateOrderViolation(
                f"{step!r} was begun while {self._current!r} is still open; the gate's "
                "steps do not overlap"
            )
        expected_index = len(self._completed)
        if self.STEPS.index(step) != expected_index:
            expected = self.STEPS[expected_index] if expected_index < len(self.STEPS) else None
            raise GateOrderViolation(
                f"{step!r} arrived out of order; the pinned order expects {expected!r} "
                f"after {self.completed!r}"
            )
        self._current = step
        self._order.append(step)
        return step

    def complete(self, step: str) -> str:
        """Close the currently open step."""
        if step != self._current:
            raise GateOrderViolation(
                f"{step!r} was completed but the open step is {self._current!r}"
            )
        self._current = None
        self._completed.append(step)
        return step

    def teardown_order(self) -> tuple:
        """The reverse of what **actually ran** — steps that never ran are not undone."""
        return tuple(reversed(self._order))

    def record(self) -> dict:
        """State which steps ran, in which order, with the open one still visible.

        A record that lists the steps as a set, or that keeps only the ones that
        succeeded, does not state an order — and in a mediated run the order is the thing
        most easily lost.
        """
        steps = []
        for ordinal, step in enumerate(self._order, start=1):
            steps.append(
                {
                    "step": step,
                    "ordinal": ordinal,
                    "status": "started" if step == self._current else "completed",
                }
            )
        return {"runId": self.run_id, "order": list(self._order), "steps": steps}


def run_teardown(actions: Iterable) -> TeardownReport:
    """Attempt **every** teardown action, in order, and report what failed and why.

    Teardown reverses the start-up order and runs to completion even when a step fails.
    The failure this forbids is the ordinary one: a straight-line sequence where the first
    raising action abandons every later one, leaving the settings borrowed, the enabled
    plugin list modified, or the relay holding the port. ``KeyboardInterrupt`` and
    ``SystemExit`` are caught here for the same reason they are caught in the borrows —
    they derive from ``BaseException`` and would otherwise escape and abandon the rest.
    """
    attempted: list = []
    succeeded: list = []
    failed: list = []
    reasons: dict = {}

    for name, action in actions:
        attempted.append(name)
        try:
            action()
        except BaseException as err:  # noqa: BLE001 - every action must be attempted
            failed.append(name)
            reasons[name] = getattr(err, "reason", None) or type(err).__name__
        else:
            succeeded.append(name)

    return TeardownReport(
        attempted=tuple(attempted),
        succeeded=tuple(succeeded),
        failed=tuple(failed),
        reasons=reasons,
        complete=True,
    )
