"""WP43 — vault registry resolution and Obsidian instance discovery (**read-only probe**).

Outcome (charter §1): the rig can state, *before touching anything*, exactly which two
vaults it will drive and what already exists there.

Acceptance criteria and how this module satisfies them:

- **AC1** — :func:`resolve_vault` maps a configured vault path onto its registry entry for
  paths containing spaces, paths differing only by case, and paths with a trailing
  separator. A configured vault that is absent from the registry yields the named failure
  :data:`~obsidian_e2e.constants.VAULT_NOT_IN_REGISTRY` and **no** registry identity — never
  a fallback guess.
- **AC2** — :func:`inspect_plugin` reports presence and enablement per vault.
  ``PLUGIN_PRESENT_BUT_DISABLED`` is its own state, not a flavour of ``PLUGIN_MISSING``.
  Enablement comes from ``.obsidian/community-plugins.json``. Contract §1.1's
  ``PLUGIN_NOT_E2E_CAPABLE`` (production build, control server tree-shaken out) is a third
  distinct state and is never conflated with "port not provisioned".
- **AC3** — :func:`is_obsidian_running` answers a **host-level** question only. The default
  process lister returns process *names* and nothing else, so no pid and no command line
  ever exists in this module to attribute. No returned structure maps a process to a vault:
  :class:`VaultInstance` has no pid, no command line and no "is this one mine" field. Vault
  attribution is the control endpoint's job (WP46) and only its job (D14: Obsidian is
  single-instance, so a second vault is another window in the same process tree — process
  identity says nothing about which vault is which).
- **AC4** — no writes, structurally rather than incidentally. This module exposes no write
  operation, and **every** filesystem read in it goes through :func:`_read_bytes`, the one
  helper below, whose mode is the hardcoded literal ``"rb"``. There is no other ``open(``
  in this file, no ``os.remove``/``mkdir``/``rename``, no ``shutil``, and no ``subprocess``
  — liveness uses a read-only kernel snapshot via ``ctypes``, so nothing is ever started.
  Auditing this claim is one grep per line: ``open(``, ``subprocess``, ``Popen``, ``shutil``.

Data safety: ``%APPDATA%\\obsidian\\obsidian.json`` is shared global state — read, never
rewritten, not even to reformat (S3). ``data.json`` is never read, never printed and never
logged by this module; it holds a live production secret (S4).

Every path is injectable, so the whole module can be pointed at a fixture vault: the
registry path is an argument, the vault paths are arguments and the process lister is an
argument. Nothing here can only look at the owner's real vault.
"""

from __future__ import annotations

import collections.abc
import json
import os
import sys
from dataclasses import dataclass
from typing import Callable, Iterable, Mapping, Optional, Sequence

from . import constants

__all__ = [
    "VaultResolution",
    "PluginInspection",
    "VaultInstance",
    "DiscoveryResult",
    "resolve_vault",
    "inspect_plugin",
    "is_obsidian_running",
    "discover_instances",
    "default_process_lister",
]

#: A process listing is a sequence of records. Only the ``name`` of each record is ever
#: consulted (AC3) — a richer record is accepted but everything except the name is ignored.
ProcessLister = Callable[[], Iterable[object]]


# ---------------------------------------------------------------------------
# The single I/O primitive (AC4)
# ---------------------------------------------------------------------------


def _read_bytes(path: str) -> Optional[bytes]:
    """Read a file as bytes, or return ``None`` if it cannot be read.

    **This is the only file access in this module and the only ``open()`` call.** The mode
    is the hardcoded literal ``"rb"``; there is no mode parameter, so no caller can turn
    this into a write. That is what makes AC4 structural rather than a promise.
    """
    try:
        with open(path, "rb") as handle:  # noqa: PTH123 - deliberate: single audited read site
            return handle.read()
    except OSError:
        return None


def _read_json(path: str) -> Optional[object]:
    """Parse a JSON file through :func:`_read_bytes`; ``None`` if unreadable or malformed."""
    raw = _read_bytes(path)
    if raw is None:
        return None
    try:
        return json.loads(raw.decode("utf-8-sig"))
    except (UnicodeDecodeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Path identity
# ---------------------------------------------------------------------------


def _path_key(path: str) -> str:
    """Comparison key for a vault path.

    ``abspath`` normalises separators and drops a trailing separator (AC1: trailing
    separator), ``normcase`` folds case and slash direction on Windows (AC1: case). Spaces
    are preserved untouched (AC1: spaces) — they are only ever a problem for shell quoting,
    never for path comparison. This function performs **no** filesystem access, so an
    entry whose directory has since been deleted still resolves and is then reported as
    :data:`~obsidian_e2e.constants.VAULT_PATH_MISSING`.
    """
    return os.path.normcase(os.path.abspath(str(path)))


def _real_key(path: str) -> Optional[str]:
    """Secondary key that resolves symlinks and Windows junctions; ``None`` on failure.

    Only consulted when the primary key misses, so a junctioned vault path still finds its
    registry entry without ever loosening the match to a guess.
    """
    try:
        return os.path.normcase(os.path.realpath(str(path)))
    except (OSError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Result types — deliberately flat, and deliberately free of any process field (AC3)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class VaultResolution:
    """Outcome of mapping one configured vault path onto the registry (AC1)."""

    configured_path: str
    ok: bool
    failure: Optional[str]
    registry_id: Optional[str]
    vault_name: Optional[str]
    resolved_path: Optional[str]


@dataclass(frozen=True)
class PluginInspection:
    """Plugin install state inside one vault (AC2 + contract §1.1)."""

    present: bool
    enabled: bool
    e2e_capable: bool
    state: str


@dataclass(frozen=True)
class VaultInstance:
    """Everything the rig knows about one role's vault before it touches anything.

    Note what is *absent*: no pid, no command line, no process handle, no "this window
    serves me" flag. AC3 makes that absence a requirement — attribution of a running
    process to a vault is claimed only through the control endpoint (WP46).
    """

    role: str
    configured_path: str
    resolved_path: Optional[str]
    registry_id: Optional[str]
    vault_name: Optional[str]
    vault_exists: bool
    plugin_present: bool
    plugin_enabled: bool
    plugin_e2e_capable: bool
    plugin_state: str
    ok: bool
    failure: Optional[str]


@dataclass(frozen=True)
class DiscoveryResult:
    """The full pre-flight picture for the configured pair of vaults."""

    registry_path: str
    registry_available: bool
    #: Host-level only: is *any* Obsidian running on this machine (AC3).
    obsidian_running: bool
    #: ``False`` when liveness could not be determined (unsupported host, probe refused).
    obsidian_running_known: bool
    instances: Mapping[str, VaultInstance]
    ok: bool
    failures: Sequence[str]


# ---------------------------------------------------------------------------
# Registry (AC1)
# ---------------------------------------------------------------------------


def _registry_entries(registry_path: str) -> Optional[dict]:
    """Return ``{registry_id: recorded_path}`` from the registry, or ``None`` if unreadable.

    The registry is read and never rewritten (S3). Unknown extra keys (``ts``, ``open``,
    …) are ignored rather than reinterpreted — this module does not use the registry's
    ``open`` flag, because "which vault is open" is an attribution claim and only the
    control endpoint may make it (AC3).
    """
    payload = _read_json(registry_path)
    if not isinstance(payload, dict):
        return None
    vaults = payload.get("vaults")
    if not isinstance(vaults, dict):
        return None
    entries: dict = {}
    for registry_id, record in vaults.items():
        path = record.get("path") if isinstance(record, dict) else record
        if isinstance(path, str) and path:
            entries[str(registry_id)] = path
    return entries


def _resolve_against(configured_path: str, entries: Optional[dict]) -> VaultResolution:
    configured = str(configured_path)

    if entries:
        by_key = {}
        for registry_id, recorded in entries.items():
            by_key.setdefault(_path_key(recorded), (registry_id, recorded))

        match = by_key.get(_path_key(configured))

        if match is None:
            wanted = _real_key(configured)
            if wanted is not None:
                for registry_id, recorded in entries.items():
                    if _real_key(recorded) == wanted:
                        match = (registry_id, recorded)
                        break
    else:
        match = None

    if match is None:
        # No fallback guess: nothing from the registry may be attributed to this path.
        return VaultResolution(
            configured_path=configured,
            ok=False,
            failure=constants.VAULT_NOT_IN_REGISTRY,
            registry_id=None,
            vault_name=None,
            resolved_path=None,
        )

    registry_id, recorded = match
    resolved = os.path.abspath(recorded)
    vault_name = os.path.basename(resolved) or resolved

    if not os.path.isdir(resolved):
        return VaultResolution(
            configured_path=configured,
            ok=False,
            failure=constants.VAULT_PATH_MISSING,
            registry_id=registry_id,
            vault_name=vault_name,
            resolved_path=resolved,
        )

    return VaultResolution(
        configured_path=configured,
        ok=True,
        failure=None,
        registry_id=registry_id,
        vault_name=vault_name,
        resolved_path=resolved,
    )


def resolve_vault(vault_path: str, registry_path: Optional[str] = None) -> VaultResolution:
    """Resolve one configured vault path to its registry entry (AC1).

    ``registry_path`` defaults to :data:`~obsidian_e2e.constants.VAULT_REGISTRY_PATH` and is
    injectable so tests point this at a fixture registry. An unreadable or malformed
    registry is reported as :data:`~obsidian_e2e.constants.VAULT_NOT_IN_REGISTRY` — the same
    named failure, because the observable fact is identical: the registry does not vouch
    for this path, so the rig must not proceed on a guess.
    """
    path = str(registry_path) if registry_path is not None else constants.VAULT_REGISTRY_PATH
    return _resolve_against(vault_path, _registry_entries(path))


# ---------------------------------------------------------------------------
# Plugin state (AC2 + §1.1)
# ---------------------------------------------------------------------------


def _enabled_plugin_ids(vault_path: str) -> Sequence[str]:
    payload = _read_json(os.path.join(vault_path, *constants.COMMUNITY_PLUGINS_REL.split("/")))
    if not isinstance(payload, list):
        return ()
    return tuple(item for item in payload if isinstance(item, str))


def _has_e2e_markers(main_js_path: str) -> bool:
    """Whether the installed bundle carries the e2e control seams (contract §1.1).

    A production build tree-shakes ``src/testing/`` out entirely, so it contains none of
    these markers and can never host a control endpoint however the port is provisioned.
    Only the *presence* of a marker is ever reported — no bundle content is returned,
    printed or logged.
    """
    data = _read_bytes(main_js_path)
    if data is None:
        return False
    return any(marker.encode("utf-8") in data for marker in constants.E2E_BUILD_MARKERS)


def inspect_plugin(vault_path: str) -> PluginInspection:
    """Report plugin presence, enablement and e2e capability for one vault (AC2).

    State precedence, and why:

    1. bundle absent → ``PLUGIN_MISSING``
    2. bundle present but the id is not in ``community-plugins.json`` →
       ``PLUGIN_PRESENT_BUT_DISABLED`` — a **distinct** state, checked before capability
       because a disabled plugin's capability is not the operator's next action
    3. present and enabled but no e2e markers → ``PLUGIN_NOT_E2E_CAPABLE`` (§1.1); this is
       never reported as a missing plugin and never as "port not provisioned"
    4. otherwise → ``PLUGIN_OK``

    ``data.json`` is deliberately not read here: nothing in AC2 needs it and it holds a
    live production secret (S4).
    """
    root = str(vault_path)
    main_js = os.path.join(root, *constants.PLUGIN_MAIN_REL.split("/"))
    present = os.path.isfile(main_js)

    if not present:
        return PluginInspection(
            present=False, enabled=False, e2e_capable=False, state=constants.PLUGIN_MISSING
        )

    enabled = constants.PLUGIN_ID in _enabled_plugin_ids(root)
    e2e_capable = _has_e2e_markers(main_js)

    if not enabled:
        state = constants.PLUGIN_PRESENT_BUT_DISABLED
    elif not e2e_capable:
        state = constants.PLUGIN_NOT_E2E_CAPABLE
    else:
        state = constants.PLUGIN_OK

    return PluginInspection(present=True, enabled=enabled, e2e_capable=e2e_capable, state=state)


# ---------------------------------------------------------------------------
# Host liveness (AC3) — host level only, never per vault
# ---------------------------------------------------------------------------


def default_process_lister() -> Sequence[dict]:
    """List running process **names** on this host. Nothing is started (AC4).

    Uses the Win32 ToolHelp snapshot through ``ctypes`` — a read-only kernel query — rather
    than shelling out to ``tasklist``/``wmic``, which would start a process and violate
    AC4. Each record carries a ``name`` and nothing else: no pid and no command line is
    collected, so this module structurally cannot attribute a process to a vault (AC3).

    Raises ``RuntimeError`` on a host where the snapshot is unavailable; callers treat that
    as "liveness unknown", never as "Obsidian is not running".
    """
    if sys.platform != "win32":
        raise RuntimeError("process listing is implemented for Windows hosts only")

    import ctypes
    from ctypes import wintypes

    TH32CS_SNAPPROCESS = 0x00000002
    MAX_PATH = 260

    class PROCESSENTRY32W(ctypes.Structure):
        _fields_ = [
            ("dwSize", wintypes.DWORD),
            ("cntUsage", wintypes.DWORD),
            ("th32ProcessID", wintypes.DWORD),
            ("th32DefaultHeapID", ctypes.POINTER(ctypes.c_ulong)),
            ("th32ModuleID", wintypes.DWORD),
            ("cntThreads", wintypes.DWORD),
            ("th32ParentProcessID", wintypes.DWORD),
            ("pcPriClassBase", ctypes.c_long),
            ("dwFlags", wintypes.DWORD),
            ("szExeFile", ctypes.c_wchar * MAX_PATH),
        ]

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
    kernel32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    kernel32.Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
    kernel32.Process32FirstW.restype = wintypes.BOOL
    kernel32.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
    kernel32.Process32NextW.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL

    invalid = ctypes.c_void_p(-1).value
    snapshot = kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    if not snapshot or snapshot == invalid:
        raise RuntimeError("CreateToolhelp32Snapshot failed")

    try:
        entry = PROCESSENTRY32W()
        entry.dwSize = ctypes.sizeof(PROCESSENTRY32W)
        if not kernel32.Process32FirstW(snapshot, ctypes.byref(entry)):
            return ()
        names = []
        while True:
            # Name only. The pid sits right there in `entry` and is deliberately dropped.
            names.append({"name": entry.szExeFile})
            if not kernel32.Process32NextW(snapshot, ctypes.byref(entry)):
                break
        return tuple(names)
    finally:
        kernel32.CloseHandle(snapshot)


def _record_name(record: object) -> str:
    if isinstance(record, collections.abc.Mapping):
        value = record.get("name")
    else:
        value = getattr(record, "name", None)
        if value is None and isinstance(record, str):
            value = record
    return os.path.basename(str(value)) if value else ""


def is_obsidian_running(process_lister: Optional[ProcessLister] = None) -> tuple:
    """Is Obsidian running **on this host** (AC3)? Returns ``(running, known)``.

    Only the executable name of each record is examined; any pid or command line an
    injected lister happens to supply is ignored on purpose. The answer is a host-level
    boolean and is never narrowed to a vault — Obsidian is single-instance, so a second
    vault is just another window in the same process tree (D14).
    """
    lister = process_lister or default_process_lister
    try:
        records = list(lister())
    except Exception:  # noqa: BLE001 - liveness is advisory; unknown is a valid answer
        return (False, False)

    wanted = constants.OBSIDIAN_EXE_NAME.lower()
    running = any(_record_name(record).lower() == wanted for record in records)
    return (running, True)


# ---------------------------------------------------------------------------
# The probe (AC1 + AC2 + AC3)
# ---------------------------------------------------------------------------


def discover_instances(
    vault_paths: Mapping[str, str],
    registry_path: Optional[str] = None,
    process_lister: Optional[ProcessLister] = None,
) -> DiscoveryResult:
    """Resolve every configured role and report what already exists there.

    ``vault_paths`` maps role (:data:`~obsidian_e2e.constants.ROLE_A` /
    :data:`~obsidian_e2e.constants.ROLE_B`) to a configured vault path. Which vault is
    role ``a`` is *configuration*, not a decision this module makes (charter §2 non-goal).

    Everything is injectable — registry path, vault paths, process lister — so this runs
    unchanged against fixture vaults. Nothing is launched, attached to or provisioned
    (WP44/WP45), and nothing is written (AC4).
    """
    path = str(registry_path) if registry_path is not None else constants.VAULT_REGISTRY_PATH
    entries = _registry_entries(path)

    running, running_known = is_obsidian_running(process_lister)

    instances: dict = {}
    failures: list = []

    for role, configured in vault_paths.items():
        resolution = _resolve_against(configured, entries)

        # Probe the configured directory even when the registry does not vouch for it:
        # observing what is on disk is not the same as guessing a registry identity, and
        # the registry fields stay None in that case.
        probe_root = resolution.resolved_path or os.path.abspath(str(configured))
        plugin = inspect_plugin(probe_root)

        failure = resolution.failure
        if failure is None and plugin.state != constants.PLUGIN_OK:
            failure = plugin.state

        instance = VaultInstance(
            role=role,
            configured_path=str(configured),
            resolved_path=resolution.resolved_path,
            registry_id=resolution.registry_id,
            vault_name=resolution.vault_name,
            vault_exists=os.path.isdir(probe_root),
            plugin_present=plugin.present,
            plugin_enabled=plugin.enabled,
            plugin_e2e_capable=plugin.e2e_capable,
            plugin_state=plugin.state,
            ok=failure is None,
            failure=failure,
        )
        instances[role] = instance
        if failure is not None:
            failures.append(failure)

    return DiscoveryResult(
        registry_path=path,
        registry_available=entries is not None,
        obsidian_running=bool(running),
        obsidian_running_known=bool(running_known),
        instances=instances,
        ok=not failures,
        failures=tuple(failures),
    )
