"""WP45 — real-Obsidian launch **and attach** lifecycle (PHASE T3, component C45).

Outcome (charter §1): both roles reach a reachable control endpoint *without the owner
losing an open window or unsaved state*.

Acceptance criteria and how this module satisfies them:

- **AC1** — :func:`ensure_endpoints` probes each role's control endpoint first and then
  **attaches** to the window that answers, launching Obsidian only for a role whose
  endpoint is silent. Which of the two happened is an explicit ``mode`` field per role in
  the run record (``"attach"`` / ``"launch"``), plus ``launched_by_rig``; it is never
  inferred from a side effect. Both-attach, both-launch and mixed are the same code path.
- **AC2 (D15)** — this module contains **no** primitive that could end a process, and no
  door to one. It cannot: the rig-started registry and the single funnel that may act on
  it both live in :mod:`obsidian_e2e.teardown`, the module that owns the *end* of a run.
  WP45 owns the beginning, and a module that only starts things has nothing to say about
  ending them; the run record is the entire handover. The property is therefore
  structural and survives inspection: no OS process primitive, no command *string* for an
  interpreter to re-parse, no vocabulary for ending a process anywhere in this file — only
  the injected console seam. ``record["terminated"]`` is consequently ``[]`` on every
  outcome. A run that would need an already-open vault restarted stops under
  :data:`~obsidian_e2e.constants.RESTART_REQUIRED_OPERATOR` with an instruction that names
  the vault — the rig hands that decision to the operator instead of taking it.
- **AC3** — :func:`resolve_executable` *resolves* through an injectable existence check
  over an ordered candidate list; when nothing resolves the run stops under
  :data:`~obsidian_e2e.constants.LAUNCH_EXECUTABLE_MISSING` instead of a blind spawn.
  :func:`obsidian_uri` percent-encodes the vault name (``%20``, never ``+``) and
  :func:`build_launch_argv` returns a **list**, never a joined string — both vault paths
  contain spaces and a joined string is exactly what the Windows quoting trap shreds.
- **AC4** — every rig-started process goes through :func:`spawn_through_console`, the one
  sanctioned seam, which calls the injected ``visible-console`` surface and then awaits the
  console id it got back. No path in this module reaches an OS spawn primitive.

Everything is injectable — probe, console, executable resolver, instance descriptors — so
the whole module runs against fixtures and doubles and can be pointed at nothing real.

D13: every run record this module produces is stamped
:data:`~obsidian_e2e.constants.RIG_KIND_REAL_OBSIDIAN`, so it is structurally impossible to
confuse with a record from the headless mock rig (``tools/launch_liveshare_e2e.py``).
"""

from __future__ import annotations

import collections.abc
import os
import socket
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterable, Mapping, Optional, Sequence
from urllib.parse import quote

from . import constants

__all__ = [
    "RIG_KIND",
    "ENTRYPOINT_PATH",
    "MODE_ATTACH",
    "MODE_LAUNCH",
    "MODE_BLOCKED",
    "InstanceDescriptor",
    "descriptors_for",
    "descriptors_from_discovery",
    "obsidian_uri",
    "build_launch_argv",
    "resolve_executable",
    "default_probe",
    "role_order",
    "spawn_through_console",
    "PlanOnlyConsole",
    "plan_endpoints",
    "ensure_endpoints",
]

#: D13 — this module belongs to the real rig and stamps every record it produces.
RIG_KIND = constants.RIG_KIND_REAL_OBSIDIAN

#: The real-rig entrypoint, by **absolute** path (AC4). ``lifecycle.py`` lives in
#: ``<repo>/tools/obsidian_e2e/``, so the entrypoint is one directory up.
ENTRYPOINT_PATH = str(Path(__file__).resolve().parents[1] / "launch_obsidian_e2e.py")

# Per-role outcome vocabulary of the run record (AC1). These are WP45-local record
# values, not shared contract constants — nothing outside the record uses them.
MODE_ATTACH = "attach"  #: the endpoint answered; the rig did not start this window
MODE_LAUNCH = "launch"  #: the endpoint was silent; the rig started this window
MODE_BLOCKED = "blocked"  #: the run stopped before this role could be brought up

#: How long the sanctioned seam waits on a launch console before moving on. A launched
#: Obsidian keeps running on purpose, so a bounded wait is the expected outcome, not a
#: failure — WP46 owns readiness, this module only owns "started or attached".
DEFAULT_LAUNCH_AWAIT_TIMEOUT_S = 20

#: Connect timeout of the default control-endpoint probe.
DEFAULT_PROBE_TIMEOUT_S = 0.75


# ---------------------------------------------------------------------------
# Instance descriptors — the input side (charter §3: "the two provisioned
# instance descriptors"). Accepts mappings and attribute objects alike so a
# WP44 provisioning result, a fixture SimpleNamespace and the dataclass below
# are all valid inputs.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class InstanceDescriptor:
    """One role's provisioned instance: which vault, which control port, what state."""

    role: str
    vault_path: str
    vault_name: str
    control_port: int
    #: ``True`` when WP44 wrote the control port into ``data.json`` while that vault was
    #: **already open**. Obsidian loads plugin settings at window open and is
    #: single-instance, so the live window cannot have that port and no re-issued
    #: ``obsidian://open`` can give it one — only a restart could, and D15 forbids that.
    port_provisioned_while_running: bool = False


def _field(descriptor: object, name: str, default=None):
    """Read one field from a descriptor, mapping-shaped or attribute-shaped."""
    if isinstance(descriptor, collections.abc.Mapping):
        return descriptor.get(name, default)
    value = getattr(descriptor, name, default)
    return default if value is None and default is not None else value


def descriptors_for(
    vault_paths: Mapping[str, str],
    ports: Optional[Mapping[str, int]] = None,
    provisioned_while_running: Optional[Mapping[str, bool]] = None,
) -> list:
    """Build descriptors for the configured roles, in :data:`constants.ROLES` order."""
    port_map = ports if ports is not None else constants.REAL_CONTROL_PORTS
    open_map = provisioned_while_running or {}
    ordered = role_order(vault_paths)
    out = []
    for role in ordered:
        path = str(vault_paths[role])
        out.append(
            InstanceDescriptor(
                role=role,
                vault_path=path,
                vault_name=os.path.basename(os.path.abspath(path)) or path,
                control_port=int(port_map[role]),
                port_provisioned_while_running=bool(open_map.get(role, False)),
            )
        )
    return out


def descriptors_from_discovery(
    discovery: object,
    ports: Optional[Mapping[str, int]] = None,
    provisioned_while_running: Optional[Mapping[str, bool]] = None,
) -> list:
    """Turn a WP43 :class:`~obsidian_e2e.vaults.DiscoveryResult` into descriptors.

    The vault *name* comes from the registry resolution when there is one — that is the
    name Obsidian itself knows, and it is what the ``obsidian://open`` URI must carry.
    """
    port_map = ports if ports is not None else constants.REAL_CONTROL_PORTS
    open_map = provisioned_while_running or {}
    instances = _field(discovery, "instances", {}) or {}
    ordered = role_order(instances)
    out = []
    for role in ordered:
        instance = instances[role]
        path = _field(instance, "resolved_path") or _field(instance, "configured_path") or ""
        name = _field(instance, "vault_name") or os.path.basename(os.path.abspath(str(path)))
        out.append(
            InstanceDescriptor(
                role=role,
                vault_path=str(path),
                vault_name=str(name),
                control_port=int(port_map[role]),
                port_provisioned_while_running=bool(open_map.get(role, False)),
            )
        )
    return out


# ---------------------------------------------------------------------------
# AC3 — URI construction and argv construction
# ---------------------------------------------------------------------------


def obsidian_uri(vault_name: str) -> str:
    """``obsidian://open?vault=<url-encoded name>`` (contract §9, AC3).

    ``quote(..., safe="")`` encodes a space as ``%20``. The form encoding ``+`` would be
    wrong here: Obsidian parses this as a URI component, not as form data, so
    ``LiveShare-E2E-B`` opens nothing. Unreserved characters (``-``, ``_``, ``.``,
    ``~``) are left alone, so a plain vault name comes back unchanged.
    """
    return constants.OBSIDIAN_OPEN_URI_TEMPLATE.format(vault=quote(str(vault_name), safe=""))


def build_launch_argv(executable: str, vault_name: str) -> list:
    """Argument vector that opens ``vault_name`` — a **list**, never a joined string.

    Both target vault paths contain spaces. A joined command *string* has to be quoted,
    and a quoted path with spaces is exactly what the documented Windows nested-quote trap
    breaks on. A list has no quoting to get wrong: every element is one argument.
    """
    return [str(executable), obsidian_uri(vault_name)]


def resolve_executable(*candidates, exists: Optional[Callable[[str], bool]] = None):
    """Resolve the Obsidian executable, or ``None`` when nothing resolves (AC3).

    The path pinned in :data:`constants.OBSIDIAN_EXE_PATH` is a *candidate*, not a fact —
    a relocated or portable installation must win over it, and a machine without Obsidian
    must yield ``None`` (which the caller reports as
    :data:`~obsidian_e2e.constants.LAUNCH_EXECUTABLE_MISSING`) rather than a blind spawn of
    a path nobody checked.

    ``exists`` is injectable so this is testable without an Obsidian installation; it
    defaults to :func:`os.path.isfile`. Explicit ``candidates`` are tried first, then
    ``OBSIDIAN_EXE`` from the environment, then the pinned path, then the standard
    per-user and machine-wide install locations. The candidate string is returned exactly
    as it was offered — callers compare it against the pinned value.
    """
    check = exists if exists is not None else os.path.isfile

    ordered: list = [str(c) for c in candidates if c]

    from_env = os.environ.get("OBSIDIAN_EXE")
    if from_env:
        ordered.append(str(from_env))

    ordered.append(constants.OBSIDIAN_EXE_PATH)

    for env_key, parts in (
        ("LOCALAPPDATA", ("Programs", "Obsidian", constants.OBSIDIAN_EXE_NAME)),
        ("PROGRAMFILES", ("Obsidian", constants.OBSIDIAN_EXE_NAME)),
        ("PROGRAMFILES(X86)", ("Obsidian", constants.OBSIDIAN_EXE_NAME)),
    ):
        root = os.environ.get(env_key)
        if root:
            ordered.append(os.path.join(root, *parts))

    seen: set = set()
    for candidate in ordered:
        if candidate in seen:
            continue
        seen.add(candidate)
        try:
            found = bool(check(candidate))
        except OSError:
            found = False
        if found:
            return candidate
    return None


# ---------------------------------------------------------------------------
# AC1 — the control-endpoint probe
# ---------------------------------------------------------------------------


def default_probe(
    role: str,
    port: int,
    host: str = constants.CONTROL_HOST,
    timeout: float = DEFAULT_PROBE_TIMEOUT_S,
) -> bool:
    """Does this role's control endpoint answer? Read-only: it connects and hangs up.

    A refused connection means *nothing is listening on that port*. It does **not** mean
    Obsidian is absent, the vault is wrong or the plugin is broken — contract §1.1: the
    installed production build has the control server tree-shaken out and will never
    answer whatever port is provisioned. That state is
    :data:`~obsidian_e2e.constants.PLUGIN_NOT_E2E_CAPABLE` and WP43's ``vaults`` module is
    what reports it; this probe only reports reachability.
    """
    del role  # the role is part of the signature so callers can log/route on it
    try:
        with socket.create_connection((host, int(port)), timeout=timeout):
            return True
    except OSError:
        return False


# ---------------------------------------------------------------------------
# AC4 — the one sanctioned process seam
# ---------------------------------------------------------------------------


def spawn_through_console(
    console,
    argv: list,
    title: str = "",
    await_timeout: Optional[float] = DEFAULT_LAUNCH_AWAIT_TIMEOUT_S,
) -> tuple:
    """Start ``argv`` through the ``visible-console`` surface and await its console id.

    This is the **only** function in the rig permitted to reach a process-starting
    primitive, and it does not need one: it hands the argv list to the injected
    ``visible-console`` seam (``run_command`` / ``run_python``) and then calls
    ``await_console`` on the id it got back. A spawn that is never awaited is a
    background process wearing a console costume, so the await is part of the seam and
    not the caller's responsibility.

    ``console`` is always injected, which is what makes it impossible for a test — or a
    dev loop — to reach the real Obsidian executable by accident.
    """
    if not isinstance(argv, list):
        raise TypeError(f"argv must be a list, got {type(argv).__name__}")
    if not all(isinstance(part, str) for part in argv):
        raise TypeError("every argv element must be a string")

    console_id = console.run_command(argv, title=title)
    result = console.await_console(console_id, timeout=await_timeout)
    return console_id, result


class PlanOnlyConsole:
    """A ``visible-console`` seam that **plans** the calls instead of making them.

    The rig runs as a plain Python process and has no MCP client, so it cannot call
    ``visible-console`` itself. Rather than quietly falling back to a direct spawn — which
    is exactly what AC4 forbids — this seam records the calls and emits the MCP payloads
    for the operator or agent driving the run. Nothing is started here.

    Every payload carries the **argv list**, verbatim, and no rendered command line. Two
    reasons, and the first is the binding one: rendering argv into a single command
    *string* produces exactly the artefact this module must not contain — a line built for
    an OS interpreter to re-parse, which is a launch vector one call site away from being
    used. The second is practical: both target vault names contain spaces, and the
    documented Windows wrapper shreds precisely the quoting such a rendering would need.
    The driver holds the argv and hands it to whichever console surface it uses.
    """

    CONSOLE_BACKEND = "plan-only"

    def __init__(self, emit: Optional[Callable[[dict], None]] = None) -> None:
        self.requests: list = []
        self._emit = emit
        self._n = 0

    def _record(self, payload: dict) -> None:
        self.requests.append(payload)
        if self._emit is not None:
            self._emit(payload)

    def run_command(self, argv: list, title: str = "") -> str:
        if not isinstance(argv, list):
            raise TypeError(f"argv must be a list, got {type(argv).__name__}")
        self._n += 1
        console_id = f"plan-only-{self._n}"
        self._record(
            {
                "planned": True,
                "console_id": console_id,
                "argv": list(argv),
                "mcp": {
                    "server_id": "visible-console",
                    "tool_name": "run_command",
                    "arguments": {
                        "argv": list(argv),
                        "title": title or "obsidian-e2e",
                        "layout": "simple",
                    },
                },
            }
        )
        return console_id

    def run_python(self, script, args: Optional[Sequence[str]] = None, title: str = "") -> str:
        self._n += 1
        console_id = f"plan-only-{self._n}"
        self._record(
            {
                "planned": True,
                "console_id": console_id,
                "argv": [str(script), *[str(a) for a in (args or ())]],
                "mcp": {
                    "server_id": "visible-console",
                    "tool_name": "run_python",
                    "arguments": {
                        "script": str(script),
                        "args": [str(a) for a in (args or ())],
                        "title": title or "obsidian-e2e",
                        "layout": "simple",
                    },
                },
            }
        )
        return console_id

    def await_console(self, console_id: str, timeout: Optional[float] = None) -> dict:
        self._record(
            {
                "planned": True,
                "console_id": str(console_id),
                "mcp": {
                    "server_id": "visible-console",
                    "tool_name": "await_console",
                    "arguments": {
                        "console_id": str(console_id),
                        "timeout_s": int(timeout or DEFAULT_LAUNCH_AWAIT_TIMEOUT_S),
                    },
                },
            }
        )
        return {"console_id": str(console_id), "planned": True, "exit_code": None}


# ---------------------------------------------------------------------------
# The lifecycle itself
# ---------------------------------------------------------------------------


def role_order(roles: Iterable[str]) -> list:
    """Canonical order for a set of roles: contract order first, then anything else.

    Used everywhere the record lists roles, so the record depends on *which* roles a run
    had and never on the order the caller happened to hand them over in. Two runs that
    discovered the two instances in opposite orders produce the same lists, and a diff
    between two run records shows real differences only.
    """
    seen = [str(role) for role in roles]
    known = [role for role in constants.ROLES if role in seen]
    extra = sorted({role for role in seen if role not in constants.ROLES})
    return known + extra


def _entry(descriptor) -> dict:
    port = _field(descriptor, "control_port")
    return {
        "role": str(_field(descriptor, "role")),
        "vault_name": _field(descriptor, "vault_name"),
        "vault_path": _field(descriptor, "vault_path"),
        # Vault identity and control port travel together in the same per-role entry, so
        # role -> (vault, port) is *read* off the record and never re-derived from a
        # positional list or a second lookup that could disagree with it. ``port`` is the
        # name the shared contract pins for the record; ``control_port`` is the descriptor
        # field name, kept so a consumer of either spelling reads the same number.
        "port": port,
        "control_port": port,
        "port_provisioned_while_running": bool(
            _field(descriptor, "port_provisioned_while_running", False)
        ),
        "endpoint_answered": None,
        # ``mode`` is what actually happened; ``planned_mode`` is what the probe decided
        # should happen. They differ exactly when a run stopped before acting, which is
        # the case a single field would blur into "we launched it" (AC1).
        "planned_mode": None,
        "mode": MODE_BLOCKED,
        "launched_by_rig": False,
        "console_id": None,
        "uri": None,
        "argv": None,
        "reason": None,
    }


def _operator_instruction(entries: Sequence[dict]) -> str:
    lines = [
        "RESTART_REQUIRED_OPERATOR — the rig stopped instead of restarting a window it "
        "did not start (D15).",
    ]
    for entry in entries:
        lines.append(
            f"  - role {entry['role']}: vault '{entry['vault_name']}' is already open in "
            f"Obsidian, and its control port {entry['control_port']} was provisioned "
            "after that window opened. Obsidian reads plugin settings at window open and "
            "is single-instance, so the live window cannot serve that port and no "
            "re-issued obsidian://open URI can give it one."
        )
    lines.append(
        "Operator action: save your work, quit that Obsidian window yourself, then re-run "
        "this rig — it will open the vault fresh with the provisioned port. The rig leaves "
        "that decision to you (D15); it never makes it for you."
    )
    return "\n".join(lines)


def plan_endpoints(instances: Iterable, probe: Optional[Callable] = None) -> dict:
    """Probe every role and return what the rig *would* do — without doing any of it.

    Same decision logic as :func:`ensure_endpoints`, minus the launching. The real-rig
    entrypoint uses this for its default read-only mode, so a run can be inspected before
    anything is started.
    """
    probe_fn = probe if probe is not None else default_probe

    # Role-keyed from the first line: the descriptors are indexed by their own ``role``
    # field and then walked in canonical order, so "which instance is role b" is answered
    # by the descriptor and never by its position in the input sequence.
    # Two orders, deliberately different, and neither is an accident:
    #
    # ├── ACTING order is the caller's. The caller may have a reason to bring one vault up
    # │   first, and the rig has none to override it. So probing, and the launches that
    # │   follow from it, walk the sequence exactly as it was handed over.
    # └── RECORD order is canonical. The record is a *description*, and a description that
    #     changes when the same two instances are discovered in the other order is one
    #     nobody can diff. Roles are keyed by their own ``role`` field and the record's
    #     lists are emitted in :func:`role_order`.
    supplied: list = [_entry(descriptor) for descriptor in instances]
    by_role: dict = {entry["role"]: entry for entry in supplied}

    roles: dict = {}
    needs_launch: list = []
    restart_required: list = []

    for entry in supplied:
        answered = bool(probe_fn(entry["role"], entry["control_port"]))
        entry["endpoint_answered"] = answered
        if answered:
            # Attach. The rig did not start this window, so it never records it as
            # rig-started and nothing downstream is even able to act on it (D15).
            entry["mode"] = MODE_ATTACH
            entry["planned_mode"] = MODE_ATTACH
        elif entry["port_provisioned_while_running"]:
            entry["planned_mode"] = MODE_BLOCKED
            entry["reason"] = constants.RESTART_REQUIRED_OPERATOR
            restart_required.append(entry)
        else:
            entry["planned_mode"] = MODE_LAUNCH
            needs_launch.append(entry)

    # Record side: role-keyed, canonical order, whatever order the input arrived in.
    for role in role_order(by_role):
        roles[role] = by_role[role]

    return {
        "roles": roles,
        "needs_launch": role_order(entry["role"] for entry in needs_launch),
        "restart_required": role_order(entry["role"] for entry in restart_required),
        # The private entry lists keep the caller's order: they drive the *actions*.
        "_needs_launch_entries": needs_launch,
        "_restart_required_entries": restart_required,
    }


def ensure_endpoints(
    instances: Iterable,
    probe: Optional[Callable] = None,
    console=None,
    resolve_exe: Optional[Callable] = None,
    title_prefix: str = "obsidian-e2e",
    await_timeout: Optional[float] = DEFAULT_LAUNCH_AWAIT_TIMEOUT_S,
    run_id: Optional[str] = None,
) -> dict:
    """Bring every role to a reachable control endpoint: attach first, launch only if not.

    Returns the **run record**, which is the oracle for the whole work package:

    ``rig_kind``
        Always :data:`~obsidian_e2e.constants.RIG_KIND_REAL_OBSIDIAN` (D13).
    ``ok`` / ``reason`` / ``operator_instruction``
        Outcome, and when the run halts the pinned §7 reason plus what the operator should do.
    ``roles``
        Role-keyed, in :func:`role_order`. Per role: its own ``vault_name`` / ``vault_path``
        **and** its own ``port`` (``control_port`` under both spellings), ``mode``
        (``attach`` / ``launch`` / ``blocked``), ``launched_by_rig``, ``console_id``,
        ``endpoint_answered``, the launch ``argv`` and the ``uri``. Everything a caller
        needs to address one role is in that role's entry — nothing is positional, and
        handing the two instances over in the opposite order yields the same record.
    ``terminated``
        Always ``[]``. This module has no way to produce anything else (D15).

    Order of operations matters and is deliberate: **probe every role first**, then decide,
    then act. A halt therefore happens before anything has been started, which is why the
    abort paths leave the console untouched and leave an attached window attached.
    """
    started_at = datetime.now(timezone.utc)
    plan = plan_endpoints(instances, probe=probe)
    roles = plan["roles"]

    record = {
        "rig_kind": RIG_KIND,
        "run_id": run_id or constants.new_run_id(),
        "entrypoint": ENTRYPOINT_PATH,
        "console_backend": getattr(console, "CONSOLE_BACKEND", type(console).__name__),
        "started_at": started_at.isoformat(),
        "ok": True,
        "reason": None,
        "operator_instruction": None,
        "roles": roles,
        "attached": [r for r, e in roles.items() if e["mode"] == MODE_ATTACH],
        "launched": [],
        "terminated": [],
    }

    # --- AC2: a run that would need a restart stops, and stops before acting ---------
    if plan["_restart_required_entries"]:
        record["ok"] = False
        record["reason"] = constants.RESTART_REQUIRED_OPERATOR
        record["operator_instruction"] = _operator_instruction(
            plan["_restart_required_entries"]
        )
        return record

    pending = plan["_needs_launch_entries"]
    if not pending:
        # Everybody answered: pure attach. The executable is never even resolved —
        # nothing is going to be started, so asking where Obsidian lives is noise.
        return record

    # --- AC3: resolve, never assume -------------------------------------------------
    resolver = resolve_exe if resolve_exe is not None else resolve_executable
    executable = resolver()
    if not executable:
        record["ok"] = False
        record["reason"] = constants.LAUNCH_EXECUTABLE_MISSING
        record["operator_instruction"] = (
            "LAUNCH_EXECUTABLE_MISSING — the Obsidian executable could not be resolved. "
            f"Checked the pinned path {constants.OBSIDIAN_EXE_PATH!r}, $OBSIDIAN_EXE and "
            "the standard install locations. Install Obsidian or pass --exe <path>. "
            "Nothing was started."
        )
        for entry in pending:
            entry["reason"] = constants.LAUNCH_EXECUTABLE_MISSING
        return record

    record["executable"] = str(executable)

    # --- AC1 + AC4: launch the silent roles, one console each, each one awaited ------
    for entry in pending:
        argv = build_launch_argv(executable, entry["vault_name"])
        console_id, result = spawn_through_console(
            console,
            argv,
            title=f"{title_prefix} {entry['role']} {entry['vault_name']}",
            await_timeout=await_timeout,
        )
        entry["mode"] = MODE_LAUNCH
        entry["launched_by_rig"] = True
        entry["console_id"] = console_id
        entry["argv"] = argv
        entry["uri"] = argv[-1]
        entry["console_result"] = result
        record["launched"].append(entry["role"])

    # Launches happen in the caller's order; the record reports them in canonical order,
    # so two runs that brought the same two roles up in opposite orders read alike.
    record["launched"] = role_order(record["launched"])

    # The record is the whole handover: a role with ``launched_by_rig`` and a
    # ``console_id`` is one the rig started, and the module that owns the end of the run
    # reads that off the record. Nothing is tagged here, because a tag is only useful to
    # something able to act on it and this module is deliberately not that.
    record["rig_started_consoles"] = len(record["launched"])
    return record
