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
    "disable_community_plugins",
    "restore_community_plugins",
    "borrowed_community_plugins",
    "run_teardown",
    "GateOrderViolation",
    "RestartRequiredOperator",
    "SharedSurfaceNotEstablished",
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
    """
    if role not in constants.SETTINGS_ROLES:
        raise ValueError(f"unknown role {role!r}; expected one of {constants.ROLES!r}")
    if room is None:
        raise GateOrderViolation(
            "the gate's settings cannot be built without a room minted on the run's relay"
        )
    members = {
        "e2eControlPort": constants.REAL_CONTROL_PORTS[role],
        "serverUrl": room.base_url,
        "roomId": room.id,
        "token": room.token,
        "role": constants.SETTINGS_ROLES[role],
        "permission": constants.SETTINGS_PERMISSION,
        "sharedFolder": constants.SETTINGS_SHARED_FOLDER,
        "excludePatterns": list(constants.SETTINGS_EXCLUDE_PATTERNS),
        "autoReconnect": constants.SETTINGS_AUTO_RECONNECT,
        "debugLogging": constants.SETTINGS_DEBUG_LOGGING,
    }
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
            for entry in entries
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

    resolved = dict(members) if members is not None else gate_settings_members(role, room)
    verify_shared_surface(resolved)

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
        server_url=str(resolved.get("serverUrl", "")),
        session_role=str(resolved.get("role", "")),
        permission=str(resolved.get("permission", "")),
        shared_folder=str(resolved["sharedFolder"]),
        exclude_patterns=tuple(resolved["excludePatterns"]),
        auto_reconnect=bool(resolved.get("autoReconnect")),
        debug_logging=bool(resolved.get("debugLogging")),
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


def _load_community_marker(vault: Path) -> Optional[dict]:
    """Return the parsed borrow marker, or ``None`` when there is none.

    An unreadable or structurally wrong marker is a **conflict**, never a missing marker:
    "no borrow in progress" and "a borrow whose record is damaged" are exactly the
    difference between proceeding and refusing.
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
    if not isinstance(marker["hadOriginal"], bool):
        raise CommunityPluginsConflict("the borrow marker's 'hadOriginal' is not a boolean")
    sha = marker["originalSha256"]
    if marker["hadOriginal"]:
        if not isinstance(sha, str) or len(sha) != 64:
            raise CommunityPluginsConflict(
                "the borrow marker claims an original but carries no sha256 for it"
            )
        if not isinstance(marker["originalSize"], int):
            raise CommunityPluginsConflict(
                "the borrow marker claims an original but carries no byte length for it"
            )
    elif sha is not None:
        raise CommunityPluginsConflict(
            "the borrow marker claims there was no enabled list yet carries a sha256"
        )
    return marker


@dataclass(frozen=True)
class _CommunityState:
    has_marker: bool
    had_original: bool
    original_sha256: Optional[str]
    original_bytes: Optional[bytes]


def _capture_community_state(vault: Path) -> _CommunityState:
    """Validate the borrow state without writing anything (the single decision point)."""
    marker = _load_community_marker(vault)
    backup = _read_bytes_or_none(_community_backup_path(vault))
    backup_path = _community_backup_path(vault)

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
        if actual != marker["originalSha256"] or len(backup) != marker["originalSize"]:
            raise CommunityPluginsConflict(
                f"the saved enabled list at {backup_path} ({len(backup)} bytes, sha256 "
                f"{actual}) does not match the marker's record "
                f"({marker['originalSize']} bytes, sha256 {marker['originalSha256']})"
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


def _enabled_without_disabled(original: bytes, path: Path) -> list:
    """Parse the enabled list and return it with the rig's ids removed, by **exact** id.

    A substring or prefix match would disable the owner's unrelated plugins, and a
    rewrite from a filtered *set* would silently reorder or drop entries the rig knows
    nothing about. Every other entry survives, in its original relative order.
    """
    try:
        parsed = json.loads(original.decode("utf-8-sig"))
    except (UnicodeDecodeError, ValueError) as err:
        raise CommunityPluginsConflict(
            f"the enabled-plugin list at {path} is not readable JSON"
        ) from err
    if not isinstance(parsed, list):
        raise CommunityPluginsConflict(
            f"the enabled-plugin list at {path} is not a JSON array"
        )
    return [entry for entry in parsed if entry not in constants.DISABLED_PLUGIN_IDS]


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
    state = _capture_community_state(vault)

    path = _community_path(vault)
    backup_path = _community_backup_path(vault)
    marker_path = _community_marker_path(vault)

    if state.had_original:
        remaining = _enabled_without_disabled(state.original_bytes or b"", path)
    else:
        remaining = []

    created_at = datetime.now(timezone.utc).isoformat()
    pid = os.getpid()

    # Order matters: the original is durably saved before the live file is touched, so a
    # crash between the two leaves a recoverable vault rather than an unrecoverable one.
    if state.had_original and not backup_path.exists():
        _atomic_write_bytes(backup_path, state.original_bytes or b"")

    _atomic_write_bytes(
        marker_path,
        _community_marker_blob(
            run_id=run_id,
            role=role,
            had_original=state.had_original,
            original_sha256=state.original_sha256,
            original_size=len(state.original_bytes) if state.original_bytes is not None else None,
            disabled=constants.DISABLED_PLUGIN_IDS,
            pid=pid,
            created_at=created_at,
        ),
    )

    if state.had_original:
        _atomic_write_bytes(
            path, json.dumps(remaining, indent=2).encode("utf-8") + b"\n"
        )

    return CommunityPluginsRecord(
        role=role,
        vault_path=str(vault),
        community_path=str(path),
        backup_path=str(backup_path),
        marker_path=str(marker_path),
        had_original=state.had_original,
        original_sha256=state.original_sha256,
        original_size=len(state.original_bytes) if state.original_bytes is not None else None,
        disabled=tuple(constants.DISABLED_PLUGIN_IDS),
        enabled_after=tuple(remaining),
        run_id=run_id,
        pid=pid,
        created_at=created_at,
        adopted_existing_backup=state.has_marker,
    )


def restore_community_plugins(vault_path: PathLike) -> CommunityRestoreResult:
    """Put the owner's enabled-plugin list back, byte for byte, or refuse loudly.

    The restore is driven by the backup file and verified — sha256 **and** exact byte
    length — before anything is written and again afterwards. That the ids come back is
    not the criterion: a parse-and-rewrite restore reproduces the ids and destroys the
    owner's tabs, CRLFs and missing trailing newline, which are part of their file.
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

    if bool(marker["hadOriginal"]):
        if backup is None:
            raise CommunityPluginsConflict(
                f"the marker records a saved enabled list but {backup_path} is gone; the "
                "owner's list can no longer be reconstructed"
            )
        expected_sha = marker["originalSha256"]
        expected_size = marker["originalSize"]
        actual_sha = _sha256(backup)
        if actual_sha != expected_sha or len(backup) != expected_size:
            # Verified BEFORE anything is written: the live file is untouched and the
            # evidence — backup and marker — stays for a human.
            raise CommunityPluginsRestoreMismatch(
                f"the saved enabled list at {backup_path} ({len(backup)} bytes, sha256 "
                f"{actual_sha}) does not match the captured record ({expected_size} "
                f"bytes, sha256 {expected_sha}); the live file was left untouched"
            )

        _atomic_write_bytes(path, backup)
        written = _read_bytes_or_none(path)
        if written is None or len(written) != len(backup) or _sha256(written) != expected_sha:
            raise CommunityPluginsRestoreMismatch(
                f"after writing {path} the file does not reproduce the captured enabled "
                f"list (expected {len(backup)} bytes / sha256 {expected_sha})"
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
            restored_size=len(backup),
        )

    if backup is not None:
        raise CommunityPluginsConflict(
            f"the marker records that no enabled list existed, yet a saved one is present "
            f"at {backup_path}"
        )

    # There was no list before the run, so "byte-exact" means: no list after it either.
    _remove_if_present(path)
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
