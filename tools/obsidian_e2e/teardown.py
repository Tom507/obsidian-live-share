"""WP48 — teardown ordering, bounded waits, crash recovery and orphan reclaim.

Outcome this module owns (charter §1): *a crashed run costs a re-run and never a dirty
vault, a lost setting or a stuck port.*

Four properties, one module:

├── **AC1** one teardown path — :class:`TeardownRunner` runs
│   ``restore_provisioned_settings → remove_scratch_artefacts → stop_rig_started_processes``
│   **exactly once**, in that order, on every exit path (success, assertion failure,
│   exception, interruption). "Exactly once" is a *counter*, not a boolean, and the slot is
│   claimed before the steps execute, so a re-entrant call cannot produce a second pass.
│   A step that raises does not stop the remaining steps and does not vanish: it lands in
│   :attr:`TeardownResult.failures` and turns the run non-green.
├── **AC2** every wait is bounded and **names its condition** — :func:`wait_for` cannot be
│   called without a positive, finite, keyword-only ``timeout_s``, and an expired wait
│   raises :class:`WaitTimeout` carrying ``constants.WAIT_TIMEOUT`` *and* the condition
│   name, all the way into the serialised run record.
├── **AC3** the false-pass guard — :func:`check_endpoints_alive` turns a mid-run silence
│   into :class:`EndpointLostMidrun`; :func:`run_with_teardown` then fails the run under
│   ``constants.ENDPOINT_LOST_MIDRUN``, still completes teardown, and reports a **non-zero**
│   exit status. A partially executed run can never be reported as a green gate result.
└── **AC4** :func:`reclaim_stale_state` detects and clears the three crash artefacts at
    start-up — a leftover provisioned port setting, a stale scratch file and a
    bound-but-dead control port — separately and in combination, **idempotently**.

Decision **D15 — attach, never kill — binds teardown and reclaim exactly as it binds
launch.** Every stop request in this module passes through :func:`_stop_rig_started`
(teardown), :func:`request_process_stop` (the run's own consoles) or
:func:`_terminate_rig_owned` (reclaim). All three refuse anything that is not marked
rig-started, so a process the rig did not start receives **zero** terminate calls by
construction rather than by care. The ledger is resolved into one decision per pid first
(:func:`resolve_stop_list`), so "stopped twice" and "attached or rig-started?" are answered
by a rule and not by registration order. This is also where the rig-started registry lives:
:mod:`obsidian_e2e.lifecycle` owns starting and deliberately contains no machinery for
ending anything. There is no ``taskkill``, no ``Stop-Process``, no
process sweep and no OS signalling primitive anywhere in this file: the two stop funnels
call an **injected** ``terminate`` seam, and the rig only ever supplies one for handles it
tagged itself.

Data safety (S1/S4, STANDING): this module never reads, prints, logs or serialises the
content of ``data.json``. Settings work is delegated to :mod:`obsidian_e2e.ports`, which
compares by sha256 of bytes; nothing here puts settings content — or the port key — into a
report, a message or an exception.

No new dependency: standard library only, like the rest of the rig.
"""

from __future__ import annotations

import json
import math
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from . import constants, ports, readiness, scratch

__all__ = [
    "DEFAULT_POLL_S",
    "DEFAULT_RECLAIM_TIMEOUT_S",
    "D15Violation",
    "EndpointLostMidrun",
    "ProcessRecord",
    "RigStartedProcesses",
    "RECLAIM_KIND_PORT",
    "RECLAIM_KIND_SCRATCH",
    "RECLAIM_KIND_SETTINGS",
    "ReclaimReport",
    "ReclaimedArtefact",
    "RunOutcome",
    "STEP_REMOVE_SCRATCH",
    "STEP_RESTORE_SETTINGS",
    "STEP_STOP_PROCESSES",
    "TEARDOWN_STEP_ORDER",
    "TeardownResult",
    "TeardownRunner",
    "WaitTimeout",
    "check_endpoints_alive",
    "reclaim_stale_state",
    "request_process_stop",
    "resolve_stop_list",
    "run_with_teardown",
    "wait_endpoints_gone",
    "wait_for",
]

# ---------------------------------------------------------------------------
# The step order (AC1). WP48 owns these three names — they are not shared-contract
# constants, so they live here and nowhere else. Every failure *reason* string in this
# module comes from ``constants`` (WP43); none is re-declared.
# ---------------------------------------------------------------------------

STEP_RESTORE_SETTINGS = "restore_provisioned_settings"
STEP_REMOVE_SCRATCH = "remove_scratch_artefacts"
STEP_STOP_PROCESSES = "stop_rig_started_processes"

#: AC1's prose pinned as data: *restore provisioned settings, remove scratch artefacts,
#: stop only rig-started processes*. Settings first because they are the owner's property
#: and the thing a crash must never cost; scratch second because removing it needs no
#: process; processes last because a stopped instance can no longer be asked to release
#: anything.
TEARDOWN_STEP_ORDER: Tuple[str, str, str] = (
    STEP_RESTORE_SETTINGS,
    STEP_REMOVE_SCRATCH,
    STEP_STOP_PROCESSES,
)

#: Reclaim artefact kinds (AC4) — the three shapes a crashed run leaves behind.
RECLAIM_KIND_SETTINGS = "settings"
RECLAIM_KIND_SCRATCH = "scratch"
RECLAIM_KIND_PORT = "port"

RECLAIM_KINDS: Tuple[str, str, str] = (
    RECLAIM_KIND_SETTINGS,
    RECLAIM_KIND_SCRATCH,
    RECLAIM_KIND_PORT,
)

#: Poll interval for :func:`wait_for` when the caller names none. Positive and finite —
#: AC2 allows a *default* poll, never a default (or absent) timeout.
DEFAULT_POLL_S = 0.05

#: Bounded budget for the one wait reclaim performs (a terminated owner releasing its
#: port). Positive and finite, and overridable per call.
DEFAULT_RECLAIM_TIMEOUT_S = 5.0


# ---------------------------------------------------------------------------
# Named failures (AC2 / AC3). Both carry a ``reason`` taken from ``constants`` and both
# serialise, because a reason that only exists on a live exception object cannot appear
# in the run record a human reads afterwards.
# ---------------------------------------------------------------------------


class WaitTimeout(TimeoutError):
    """A bounded wait expired. Always names the condition it was waiting for (AC2).

    A bare timeout is a defect: "the run hung" is not actionable, "the run waited 20 s for
    ``both_control_endpoints_gone``" is. The condition name is therefore part of the
    constructor, part of ``str(exc)`` and part of :meth:`to_dict`.
    """

    def __init__(self, condition: str, timeout_s: float) -> None:
        # Validated **at construction**, exactly like the timeout is validated before a
        # wait starts: a timeout that names nothing is the defect AC2 exists to prevent, so
        # there must be no way to build one — not from ``wait_for``, not from a call site
        # that raises this directly, not from a deserialiser. A blank name is rejected
        # here rather than filled in with a placeholder, because a placeholder is exactly
        # the unactionable "the run hung" this class replaces.
        self.condition = _require_named_condition(condition)
        self.timeout_s = _require_positive_finite("timeout_s", timeout_s)
        self.reason = constants.WAIT_TIMEOUT
        super().__init__(
            f"{constants.WAIT_TIMEOUT}: waited {self.timeout_s:g}s for condition "
            f"{self.condition!r} and it never became true"
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "reason": self.reason,
            "condition": self.condition,
            "timeout_s": self.timeout_s,
            "message": str(self),
        }


class EndpointLostMidrun(RuntimeError):
    """A control endpoint that answered before stopped answering mid-run (AC3).

    This is the *false-pass* class of failure: the run got part of the way through the
    matrix and then lost an instance. Reporting that as anything other than a failure with
    a non-zero exit status would let a partial run stand in for a green gate result.
    """

    def __init__(self, role: str, detail: str = "") -> None:
        self.role = str(role)
        self.detail = str(detail)
        self.reason = constants.ENDPOINT_LOST_MIDRUN
        super().__init__(
            f"{constants.ENDPOINT_LOST_MIDRUN}: the control endpoint for role "
            f"{self.role!r} stopped answering mid-run"
            + (f" ({self.detail})" if self.detail else "")
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "reason": self.reason,
            "role": self.role,
            "detail": self.detail,
            "message": str(self),
        }


# ---------------------------------------------------------------------------
# AC2 — the one wait primitive. Bounded by construction.
# ---------------------------------------------------------------------------


def _require_positive_finite(name: str, value: Any) -> float:
    """Reject anything that would make a wait unbounded, before any clock is touched.

    ``None``, ``0``, a negative, ``inf`` and ``nan`` are all ways of saying "wait
    forever" — ``nan`` most quietly of all, since every comparison against it is false.
    They are rejected as ``ValueError``, not silently defaulted.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a positive, finite number of seconds; got {value!r}")
    numeric = float(value)
    if not math.isfinite(numeric) or numeric <= 0:
        raise ValueError(f"{name} must be a positive, finite number of seconds; got {value!r}")
    return numeric


def _require_named_condition(condition: Any) -> str:
    """Reject a wait that names nothing, as firmly as one with no timeout is rejected.

    ``None``, ``""``, ``"   "`` and a non-string are all ways of spelling an unnamed wait,
    and an unnamed wait produces the one thing AC2 forbids: a timeout that says the run
    stopped without saying what it was waiting for. The name is returned stripped, so
    trailing whitespace cannot make two identical conditions read as different ones.
    """
    if not isinstance(condition, str) or not condition.strip():
        raise ValueError(
            "a wait must name the condition it is waiting for (AC2); got "
            f"{condition!r}"
        )
    return condition.strip()


def wait_for(
    condition: str,
    predicate: Callable[[], bool],
    *,
    timeout_s: float,
    poll_s: float = DEFAULT_POLL_S,
    clock: Optional[Callable[[], float]] = None,
    sleep: Optional[Callable[[float], None]] = None,
) -> float:
    """Wait until ``predicate()`` is true, or raise :class:`WaitTimeout` naming ``condition``.

    ``timeout_s`` is **keyword-only and has no default**: there is no way to spell an
    unbounded wait, which is AC2 expressed in the signature rather than in a review
    comment. ``clock`` and ``sleep`` are injected, so tests spend no wall-clock time and a
    non-enforcing implementation fails loudly instead of hanging a suite.

    Returns the elapsed seconds when the condition became true.
    """
    named = _require_named_condition(condition)
    budget = _require_positive_finite("timeout_s", timeout_s)
    interval = _require_positive_finite("poll_s", poll_s)

    now = clock or time.monotonic
    pause = sleep or time.sleep

    start = now()
    while True:
        if predicate():
            return now() - start
        elapsed = now() - start
        if elapsed >= budget:
            raise WaitTimeout(named, budget)
        pause(min(interval, budget - elapsed))


def wait_endpoints_gone(
    endpoints: Mapping[str, str],
    *,
    timeout_s: float,
    poll_s: float = DEFAULT_POLL_S,
    probe_timeout_s: float = 1.0,
    transport: Optional[Callable] = None,
    clock: Optional[Callable[[], float]] = None,
    sleep: Optional[Callable[[float], None]] = None,
) -> float:
    """Bounded wait until **no** endpoint answers, using WP46's inverted readiness probe.

    Teardown does not reimplement the endpoint probe: :func:`readiness.check_endpoints_gone`
    is the ``expect_absent`` mode of the readiness check and was exposed for exactly this
    call site. Reimplementing it here would let "gone" drift out of being the opposite of
    "ready", and a survivor would stop being named.
    """
    condition = "control_endpoints_gone:" + (",".join(sorted(endpoints)) or "<none>")
    return wait_for(
        condition,
        lambda: bool(
            readiness.check_endpoints_gone(
                endpoints, probe_timeout_s, transport=transport
            ).ready
        ),
        timeout_s=timeout_s,
        poll_s=poll_s,
        clock=clock,
        sleep=sleep,
    )


# ---------------------------------------------------------------------------
# AC3 — mid-run endpoint liveness
# ---------------------------------------------------------------------------


def check_endpoints_alive(
    probe: Callable[[str], bool],
    roles: Sequence[str] = constants.ROLES,
) -> None:
    """Raise :class:`EndpointLostMidrun` for the first role whose endpoint is silent.

    Called between matrix cases. ``probe`` is injected — a single boolean per role — so no
    socket is opened by anything under test, and the rig's own liveness policy stays in one
    place instead of being re-decided at every call site.
    """
    for role in roles:
        if not probe(role):
            raise EndpointLostMidrun(role, "probe returned no answer")


# ---------------------------------------------------------------------------
# AC1 — the process ledger and the single stop funnel (D15)
# ---------------------------------------------------------------------------


@dataclass
class ProcessRecord:
    """One process the run knows about, and whether **the rig started it** (D15).

    ``rig_started`` is the whole decision. An attached window — the owner's own Obsidian —
    is recorded so teardown can *report* it, and is never a candidate for stopping.
    """

    pid: int
    role: str = ""
    rig_started: bool = False
    label: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "pid": self.pid,
            "role": self.role,
            "rig_started": bool(self.rig_started),
            "label": self.label,
        }


class D15Violation(RuntimeError):
    """Raised when something asks to stop a process the rig did not start.

    It exists so the refusal is loud and structural. Nothing in the rig catches it and
    proceeds; the only correct response is to fix the caller.
    """


def _pid_key(pid: Any) -> str:
    """Identity of a process handle for de-duplication.

    A handle is an ``int`` pid in the charter's shape and a console id (a string) in the
    entrypoint's, so identity is compared as text: ``4242`` and ``"4242"`` are the same
    process registered by two call sites with different types, and treating them as two
    would terminate one process twice.
    """
    return str(pid)


def resolve_stop_list(processes: Iterable[Any]) -> List[ProcessRecord]:
    """Collapse a process ledger into **one decision per pid**, order-independently.

    Two things a ledger can contain that the naive loop gets wrong:

    ├── the same pid **twice** — two call sites registered it, or a re-probe re-registered
    │   it. It is one process, so it is stopped **once**. Terminating an already-terminated
    │   pid is at best a no-op and at worst a signal to whatever inherited the number.
    └── the same pid as **both** attached and rig-started — a role the rig launched and
        then also recorded as an attached endpoint, say. The **attached** classification
        wins. That is the D15-safe resolution and it is the *rule*, not the outcome of
        which entry the loop happened to see last: "the rig did not start this" is a claim
        that cannot be cancelled by a second entry claiming otherwise, because the cost of
        being wrong in that direction is the owner's unsaved work.

    First-seen order is preserved so the teardown record still reads in the order the run
    acquired things; the *decision* attached to each pid does not depend on that order.
    """
    resolved: Dict[str, ProcessRecord] = {}
    for record in processes:
        key = _pid_key(getattr(record, "pid", record))
        rig_started = bool(getattr(record, "rig_started", False))
        seen = resolved.get(key)
        if seen is None:
            resolved[key] = ProcessRecord(
                pid=getattr(record, "pid", record),
                role=getattr(record, "role", "") or "",
                rig_started=rig_started,
                label=getattr(record, "label", "") or "",
            )
            continue
        if seen.rig_started and not rig_started:
            # Attached wins, always and in whichever order the two entries arrived.
            seen.rig_started = False
            seen.label = getattr(record, "label", "") or seen.label
    return list(resolved.values())


def _stop_rig_started(io: Any, record: ProcessRecord) -> None:
    """The **only** stop call in teardown. Refuses any record not tagged rig-started.

    D15 as a chokepoint rather than as a habit: a caller cannot terminate an attached
    window without adding a second primitive, and there is none in this module.
    """
    if not getattr(record, "rig_started", False):
        raise D15Violation(
            f"D15: pid {getattr(record, 'pid', '?')} was not started by the rig, so it "
            "will not be closed, terminated or restarted"
        )
    io.terminate_process(record.pid)


class RigStartedProcesses:
    """Tag registry: the only source of truth for "the rig started this one" (D15).

    Lives here, in the module that owns stopping, rather than in the module that owns
    launching: launch has no use for it beyond handing over what it started, and a registry
    sitting next to the launch code invites a stop call to grow next to it. A handle is
    stoppable **only** if it is in here, and the only way in is :meth:`tag`, which the run
    calls for a console it itself opened. Attached windows are never tagged, so they can
    never be stopped — D15 expressed as a data structure rather than as care.
    """

    def __init__(self) -> None:
        self._tagged: Dict[str, str] = {}

    def tag(self, handle: Any, role: str) -> str:
        self._tagged[str(handle)] = str(role)
        return str(handle)

    def is_rig_started(self, handle: Any) -> bool:
        return str(handle) in self._tagged

    def role_of(self, handle: Any) -> Optional[str]:
        return self._tagged.get(str(handle))

    def __contains__(self, handle: Any) -> bool:
        return self.is_rig_started(handle)

    def __len__(self) -> int:
        return len(self._tagged)


def request_process_stop(handle: Any, registry: RigStartedProcesses, console: Any = None) -> Dict[str, Any]:
    """Ask to stop one handle. Refuses anything the registry has not tagged as rig-started.

    D15: no process, window or Obsidian instance the rig did not itself launch may be
    closed or restarted. This helper is the single funnel for that decision, so the
    guarantee is structural: a caller cannot route around it without adding a new
    primitive, and there is none anywhere in the rig.

    It does not reach an OS primitive itself either — it asks the injected console surface
    to release the console the rig opened. The rig never holds an OS handle at all, which
    is why "attach, never kill" is not something the rig has to remember to honour.
    """
    if not registry.is_rig_started(handle):
        return {
            "stopped": False,
            "refused": True,
            "handle": str(handle),
            "why": (
                "D15: the rig did not start this process or window, so it will not be "
                "closed or restarted. Ask the operator instead."
            ),
        }
    release = getattr(console, "close_console", None) if console is not None else None
    if release is None:
        return {
            "stopped": False,
            "refused": True,
            "handle": str(handle),
            "why": "no console surface was supplied to release a rig-started console with",
        }
    release(str(handle))
    return {
        "stopped": True,
        "refused": False,
        "handle": str(handle),
        "role": registry.role_of(handle),
    }


def _terminate_rig_owned(process_control: Any, pid: int, rig_owned_pids: Iterable[int]) -> None:
    """The **only** stop call in reclaim. Refuses any pid the rig's own marker does not name.

    The rig's provisioning marker is the sole evidence of ownership after a crash: it was
    written by the run that provisioned the port and it records that run's pid. A holder
    that is not in it is somebody else's process, and D15 protects it exactly as it
    protects an attached window during teardown.
    """
    if int(pid) not in {int(known) for known in rig_owned_pids}:
        raise D15Violation(
            f"D15: pid {pid} does not appear in this rig's provisioning marker, so the "
            "port it holds will be reported, never reclaimed by force"
        )
    process_control.terminate(pid)


# ---------------------------------------------------------------------------
# AC1 — the teardown result and the runner
# ---------------------------------------------------------------------------


@dataclass
class TeardownResult:
    """What teardown did, and what went wrong while doing it.

    ``ok`` is derived from ``failures`` rather than set: there is no way to report a clean
    teardown while holding an exception, which is the false-pass shape this WP exists to
    prevent.
    """

    steps_run: List[str] = field(default_factory=list)
    failures: Dict[str, BaseException] = field(default_factory=dict)
    stopped_pids: List[int] = field(default_factory=list)
    skipped_pids: List[int] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.failures

    def to_dict(self) -> Dict[str, Any]:
        return {
            "steps_run": list(self.steps_run),
            "failures": {
                step: {"type": type(exc).__name__, "message": str(exc)}
                for step, exc in self.failures.items()
            },
            "stopped_pids": list(self.stopped_pids),
            "skipped_pids": list(self.skipped_pids),
            "ok": self.ok,
        }


class TeardownRunner:
    """Runs the three teardown steps in :data:`TEARDOWN_STEP_ORDER`, **once**.

    Idempotent *per instance*: the first :meth:`run` claims the slot before executing, so a
    second call — from a body that tore itself down, from a ``finally``, from a signal
    handler — returns the same :class:`TeardownResult` object without re-running anything.
    :attr:`executions` counts real executions, so a double teardown is impossible rather
    than merely unlikely.

    Every boundary is injected through ``io``:

    ├── ``io.restore_setting(record)``  ← WP44's byte-exact settings restore
    ├── ``io.remove_scratch(path)``     ← WP47's scratch removal
    └── ``io.terminate_process(pid)``   ← reached only via :func:`_stop_rig_started`

    ``recorder`` (optional) is called with each step name as that step starts, which is what
    lets a caller — or a test — see the order rather than infer it.
    """

    def __init__(
        self,
        *,
        io: Any,
        provisioned_settings: Iterable[Any],
        scratch_artefacts: Iterable[Any],
        processes: Iterable[ProcessRecord],
        recorder: Optional[Callable[[str], None]] = None,
    ) -> None:
        self.io = io
        self.provisioned_settings: List[Any] = list(provisioned_settings)
        self.scratch_artefacts: List[Any] = list(scratch_artefacts)
        self.processes: List[ProcessRecord] = list(processes)
        self.recorder = recorder
        self._lock = threading.RLock()
        self._executions = 0
        self._result: Optional[TeardownResult] = None

    # -- registration ------------------------------------------------------
    # A live run acquires its resources as it goes; teardown must know about each one from
    # the moment it exists, not at the end when the run may already have crashed.

    def register_provisioned_settings(self, record: Any) -> Any:
        with self._lock:
            self.provisioned_settings.append(record)
        return record

    def register_scratch_artefact(self, path: Any) -> Any:
        with self._lock:
            self.scratch_artefacts.append(path)
        return path

    def register_process(self, record: ProcessRecord) -> ProcessRecord:
        with self._lock:
            self.processes.append(record)
        return record

    # -- execution ---------------------------------------------------------

    @property
    def executions(self) -> int:
        """How many times the steps really ran. Must never exceed 1 (AC1)."""
        return self._executions

    @property
    def result(self) -> Optional[TeardownResult]:
        return self._result

    def run(self) -> TeardownResult:
        """Execute the three steps in order, exactly once. Never raises."""
        with self._lock:
            if self._result is not None:
                return self._result
            result = TeardownResult()
            # Claim the slot BEFORE executing: a re-entrant call from inside a step (or
            # from a signal handler on this thread) sees a result and returns it.
            self._result = result
            self._executions += 1

        self._execute(result)
        return result

    def _execute(self, result: TeardownResult) -> None:
        for step, work in (
            (STEP_RESTORE_SETTINGS, self._restore_provisioned_settings),
            (STEP_REMOVE_SCRATCH, self._remove_scratch_artefacts),
            (STEP_STOP_PROCESSES, self._stop_rig_started_processes),
        ):
            result.steps_run.append(step)
            if self.recorder is not None:
                try:
                    self.recorder(step)
                except BaseException as exc:  # noqa: BLE001 - a recorder must never gate teardown
                    result.failures.setdefault(step, exc)
            # A failing step must not prevent the remaining steps: the vault would be left
            # dirty *and* the run reported green. BaseException, because a KeyboardInterrupt
            # landing inside teardown is exactly when the remaining steps matter most.
            try:
                work(result)
            except BaseException as exc:  # noqa: BLE001 - recorded, never swallowed
                result.failures.setdefault(step, exc)

    def _restore_provisioned_settings(self, result: TeardownResult) -> None:
        """Give every borrowed settings file back, byte for byte. Settings are borrowed."""
        first_error: Optional[BaseException] = None
        for record in list(self.provisioned_settings):
            try:
                self.io.restore_setting(record)
            except BaseException as exc:  # noqa: BLE001 - one bad record must not skip the rest
                first_error = first_error or exc
        if first_error is not None:
            raise first_error

    def _remove_scratch_artefacts(self, result: TeardownResult) -> None:
        """Remove what the run created, and only what the run created."""
        first_error: Optional[BaseException] = None
        for path in list(self.scratch_artefacts):
            try:
                self.io.remove_scratch(path)
            except BaseException as exc:  # noqa: BLE001
                first_error = first_error or exc
        if first_error is not None:
            raise first_error

    def _stop_rig_started_processes(self, result: TeardownResult) -> None:
        """Stop rig-started processes. Attached ones are recorded as skipped, never touched.

        The ledger is **resolved into one decision per pid** before anything is stopped
        (:func:`resolve_stop_list`): the same process registered twice — by two call sites,
        by a re-registration after a re-probe, by an attach that was later launched — is
        stopped once, and a pid that appears both attached and rig-started is treated as
        attached. Iterating the ledger directly would make both of those depend on
        registration order, and "did the rig terminate the owner's window?" must not be an
        accident of which call site ran first.

        "Nothing to stop" is still a step that ran — an empty ledger is a legitimate
        outcome of an attach-only run, not a skipped step.
        """
        first_error: Optional[BaseException] = None
        for record in resolve_stop_list(self.processes):
            if not record.rig_started:
                result.skipped_pids.append(record.pid)
                continue
            try:
                _stop_rig_started(self.io, record)
            except BaseException as exc:  # noqa: BLE001
                first_error = first_error or exc
            else:
                result.stopped_pids.append(record.pid)
        if first_error is not None:
            raise first_error


# ---------------------------------------------------------------------------
# AC1 + AC3 — the run driver
# ---------------------------------------------------------------------------


@dataclass
class RunOutcome:
    """The verdict of one rig run: what happened, what teardown did, and the exit status.

    ``green`` is the gate answer and it is **conjunctive**: the body must have completed,
    the run must not have been interrupted, and teardown must have succeeded. A partially
    executed run, or a run whose teardown left something behind, is not green — and
    ``exit_status`` is non-zero whenever ``green`` is false, so a caller that only looks at
    the process exit code reaches the same conclusion.
    """

    exit_status: int
    failure_reason: Optional[str]
    teardown_result: TeardownResult
    error: Optional[BaseException] = None
    interrupted: bool = False
    value: Any = None

    @property
    def green(self) -> bool:
        return self.error is None and not self.interrupted and self.teardown_result.ok

    def to_dict(self) -> Dict[str, Any]:
        error: Optional[Dict[str, Any]] = None
        if self.error is not None:
            to_dict = getattr(self.error, "to_dict", None)
            error = (
                to_dict()
                if callable(to_dict)
                else {"type": type(self.error).__name__, "message": str(self.error)}
            )
        return {
            "exit_status": self.exit_status,
            "failure_reason": self.failure_reason,
            "green": self.green,
            "interrupted": self.interrupted,
            "error": error,
            "teardown": self.teardown_result.to_dict(),
        }


def _named_reason(error: Optional[BaseException]) -> Optional[str]:
    """The ``constants`` reason an error names, or ``None``.

    Only sanctioned names pass: §7 of the shared contract is an enum, and an ad-hoc reason
    string invented at a call site would defeat the point of having one.
    """
    if error is None:
        return None
    reason = getattr(error, "reason", None)
    return reason if reason in constants.FAILURE_REASONS else None


def run_with_teardown(body: Callable[[], Any], runner: TeardownRunner) -> RunOutcome:
    """Run ``body`` and tear down afterwards — on **every** exit path (AC1, AC3).

    Success, assertion failure, raised exception and ``KeyboardInterrupt`` all reach the
    same teardown, in the same order, exactly once. ``BaseException`` is caught rather than
    ``Exception`` because interruption is one of the four exit paths AC1 enumerates, and it
    is the one that most often leaves a vault dirty.

    The interruption is **not** masked: it is recorded on the outcome (``interrupted``,
    ``error``) and the exit status is non-zero, which is the form the shared contract's API
    surface pins (``run_with_teardown(body, runner) -> RunOutcome``). Re-raising instead
    would make it impossible for the caller to see the teardown record that this WP exists
    to produce.
    """
    error: Optional[BaseException] = None
    interrupted = False
    value: Any = None

    try:
        value = body()
    except BaseException as exc:  # noqa: BLE001 - AC1 enumerates interruption as an exit path
        error = exc
        interrupted = isinstance(exc, (KeyboardInterrupt, SystemExit))

    try:
        result = runner.run()
    except BaseException as exc:  # noqa: BLE001 - defensive; run() is written not to raise
        result = TeardownResult(steps_run=[], failures={"teardown": exc})

    green = error is None and not interrupted and result.ok
    return RunOutcome(
        exit_status=0 if green else 1,
        failure_reason=_named_reason(error),
        teardown_result=result,
        error=error,
        interrupted=interrupted,
        value=value,
    )


# ---------------------------------------------------------------------------
# AC4 — crash recovery and orphan reclaim
# ---------------------------------------------------------------------------


@dataclass
class ReclaimedArtefact:
    """One crash artefact found at start-up, and what happened to it.

    ``reason`` is a ``constants`` name when the artefact could **not** be cleared, and
    ``None`` when it could. ``detail`` is prose for a human — never file content, never a
    settings key (S4).
    """

    kind: str
    target: Any
    reclaimed: bool
    reason: Optional[str] = None
    detail: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "kind": self.kind,
            "target": self.target,
            "reclaimed": self.reclaimed,
            "reason": self.reason,
            "detail": self.detail,
        }


@dataclass
class ReclaimReport:
    """The result of one start-up reclaim pass.

    ``actions`` is the number of artefacts actually cleared, which is what makes
    idempotence observable: a second pass over the same vault finds nothing to do and
    reports ``0``.
    """

    artefacts: List[ReclaimedArtefact] = field(default_factory=list)

    @property
    def reclaimed(self) -> List[ReclaimedArtefact]:
        return [artefact for artefact in self.artefacts if artefact.reclaimed]

    @property
    def unreclaimed(self) -> List[ReclaimedArtefact]:
        return [artefact for artefact in self.artefacts if not artefact.reclaimed]

    @property
    def actions(self) -> int:
        return len(self.reclaimed)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "artefacts": [artefact.to_dict() for artefact in self.artefacts],
            "actions": self.actions,
            "reclaimed": [artefact.to_dict() for artefact in self.reclaimed],
            "unreclaimed": [artefact.to_dict() for artefact in self.unreclaimed],
        }


def _read_marker_before_settings(vault: Path) -> Optional[Dict[str, Any]]:
    """Read the provisioning marker **before** the settings step deletes it.

    The marker's ``pid`` is the only record of rig ownership the port step has: once
    :func:`ports.restore_port` has given the settings back it removes the marker, and with
    it every trace of which process held the control port. Reading it first is therefore
    ordering, not caching.

    A marker that cannot be parsed yields ``None`` — the settings step reports the conflict
    under ``PROVISION_CONFLICT``; a damaged marker must not be treated as proof of
    ownership over anything.
    """
    marker_path = vault / constants.PROVISION_MARKER_REL
    try:
        raw = marker_path.read_bytes()
    except (FileNotFoundError, NotADirectoryError, OSError):
        return None
    try:
        marker = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return None
    return marker if isinstance(marker, dict) else None


def _rig_owned_pids(marker: Optional[Mapping[str, Any]]) -> Tuple[int, ...]:
    if not marker:
        return ()
    pid = marker.get("pid")
    if isinstance(pid, bool) or not isinstance(pid, int):
        return ()
    return (pid,)


def _reported_reason(error: BaseException, fallback: str) -> str:
    """The sanctioned ``constants`` name an error carries, or ``fallback``.

    Only §7 names pass, so a module that grows a new reason still reports a name this rig
    recognises instead of leaking an ad-hoc string into a report.
    """
    reason = getattr(error, "reason", None)
    return reason if reason in constants.FAILURE_REASONS else fallback


def _missing_backup_reason(vault: Path) -> Optional[ReclaimedArtefact]:
    """Report a marker claiming an original whose backup file is not there.

    Read-only, and it names paths only — never a byte of settings content (S4). The
    marker is read through :func:`_read_marker_before_settings`, which tolerates a damaged
    file by returning ``None``; a damaged marker is a *different* diagnosis and stays
    WP44's to make.
    """
    marker = _read_marker_before_settings(vault)
    if not marker or marker.get("hadOriginal") is not True:
        return None
    if (vault / constants.SETTINGS_BACKUP_REL).exists():
        return None
    return ReclaimedArtefact(
        kind=RECLAIM_KIND_SETTINGS,
        target=constants.PLUGIN_DATA_REL,
        reclaimed=False,
        reason=constants.SETTINGS_RESTORE_MISMATCH,
        detail=(
            "the provisioning marker records a saved original but the backup at "
            f"{constants.SETTINGS_BACKUP_REL} is gone, so no restore can be byte-exact; "
            "the settings file was left exactly as found and nothing was guessed"
        ),
    )


def _reclaim_settings(vault: Path) -> Optional[ReclaimedArtefact]:
    """Kind 1 — a leftover provisioned port setting.

    Delegated wholesale to WP44's :func:`ports.restore_port`, which writes back the captured
    bytes verbatim, verifies by sha256 **and** exact length, and only then removes the
    backup and the marker. It is a no-op when nothing was borrowed, which is what makes a
    second pass a no-op and — crucially — what stops a second "restore" from overwriting
    the original the first pass just put back.
    """
    # Structural pre-check, made here because only reclaim can name it correctly. A marker
    # that claims a saved original whose backup is **gone** is not an ambiguous borrow
    # record — it is a restore that cannot be byte-exact, which is what
    # ``SETTINGS_RESTORE_MISMATCH`` means. The owner's file can no longer be reconstructed,
    # so this is reported and nothing is written: neither "there was no original" (which
    # would delete the file) nor "the live file is the original" (which would freeze the
    # rig's own value in place) is a guess anybody is entitled to make.
    missing_backup = _missing_backup_reason(vault)
    if missing_backup is not None:
        return missing_backup

    try:
        outcome = ports.restore_port(vault)
    except ports.ProvisionError as exc:
        # Every refusal WP44 raises already names itself — a marker that claims a saved
        # original whose backup is gone, a backup that no marker accounts for, a damaged
        # marker, a restore that would not be byte-exact. Reporting the exception's own
        # ``reason`` rather than a hardcoded one keeps this honest as WP44 grows reasons,
        # and stops "we could not tell what the owner's file was" from being flattened into
        # one label. What is never done is *guessing*: an unclear record is reported
        # unreclaimed with the settings file left exactly as found.
        return ReclaimedArtefact(
            kind=RECLAIM_KIND_SETTINGS,
            target=constants.PLUGIN_DATA_REL,
            reclaimed=False,
            reason=_reported_reason(exc, constants.PROVISION_CONFLICT),
            detail=str(exc),
        )
    except Exception as exc:  # noqa: BLE001 - an unreadable vault is still a report
        # A permission error, a vanished directory, a locked file: the settings could not
        # be given back and the rig cannot tell whether they ever were borrowed. That is
        # reported — and the remaining reclaim kinds still run, because a settings failure
        # must not leave a stale scratch file and a stuck port behind as well.
        return ReclaimedArtefact(
            kind=RECLAIM_KIND_SETTINGS,
            target=constants.PLUGIN_DATA_REL,
            reclaimed=False,
            reason=constants.PROVISION_CONFLICT,
            detail=f"{type(exc).__name__}: {exc}",
        )

    if not outcome.restored:
        return None
    return ReclaimedArtefact(
        kind=RECLAIM_KIND_SETTINGS,
        target=constants.PLUGIN_DATA_REL,
        reclaimed=True,
        reason=None,
        detail=(
            "the saved original was restored byte-exactly and the rig's backup and marker "
            "were removed"
            if outcome.had_original
            else "there was no settings file before the crashed run, so the rig's file was removed"
        ),
    )


def _reclaim_scratch(vault: Path) -> List[ReclaimedArtefact]:
    """Kind 2 — stale scratch artefacts, plus the rig folder once it is empty.

    WP47 owns both the staleness rule ("not owned by a run live in this process") and the
    removal funnel; this reports the difference between what was stale and what could
    actually be cleared. An artefact that survives comes back as ``SCRATCH_STALE_UNRECLAIMED``
    rather than being swallowed — a run must not proceed over state it could not clear.
    """
    stale_before = tuple(scratch.stale_scratch_relpaths(vault))
    if not stale_before:
        _remove_rig_owned_scratch_folder(vault)
        return []

    cleared = set(scratch.reclaim_stale_scratch(vault))
    artefacts = [
        ReclaimedArtefact(
            kind=RECLAIM_KIND_SCRATCH,
            target=relpath,
            reclaimed=relpath in cleared,
            reason=None if relpath in cleared else constants.SCRATCH_STALE_UNRECLAIMED,
            detail=(
                "a scratch canvas from a crashed run was removed"
                if relpath in cleared
                else "the scratch canvas could not be removed and the vault is still dirty"
            ),
        )
        for relpath in stale_before
    ]
    _remove_rig_owned_scratch_folder(vault)
    return artefacts


def _remove_rig_owned_scratch_folder(vault: Path) -> None:
    """Take the rig folder away completely — the rig's leftovers with it.

    Delegated to :func:`scratch.reclaim_scratch_folder`, which owns the vault-write funnel.
    Two properties, and the second is not weakened to get the first:

    ├── **complete** — a crashed run does not only leave tidy ``.canvas`` files. A partial
    │   write, a ``.tmp`` sibling, a name whose extension never landed: all of it carries
    │   the rig's own prefix, all of it is the rig's to clear, and an "only if empty" rule
    │   would leave the folder standing with rig debris in it after every crash — exactly
    │   the state AC4 exists to clear.
    └── **guarded** — anything without that prefix is a user file, and one of those stops
        the removal dead with nothing deleted. There is still no recursive delete anywhere:
        entries are unlinked individually and the folder itself with ``rmdir``.

    Failure is silence by design: this is a courtesy at the end of a reclaim pass, and the
    artefacts that *matter* are reported by the caller.
    """
    try:
        scratch.reclaim_scratch_folder(vault)
    except (OSError, scratch.VaultWriteRefused):
        return


def _reclaim_ports(
    port_list: Sequence[int],
    port_probe: Any,
    process_control: Any,
    rig_owned_pids: Sequence[int],
    *,
    timeout_s: float,
    poll_s: float,
    clock: Optional[Callable[[], float]],
    sleep: Optional[Callable[[float], None]],
) -> List[ReclaimedArtefact]:
    """Kind 3 — a bound but dead control port, reclaimed **only** when the rig owns it.

    Three states, three different answers:

    ├── not bound              ← no artefact at all; there is nothing to reclaim
    ├── bound and answering    ← a live instance to attach to, not an orphan. Untouched.
    └── bound and silent       ← an orphan *if and only if* the holder is the pid recorded
                                 in the rig's own provisioning marker. Anything else is
                                 reported and never signalled (D15).
    """
    artefacts: List[ReclaimedArtefact] = []
    if not port_list or port_probe is None:
        return artefacts

    owned = {int(pid) for pid in rig_owned_pids}

    for port in port_list:
        if not port_probe.is_bound(port):
            continue
        if port_probe.answers_control(port):
            # An answering endpoint is the healthy case, and the rig has no business
            # touching it — that is the whole of "attach, never kill".
            continue

        owner = port_probe.owner_pid(port)
        if owner is None or int(owner) not in owned:
            artefacts.append(
                ReclaimedArtefact(
                    kind=RECLAIM_KIND_PORT,
                    target=port,
                    reclaimed=False,
                    reason=None,
                    detail=(
                        "the port is held by a process this rig did not start; D15 means it "
                        "is reported, never terminated. Ask the operator to close it."
                    ),
                )
            )
            continue

        if process_control is None:
            artefacts.append(
                ReclaimedArtefact(
                    kind=RECLAIM_KIND_PORT,
                    target=port,
                    reclaimed=False,
                    reason=None,
                    detail="no process control was supplied, so the orphan was only reported",
                )
            )
            continue

        is_alive = getattr(process_control, "is_alive", None)
        if callable(is_alive) and not is_alive(owner):
            artefacts.append(
                ReclaimedArtefact(
                    kind=RECLAIM_KIND_PORT,
                    target=port,
                    reclaimed=False,
                    reason=None,
                    detail=(
                        "the recorded owner has already exited yet the port is still bound; "
                        "there is nothing left for the rig to stop"
                    ),
                )
            )
            continue

        try:
            _terminate_rig_owned(process_control, owner, owned)
            wait_for(
                f"control_port_{port}_released",
                lambda bound_port=port: not port_probe.is_bound(bound_port),
                timeout_s=timeout_s,
                poll_s=poll_s,
                clock=clock,
                sleep=sleep,
            )
        except WaitTimeout as exc:
            artefacts.append(
                ReclaimedArtefact(
                    kind=RECLAIM_KIND_PORT,
                    target=port,
                    reclaimed=False,
                    reason=constants.WAIT_TIMEOUT,
                    detail=str(exc),
                )
            )
            continue
        except (D15Violation, OSError) as exc:
            artefacts.append(
                ReclaimedArtefact(
                    kind=RECLAIM_KIND_PORT,
                    target=port,
                    reclaimed=False,
                    reason=None,
                    detail=str(exc),
                )
            )
            continue

        artefacts.append(
            ReclaimedArtefact(
                kind=RECLAIM_KIND_PORT,
                target=port,
                reclaimed=True,
                reason=None,
                detail="the rig's own orphaned process was stopped and the port came free",
            )
        )

    return artefacts


def reclaim_stale_state(
    vault_path: Any,
    *,
    ports: Sequence[int] = (),
    port_probe: Any = None,
    process_control: Any = None,
    clock: Optional[Callable[[], float]] = None,
    sleep: Optional[Callable[[float], None]] = None,
    timeout_s: float = DEFAULT_RECLAIM_TIMEOUT_S,
    poll_s: float = DEFAULT_POLL_S,
) -> ReclaimReport:
    """Detect and clear the artefacts of a previous crashed run. Idempotent (AC4).

    Three kinds, one pass, in this order:

    ├── **settings** — a leftover provisioned port setting; the saved original goes back
    │   byte-exactly and the rig's backup and marker are removed
    ├── **scratch**  — stale scratch canvases and the rig folder they lived in
    └── **port**     — a bound but dead control port, and only when the rig owns it

    Every kind runs on every pass: an implementation that returned early after the first
    kind would clean a settings file and leave a stuck port behind, which is precisely the
    combination a crash produces. Nothing here retries the run — reclaim prepares a clean
    start, it does not re-run.

    Running it twice is a no-op with the same end state. In particular the second pass must
    not "restore" again: the first pass removed the marker, so WP44's restore is a no-op and
    the original it just put back is not overwritten by the already-provisioned state.

    Args:
        vault_path: the vault to reclaim. Always a fixture vault in this batch (S5).
        ports: control ports to inspect; empty means "do not look at ports at all".
        port_probe: injected ``is_bound`` / ``answers_control`` / ``owner_pid``.
        process_control: injected ``is_alive`` / ``terminate``. Reached only through
            :func:`_terminate_rig_owned`, which refuses any pid the marker does not name.
        clock, sleep: injected time, so nothing here consumes wall-clock time in a test.
        timeout_s: bounded budget for the one wait this performs (AC2). Positive, finite.
    """
    vault = Path(vault_path)
    report = ReclaimReport()

    # ORDERING, NOT CACHING: the settings step deletes the marker, and the marker's pid is
    # the port step's only evidence of rig ownership.
    marker = _read_marker_before_settings(vault)
    owned_pids = _rig_owned_pids(marker)

    settings_artefact = _reclaim_settings(vault)
    if settings_artefact is not None:
        report.artefacts.append(settings_artefact)

    report.artefacts.extend(_reclaim_scratch(vault))

    report.artefacts.extend(
        _reclaim_ports(
            tuple(ports),
            port_probe,
            process_control,
            owned_pids,
            timeout_s=_require_positive_finite("timeout_s", timeout_s),
            poll_s=poll_s,
            clock=clock,
            sleep=sleep,
        )
    )

    return report
