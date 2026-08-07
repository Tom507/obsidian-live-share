#!/usr/bin/env python3
"""WP45 — the **real-Obsidian** E2E rig entrypoint (decision D13).

This is the only entrypoint that can satisfy the CONCEPT_V2 Teil-14 gate. Its sibling,
``tools/launch_liveshare_e2e.py``, is the fast **headless mock rig**: it boots two
lightweight plugin hosts against a stand-in for the ``obsidian`` module, and a green run
there proves nothing about real Obsidian. The two are kept apart on purpose — different
entrypoint, different control ports (39431/39432 vs 39421/39422) and a different
``rig_kind`` stamped into every run record.

What it does (WP45 scope only):

1. runs WP43's **read-only** vault probe and reports what is actually installed, including
   contract §1.1's ``PLUGIN_NOT_E2E_CAPABLE`` — a production build has the control server
   tree-shaken out and will never answer a control port, however it is provisioned. That
   is a named precondition, never a launch failure and never a timeout;
2. probes each role's control endpoint and **attaches** to whatever already answers;
3. launches Obsidian only for a role that does not answer, through the ``visible-console``
   seam, with the vault name URL-encoded into an ``obsidian://open`` URI and the argv built
   as a list.

WP48 adds the two ends of the run around that:

0. **start-up reclaim** (AC4) — before anything is probed, the artefacts of a previous
   crashed run are detected and cleared for every configured vault: a leftover provisioned
   port setting (the saved original goes back byte-exactly), a stale scratch canvas, and a
   bound but dead control port. Reclaiming is idempotent, so running it twice changes
   nothing. It writes into the vault, so it is **off in the default read-only mode** and on
   for ``--allow-launch`` (or explicitly via ``--reclaim`` / off via ``--no-reclaim``);
4. **teardown on every exit path** (AC1) — success, assertion failure, exception and
   interruption all run ``restore provisioned settings → remove scratch artefacts → stop
   only rig-started processes`` exactly once, in that order. A mid-run endpoint that stops
   answering fails the run under ``ENDPOINT_LOST_MIDRUN``, still completes teardown, and
   still exits **non-zero** (AC3): a partially executed run is never a green gate result.

What it never does: close, terminate or restart a process or window it did not itself
start (D15). A run that would need that stops under ``RESTART_REQUIRED_OPERATOR`` and
prints what the operator has to do. Teardown is bound by the same rule and routes every
stop through ``teardown.request_process_stop``, which refuses any handle the rig did not
tag itself — so ``terminated`` is empty on every path this entrypoint can take.

Readiness is **not** decided here — a reachable port is not a ready instance; that is WP46.

Usage — always by absolute path, through the workspace ``visible-console`` tools::

    run_python(script=r"<repo>\\tools\\launch_obsidian_e2e.py", args=["--json"])

Default mode is read-only: it probes and prints the plan. Pass ``--allow-launch`` to
actually dispatch the launches.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

#: AC4 — the rig entrypoint is referenced by **absolute** path. ``run_python`` resolves a
#: relative script against the wrapper's working directory, not the script's own.
ENTRYPOINT_PATH = Path(__file__).resolve()

# Contract §0.2: the one sanctioned import form. ``import tools.obsidian_e2e`` resolves to
# the *workspace* ``tools`` package in this environment, so the repo's own tools directory
# goes on sys.path and the package is imported top-level.
TOOLS_DIR = ENTRYPOINT_PATH.parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from obsidian_e2e import (  # noqa: E402
    constants,
    lifecycle,
    ports,
    readiness,
    scratch,
    teardown,
    vaults,
)

#: D13 — stamped into every run record this entrypoint produces.
RIG_KIND = constants.RIG_KIND_REAL_OBSIDIAN

# ASCII only: this banner is printed on consoles whose code page is not UTF-8.
REAL_BANNER = (
    "real-obsidian rig (WP45) - drives REAL Obsidian windows on this host. This is the "
    "only entrypoint that can satisfy the Teil-14 gate. It attaches to whatever is "
    "already open and never closes, terminates or restarts a window it did not start "
    "(D15)."
)

#: Plugin states that make a real run pointless before it starts. They are reported as the
#: named state WP43 produced, never re-labelled as a launch failure or a timeout.
BLOCKING_PLUGIN_STATES = (
    constants.PLUGIN_MISSING,
    constants.PLUGIN_PRESENT_BUT_DISABLED,
    constants.PLUGIN_NOT_E2E_CAPABLE,
)


def _roles_arg(value: str) -> list:
    roles = [part.strip() for part in str(value).split(",") if part.strip()]
    unknown = [role for role in roles if role not in constants.ROLES]
    if unknown:
        raise argparse.ArgumentTypeError(f"unknown role(s) {unknown}; known: {constants.ROLES}")
    return roles


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog=ENTRYPOINT_PATH.name,
        description=REAL_BANNER,
        epilog=(
            "Sibling entrypoint: tools/launch_liveshare_e2e.py is the headless mock rig "
            "and cannot satisfy the Teil-14 gate."
        ),
    )
    parser.add_argument("--vault-a", help=f"vault for role a (default {constants.REAL_VAULT_PATH_A})")
    parser.add_argument("--vault-b", help=f"vault for role b (default {constants.REAL_VAULT_PATH_B})")
    parser.add_argument("--port-a", type=int, help=f"control port role a (default {constants.REAL_CONTROL_PORT_A})")
    parser.add_argument("--port-b", type=int, help=f"control port role b (default {constants.REAL_CONTROL_PORT_B})")
    parser.add_argument("--roles", type=_roles_arg, default=list(constants.ROLES), help="subset of roles, e.g. 'a' or 'a,b'")
    parser.add_argument("--exe", help="explicit Obsidian executable; still checked for existence, never assumed")
    parser.add_argument("--registry", help="vault registry path (read-only); defaults to %%APPDATA%%\\obsidian\\obsidian.json")
    parser.add_argument(
        "--provisioned-while-running",
        type=_roles_arg,
        default=[],
        help="roles whose control port WP44 provisioned while that vault was already open",
    )
    parser.add_argument("--probe-timeout", type=float, default=lifecycle.DEFAULT_PROBE_TIMEOUT_S, help="control-endpoint connect timeout in seconds")
    parser.add_argument(
        "--allow-launch",
        action="store_true",
        help="dispatch launches for roles whose endpoint is silent (default: probe and plan only)",
    )
    parser.add_argument(
        "--ignore-plugin-state",
        action="store_true",
        help="proceed even when the installed plugin cannot host a control endpoint",
    )
    parser.add_argument(
        "--reclaim",
        action="store_true",
        help=(
            "clear the artefacts of a previous crashed run before probing (WP48 AC4). "
            "This WRITES into the configured vaults, so it is off in the default read-only "
            "mode and implied by --allow-launch"
        ),
    )
    parser.add_argument(
        "--no-reclaim",
        action="store_true",
        help="never reclaim, not even with --allow-launch (--no-reclaim wins over --reclaim)",
    )
    parser.add_argument(
        "--reclaim-timeout",
        type=float,
        default=teardown.DEFAULT_RECLAIM_TIMEOUT_S,
        help="bounded budget, in seconds, for the one wait reclaim performs (WP48 AC2)",
    )
    parser.add_argument("--json", action="store_true", help="print the run record as JSON")
    return parser


def _vault_paths(args) -> dict:
    configured = {
        constants.ROLE_A: args.vault_a or constants.REAL_VAULT_PATH_A,
        constants.ROLE_B: args.vault_b or constants.REAL_VAULT_PATH_B,
    }
    return {role: configured[role] for role in args.roles}


def _ports(args) -> dict:
    ports = dict(constants.REAL_CONTROL_PORTS)
    if args.port_a is not None:
        ports[constants.ROLE_A] = args.port_a
    if args.port_b is not None:
        ports[constants.ROLE_B] = args.port_b
    return ports


def _precondition_report(discovery) -> dict:
    """Flatten WP43's read-only probe into the run record's ``preconditions`` block."""
    roles = {}
    for role, instance in discovery.instances.items():
        roles[role] = {
            "configured_path": instance.configured_path,
            "resolved_path": instance.resolved_path,
            "vault_name": instance.vault_name,
            "vault_exists": instance.vault_exists,
            "registry_id": instance.registry_id,
            "plugin_state": instance.plugin_state,
            "plugin_present": instance.plugin_present,
            "plugin_enabled": instance.plugin_enabled,
            "plugin_e2e_capable": instance.plugin_e2e_capable,
            "failure": instance.failure,
        }
    return {
        "registry_path": discovery.registry_path,
        "registry_available": discovery.registry_available,
        "obsidian_running": discovery.obsidian_running,
        "obsidian_running_known": discovery.obsidian_running_known,
        "roles": roles,
        "ok": discovery.ok,
        "failures": list(discovery.failures),
    }


def _blocking_state(preconditions: dict):
    """First blocking precondition as ``(role, state)``, or ``None``."""
    for role, entry in preconditions["roles"].items():
        state = entry.get("failure") or entry.get("plugin_state")
        if state in BLOCKING_PLUGIN_STATES or state in (
            constants.VAULT_NOT_IN_REGISTRY,
            constants.VAULT_PATH_MISSING,
        ):
            return role, state
    return None


# ---------------------------------------------------------------------------
# WP48 — the seams teardown and reclaim reach the real world through. Every one of them is
# a parameter somewhere, so a test never has to touch a vault, a socket or a process.
# ---------------------------------------------------------------------------


class _ControlPortProbe:
    """``is_bound`` / ``answers_control`` / ``owner_pid`` for a real control port.

    ``is_bound`` reuses WP45's connect-and-hang-up probe and ``answers_control`` reuses
    WP46's inverted readiness probe, so this entrypoint owns no probe logic of its own and
    the two directions cannot drift apart.

    ``owner_pid`` returns ``None`` **on purpose**. Mapping a listening port to its holder
    needs an OS query this rig has no sanctioned primitive for, and under D15 an unknown
    owner is not a rig-owned one: a bound-but-silent port is therefore *reported* to the
    operator, never force-reclaimed. A caller that can supply a real owner lookup passes its
    own probe to :func:`teardown.reclaim_stale_state` — the seam exists for exactly that.
    """

    def __init__(self, role: str, timeout_s: float) -> None:
        self.role = role
        self.timeout_s = float(timeout_s)

    def is_bound(self, port: int) -> bool:
        return bool(lifecycle.default_probe(self.role, port, timeout=self.timeout_s))

    def answers_control(self, port: int) -> bool:
        endpoint = {self.role: f"http://{constants.CONTROL_HOST}:{int(port)}"}
        return not readiness.check_endpoints_gone(endpoint, self.timeout_s).ready

    def owner_pid(self, port: int):
        del port
        return None


class _RigTeardownIO:
    """The three teardown primitives, wired to the modules that own them.

    ├── ``restore_setting``   → WP44 ``ports.restore_port``  (byte-exact, verified by sha256)
    ├── ``remove_scratch``    → WP47's write guard, then a single ``unlink``
    └── ``terminate_process`` → WP48 ``teardown.request_process_stop``

    The stop primitive is the important one: it refuses any handle that is not in the
    rig-started registry, and this entrypoint only ever tags a handle it launched itself
    through a console backend that really starts something. There is no other stop call in
    this file — no OS termination primitive of any kind, no process sweep — so a window the
    rig did not
    start cannot be reached from here at all.
    """

    def __init__(self, registry, console=None) -> None:
        self._registry = registry
        self._console = console

    @staticmethod
    def _field(record, name: str):
        if isinstance(record, dict):
            return record.get(name)
        return getattr(record, name, None)

    def restore_setting(self, record) -> None:
        vault_path = self._field(record, "vault_path")
        if not vault_path:
            raise ValueError("a provisioned-settings record must name its vault_path")
        ports.restore_port(vault_path)

    def remove_scratch(self, artefact) -> None:
        vault_path = self._field(artefact, "vault_path")
        relpath = self._field(artefact, "relpath")
        if not vault_path or not relpath:
            raise ValueError("a scratch artefact must name its vault_path and relpath")
        vault = Path(vault_path)
        target = vault / relpath
        scratch.assert_write_allowed(vault, target)  # refuses anything outside the rig folder
        if target.is_file():
            target.unlink()

    def terminate_process(self, handle) -> None:
        outcome = teardown.request_process_stop(handle, self._registry, self._console)
        if not outcome.get("stopped"):
            raise RuntimeError(outcome.get("why") or f"the rig refused to stop {handle!r}")


def _reclaim_requested(args) -> bool:
    """Reclaim writes into the vault, so it is opt-in; ``--no-reclaim`` always wins."""
    if args.no_reclaim:
        return False
    return bool(args.reclaim or args.allow_launch)


def _startup_reclaim(args, vault_paths: dict, port_map: dict) -> dict:
    """WP48 AC4 — clear a previous crashed run's artefacts before this run starts.

    Per vault and idempotent: a settings file still carrying the provisioned port, a stale
    scratch canvas, and a control port that is bound but no longer answering. Running it
    twice is a no-op, so it is safe to leave on for every launching run.
    """
    if not _reclaim_requested(args):
        return {
            "performed": False,
            "why": "read-only mode; pass --reclaim (or --allow-launch) to clear crash artefacts",
            "roles": {},
        }

    roles: dict = {}
    for role, vault_path in vault_paths.items():
        vault = Path(vault_path)
        if not vault.is_dir():
            roles[role] = {"skipped": constants.VAULT_PATH_MISSING, "vault_path": str(vault)}
            continue
        report = teardown.reclaim_stale_state(
            vault,
            ports=(port_map[role],),
            port_probe=_ControlPortProbe(role, args.probe_timeout),
            process_control=None,  # no sanctioned owner lookup: report, never force (D15)
            timeout_s=args.reclaim_timeout,
        )
        roles[role] = report.to_dict()
    return {"performed": True, "why": None, "roles": roles}


def _register_endpoint_processes(record: dict, runner, registry, console) -> None:
    """Put every endpoint this run touched into teardown's ledger, tagged honestly.

    An attached window is recorded with ``rig_started=False`` so it appears in the teardown
    record as *skipped* rather than silently missing — D15 is a decision the record should
    show, not an omission. A launched role is only tagged rig-started when the console
    backend actually started something: :class:`lifecycle.PlanOnlyConsole` emits the MCP
    payload for the operator and starts nothing, so there is nothing to stop and nothing is
    tagged.
    """
    backend_starts_processes = getattr(console, "CONSOLE_BACKEND", "") != "plan-only"
    for role, entry in (record.get("roles") or {}).items():
        console_id = entry.get("console_id")
        if entry.get("launched_by_rig") and console_id:
            rig_started = backend_starts_processes
            if rig_started:
                registry.tag(console_id, role)
            runner.register_process(
                teardown.ProcessRecord(
                    pid=console_id,
                    role=role,
                    rig_started=rig_started,
                    label="visible-console"
                    if rig_started
                    else "planned console (nothing was started)",
                )
            )
        elif entry.get("endpoint_answered"):
            runner.register_process(
                teardown.ProcessRecord(
                    pid=f"attached:{role}",
                    role=role,
                    rig_started=False,
                    label="attached window — the rig did not start it (D15)",
                )
            )


def _verify_endpoints_still_answer(record: dict, args) -> None:
    """WP48 AC3 — an endpoint that answered before must still answer at the end.

    Raises :class:`teardown.EndpointLostMidrun`, which :func:`teardown.run_with_teardown`
    turns into a named failure reason, a completed teardown and a non-zero exit status. A
    role that never answered is not "lost": that is the launch path, not a crash.
    """
    watched = {
        role: entry["control_port"]
        for role, entry in (record.get("roles") or {}).items()
        if entry.get("endpoint_answered")
    }
    if not watched:
        return
    teardown.check_endpoints_alive(
        lambda role: lifecycle.default_probe(role, watched[role], timeout=args.probe_timeout),
        tuple(watched),
    )


def _print_human(record: dict) -> None:
    print(f"[rig] rig_kind      : {record['rig_kind']}")
    print(f"[rig] entrypoint    : {record['entrypoint']}")
    print(f"[rig] run_id        : {record['run_id']}")
    print(f"[rig] mode          : {record['run_mode']}")
    pre = record.get("preconditions") or {}
    for role, entry in (pre.get("roles") or {}).items():
        print(
            f"[rig] role {role} vault : {entry['vault_name']!r} "
            f"exists={entry['vault_exists']} plugin={entry['plugin_state']}"
        )
    for role, entry in record["roles"].items():
        print(
            f"[rig] role {role} endpoint: port={entry['control_port']} "
            f"answered={entry['endpoint_answered']} planned={entry['planned_mode']} "
            f"mode={entry['mode']} launched_by_rig={entry['launched_by_rig']} "
            f"console={entry['console_id']}"
        )
    print(f"[rig] terminated    : {record['terminated']}  (D15: always empty)")
    print(f"[rig] ok            : {record['ok']}  reason={record['reason']}")
    if record.get("operator_instruction"):
        print("[rig] operator instruction:")
        print(record["operator_instruction"])
    for request in record.get("console_requests") or []:
        print("[rig] visible-console call to make:")
        print("      " + json.dumps(request["mcp"], ensure_ascii=False))
    reclaim = record.get("reclaim") or {}
    if reclaim.get("performed"):
        for role, report in (reclaim.get("roles") or {}).items():
            print(
                f"[rig] reclaim {role}   : actions={report.get('actions', 0)} "
                f"artefacts={len(report.get('artefacts') or [])}"
            )
    else:
        print(f"[rig] reclaim       : skipped ({reclaim.get('why')})")
    outcome = record.get("run_outcome") or {}
    down = outcome.get("teardown") or {}
    print(f"[rig] teardown      : steps={down.get('steps_run')} ok={down.get('ok')}")
    print(
        f"[rig] verdict       : green={outcome.get('green')} "
        f"exit_status={outcome.get('exit_status')} reason={outcome.get('failure_reason')}"
    )


def _run(args, runner, console, registry) -> dict:
    """The run itself. Whatever it does or raises, ``main`` tears down afterwards."""
    vault_paths = _vault_paths(args)
    port_map = _ports(args)

    # --- WP48 AC4: clear a previous crashed run's artefacts BEFORE anything is probed --
    reclaim = _startup_reclaim(args, vault_paths, port_map)

    discovery = vaults.discover_instances(vault_paths, registry_path=args.registry)
    preconditions = _precondition_report(discovery)

    descriptors = lifecycle.descriptors_from_discovery(
        discovery,
        ports=port_map,
        provisioned_while_running={role: True for role in args.provisioned_while_running},
    )

    def probe(role, port):
        return lifecycle.default_probe(role, port, timeout=args.probe_timeout)

    blocking = _blocking_state(preconditions)

    # --- read-only default: probe, plan, print, change nothing ----------------------
    if not args.allow_launch:
        plan = lifecycle.plan_endpoints(descriptors, probe=probe)
        record = {
            "rig_kind": RIG_KIND,
            "run_id": constants.new_run_id(),
            "entrypoint": str(ENTRYPOINT_PATH),
            "run_mode": "plan-only (no --allow-launch)",
            "console_backend": "none",
            "preconditions": preconditions,
            "reclaim": reclaim,
            "roles": plan["roles"],
            "would_launch": plan["needs_launch"],
            "restart_required": plan["restart_required"],
            "terminated": [],
            "ok": blocking is None,
            "reason": None if blocking is None else blocking[1],
            "operator_instruction": None
            if blocking is None
            else f"role {blocking[0]}: {blocking[1]} — see the precondition block above.",
        }
        _register_endpoint_processes(record, runner, registry, console)
        return record

    # --- launching was asked for: refuse on a named precondition instead of timing out
    if blocking is not None and not args.ignore_plugin_state:
        role, state = blocking
        return {
            "rig_kind": RIG_KIND,
            "run_id": constants.new_run_id(),
            "entrypoint": str(ENTRYPOINT_PATH),
            "run_mode": "aborted before launch",
            "console_backend": "none",
            "preconditions": preconditions,
            "reclaim": reclaim,
            "roles": {},
            "terminated": [],
            "ok": False,
            "reason": state,
            "operator_instruction": (
                f"role {role}: {state}. A launched Obsidian would still never answer its "
                "control port, so the rig stops here rather than launching windows and "
                "waiting for a timeout. Install an e2e-capable (dev) build for that vault "
                "— WP50/WP51 own that step — or re-run with --ignore-plugin-state to "
                "probe anyway."
            ),
        }

    record = lifecycle.ensure_endpoints(
        descriptors,
        probe=probe,
        console=console,
        resolve_exe=lambda: lifecycle.resolve_executable(args.exe),
    )
    record["run_mode"] = "attach-and-launch"
    record["preconditions"] = preconditions
    record["reclaim"] = reclaim
    record["console_requests"] = console.requests

    # Teardown must know about every endpoint this run touched, tagged honestly, before
    # the liveness check below can fail the run.
    _register_endpoint_processes(record, runner, registry, console)

    # --- WP48 AC3: an endpoint that answered before must still answer now -------------
    _verify_endpoints_still_answer(record, args)
    return record


def main(argv=None) -> int:
    """Run the rig with teardown on **every** exit path, and never report a partial run green.

    ``main`` owns four things and delegates the rest: the teardown ledger, the one call to
    :func:`teardown.run_with_teardown`, printing, and the exit status. The exit status is
    non-zero whenever the run was not green — a raised exception, an interruption, a lost
    endpoint, a failed teardown step, or a run record that says ``ok: false``.
    """
    parser = build_parser()
    args = parser.parse_args(argv)

    print(f"[rig] {REAL_BANNER}")

    registry = teardown.RigStartedProcesses()
    console = lifecycle.PlanOnlyConsole()
    runner = teardown.TeardownRunner(
        io=_RigTeardownIO(registry, console=console),
        provisioned_settings=[],
        scratch_artefacts=[],
        processes=[],
        recorder=lambda step: print(f"[rig] teardown step : {step}"),
    )

    captured: dict = {}

    def body():
        captured["record"] = _run(args, runner, console, registry)

    outcome = teardown.run_with_teardown(body, runner)

    record = captured.get("record") or {
        "rig_kind": RIG_KIND,
        "run_id": constants.new_run_id(),
        "entrypoint": str(ENTRYPOINT_PATH),
        "run_mode": "aborted",
        "console_backend": getattr(console, "CONSOLE_BACKEND", "none"),
        "preconditions": {},
        "roles": {},
        "terminated": [],
        "ok": False,
        "reason": outcome.failure_reason,
        "operator_instruction": None,
    }
    record["terminated"] = list(outcome.teardown_result.stopped_pids)
    record["run_outcome"] = outcome.to_dict()
    if outcome.failure_reason and not record.get("reason"):
        record["reason"] = outcome.failure_reason
    if outcome.error is not None:
        record["ok"] = False

    if args.json:
        print(json.dumps(record, indent=2, default=str))
    else:
        _print_human(record)

    # A green outcome is necessary but not sufficient: a run record that reports a named
    # precondition failure is still a failed run, and must not exit 0.
    status = outcome.exit_status
    if status == 0 and not record.get("ok", False):
        status = 1
    return status


if __name__ == "__main__":
    sys.exit(main())
