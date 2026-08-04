"""WP70 — the rig-owned **local** relay: build-or-verify, start, readiness, room, stop.

Outcome (charter §1): the gate has a sync path the rig owns end to end. A relay the rig
starts, a room the rig mints on *that* relay, and a released port and removed store at the
end of every exit path — so a green matrix case is a statement about Canvas V2 and not
about two files nobody was syncing.

The gate runs against a **local** relay
--------------------------------------
A release gate must be hermetic. Deploying to the NeuralAngels box is *authorised* but is
not a requirement, and a network dependency injects exactly the flake this run has spent
its length removing from its own signals. Remote-relay operation is a possible **future,
non-gating** matrix case; it is not chartered and must not be added in passing.

⚠ The rig does not spawn — the console is injected
--------------------------------------------------
There is no ``subprocess``, no ``Popen``, no ``os.system``, no ``os.exec*`` and no
``shutil.which``-plus-spawn in this module, and that is structural rather than stylistic:

- C45 AC4 requires every long-running process the rig starts to go through the workspace
  ``visible-console`` tools, never a detached background process.
- The injected console is the only thing that makes it *impossible* for a test or a dev
  loop to reach the real ``Obsidian.exe`` and the owner's live vaults (D16).

So the relay is started by the mediating agent through ``visible-console``, from a plan
this module emits. The console protocol it depends on is exactly:

├── ``run_command(argv, title=…, cwd=…, env=…)`` → console id ── the relay launch,
│   deliberately **not** awaited: awaiting a server is the watch trap in a new place
├── ``run_command(...)`` + ``await_console(...)`` ─────────────── the server build, which
│   is plain ``tsc`` and terminates, so it *is* awaited
└── ``close_console(console_id)`` ───────────────────────────── stopping the rig's **own**
    relay, and nothing else (D15/S2)

:class:`RelayPlanConsole` subclasses ``lifecycle.PlanOnlyConsole`` — a read of that
module, never a write — to add the ``cwd``/``env`` a relay launch needs and the
``close_console`` a relay stop needs. Readiness, room minting and the stopped-port probe
are plain ``http.client`` and ``socket``; none of them needs a spawn.

The store directory, and why the cwd carries it
-----------------------------------------------
All three of the relay's LevelDB stores resolve relative to the process cwd, and only one
of them has an environment hook at all — the other two are *parameter* defaults reachable
by no variable, and adding one would be a ``server/`` edit, which is an abort criterion.
So the mechanism is the working directory: the relay is started **inside** a run-scoped
directory outside the repository and outside both vaults, which teardown removes. Node
resolves ``node_modules`` from the module file's directory rather than from the cwd, and
``isMain`` compares a resolved absolute entry path, so both still work from there.

Bounded waits, and one measured host fact that shapes them
----------------------------------------------------------
No wall-clock sleep is ever an oracle here. Readiness is a positive probe of the health
endpoint reporting ``ok`` — the process's own statement about itself — bounded, naming the
awaited condition on expiry. "Stopped" is likewise a probe of the port, never the fact
that a close call returned.

⚠ Measured on this host, before any of this code existed: connecting to a port with
nothing listening does **not** raise ``ConnectionRefusedError``. Every unused port drops
the SYN and the connect consumes its whole timeout, raising ``TimeoutError``. An oracle
written ``except ConnectionRefusedError: return stopped`` can therefore never fire here —
it would look like it worked only because a surrounding ``except OSError`` swallowed the
timeout. The sanctioned reading of "the port no longer accepts a connection" is therefore
*a connection no longer completes within a bounded budget*, and it is non-vacuous because
the positive direction was measured too: while the relay was up, the connection succeeded
and the health endpoint answered on the first poll. Both halves are kept.

Failure reasons come from :mod:`obsidian_e2e.constants` (contract §7); this module defines
none of its own and re-declares no constant that WP43 owns — the port, the host, the
paths, the room prefix and every budget are imported, and none of them is spelled twice.
"""

from __future__ import annotations

import http.client
import json
import os
import shutil
import socket
import time
from collections.abc import Mapping as _MappingABC
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Mapping, Optional, Union
from urllib.parse import urlsplit

from . import constants
from .lifecycle import PlanOnlyConsole
from .ports import ProvisionError

__all__ = [
    "LocalRelay",
    "RelayRoom",
    "RelayStopResult",
    "PropagationEvidence",
    "PropagationVerdict",
    "RelayPlanConsole",
    "mint_room",
    "evaluate_propagation",
    "RELAY_EVIDENCE_KEYS",
    "NEGATIVE_EVIDENCE_KEYS",
    "POSITIVE_CHANNEL",
    "NEGATIVE_CHANNEL",
    "POLL_INTERVAL_S",
    "RelayError",
    "RelayPortOccupied",
    "RelayBuildFailed",
    "RelayReadinessTimeout",
    "RelayNotStopped",
    "RoomMintFailed",
    "PropagationEvidenceUnavailable",
    "GateOrderViolation",
]

PathLike = Union[str, "os.PathLike[str]"]

#: The single poll interval the bounded waits use, imported rather than chosen here.
POLL_INTERVAL_S = constants.RELAY_READY_POLL_INTERVAL_S

#: AC5's two evidence channels, named so a record can say *which* one is missing.
POSITIVE_CHANNEL = "relay-side-observation"
NEGATIVE_CHANNEL = "negative-control"

#: The keys a positive channel must carry. They are all facts about the **relay** — its
#: own accounting of the run's room. Content observed in vault B is not among them and
#: may never be substituted for them: a hermetic relay's document and client counts and
#: the frames its store retained are evidence no file-copying engine can manufacture,
#: and that asymmetry is the whole point of the criterion.
RELAY_EVIDENCE_KEYS = ("roomId", "documents", "clients", "frames")

#: The keys a negative control must carry: whether the relay-mediated path was in place
#: (it must **not** have been), and whether the change arrived anyway.
NEGATIVE_EVIDENCE_KEYS = ("relayMediated", "changed")

#: The default pause seam. Injectable, and injected in every test: a wait driven by
#: elapsed time cannot make progress against a frozen clock, while one driven by the
#: condition still can — which is the difference between a wait and a sleep.
_DEFAULT_SLEEPER = time.sleep
_DEFAULT_CLOCK = time.monotonic


# ---------------------------------------------------------------------------
# Errors — every abort names exactly one reason from constants.py (contract §7)
# ---------------------------------------------------------------------------


class RelayError(ProvisionError):
    """Base class for a named relay abort.

    It extends the rig's existing named-abort discipline rather than inventing a second
    one: ``reason`` is always a member of
    :data:`obsidian_e2e.constants.FAILURE_REASONS`, and neither the message nor the repr
    ever carries a credential — not the room token, not a byte out of a settings file.
    """


class RelayPortOccupied(RelayError):
    """The relay port already has a listener, and it is not the rig's (AC3, D15/S2).

    Refusing is deliberate. Adopting a listener the rig did not start means driving a
    relay that may hold a *different* room, in which case both peers connect successfully
    to a place where they cannot meet and the failure looks like a sync bug. Terminating
    it would be acting on a process the rig does not own. A named refusal naming the
    host and port is the only correct outcome.
    """

    reason = constants.RELAY_PORT_OCCUPIED


class RelayBuildFailed(RelayError):
    """The server build did not produce a usable entry point (AC3)."""

    reason = constants.RELAY_BUILD_FAILED


class RelayReadinessTimeout(RelayError):
    """The relay did not report itself healthy within the budget (AC3).

    The message names the awaited condition — the endpoint and the field — because an
    expiry that does not say what it was waiting for is a timeout, not a diagnosis.
    """

    reason = constants.RELAY_READINESS_TIMEOUT


class RelayNotStopped(RelayError):
    """The port still accepts a connection after the stop (AC3).

    An orphaned listener at the end of a run is a **failed run**, never a warning: it
    holds the port and poisons the next one.
    """

    reason = constants.RELAY_NOT_STOPPED


class RoomMintFailed(RelayError):
    """The relay did not mint a room (AC3/AC4)."""

    reason = constants.ROOM_MINT_FAILED


class PropagationEvidenceUnavailable(RelayError):
    """One of AC5's two evidence channels is absent or is not a channel at all."""

    reason = constants.PROPAGATION_EVIDENCE_UNAVAILABLE


class GateOrderViolation(RelayError):
    """A gate step arrived out of the pinned order (AC4).

    Defined here and imported by :mod:`obsidian_e2e.provisioning`, so both boundaries
    raise **the same type**: the run is agent-mediated, and a caller that catches one
    module's ordering refusal but not the other's gets to step around half the table.
    """

    reason = constants.GATE_ORDER_VIOLATION


# ---------------------------------------------------------------------------
# Value types — no credential is ever a field a record prints
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RelayRoom:
    """A room minted by the relay.

    ``id`` and ``token`` are minted **server-side** — a uuid and a nanoid — so nothing
    can predict or dictate them and no room id found in a vault may be reused. The token
    is not the owner's credential but it *is* a credential: it lives here in memory and
    in the provisioned settings file, and it is never printed, logged or recorded.
    """

    id: str
    token: str
    name: str
    base_url: str


@dataclass(frozen=True)
class RelayStopResult:
    """What a stop or a release actually did.

    ``stopped`` is the verdict of the **port probe**, not of the close call's return
    value: on Windows a termination that returned tells you only that it returned.
    """

    closed: bool
    stopped: bool
    port_free: Optional[bool]
    store_removed: bool = False
    reason: Optional[str] = None


@dataclass(frozen=True)
class PropagationEvidence:
    """The two channels AC5 requires, plus the two windows they were measured over."""

    positive: Optional[Mapping[str, object]] = None
    negative: Optional[Mapping[str, object]] = None
    positive_window_s: Optional[float] = None
    negative_window_s: Optional[float] = None


@dataclass(frozen=True)
class PropagationVerdict:
    """The mechanism's verdict — never a claim that propagation was *observed* here."""

    positive_observed: bool
    negative_leaked: bool
    satisfied: bool
    run_failed: bool
    reason: Optional[str]
    positive_window_s: float
    negative_window_s: float
    channels: tuple = (POSITIVE_CHANNEL, NEGATIVE_CHANNEL)


# ---------------------------------------------------------------------------
# The console seam
# ---------------------------------------------------------------------------


class RelayPlanConsole(PlanOnlyConsole):
    """``PlanOnlyConsole`` plus the two things a relay lifecycle needs.

    ``PlanOnlyConsole`` has neither a working directory on its launch payload nor a way
    to close a console. A relay needs both — the cwd *is* the store-path mechanism, and
    closing the console the rig itself opened is the only sanctioned way to stop the
    relay the rig itself started. Both are added here by subclassing, so ``lifecycle.py``
    is read and never modified.

    Nothing is started by this class either. It records the payloads an agent executes.
    """

    def run_command(  # type: ignore[override]
        self,
        argv: list,
        title: str = "",
        cwd: Optional[str] = None,
        env: Optional[Mapping[str, str]] = None,
    ) -> str:
        if not isinstance(argv, list):
            raise TypeError(f"argv must be a list, got {type(argv).__name__}")
        if not all(isinstance(part, str) for part in argv):
            raise TypeError("every argv element must be a string")
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
                        "title": title or "obsidian-e2e-relay",
                        "layout": "simple",
                        "cwd": None if cwd is None else str(cwd),
                        "env": dict(env or {}),
                    },
                },
            }
        )
        return console_id

    def close_console(self, console_id: str) -> dict:
        """Plan the close of a console **the rig opened**. It closes nothing else."""
        self._record(
            {
                "planned": True,
                "console_id": str(console_id),
                "mcp": {
                    "server_id": "visible-console",
                    "tool_name": "close_console",
                    "arguments": {"console_id": str(console_id)},
                },
            }
        )
        return {"console_id": str(console_id), "planned": True, "closed": None}


# ---------------------------------------------------------------------------
# Default probes — plain sockets and plain HTTP; no spawn is needed for any of them
# ---------------------------------------------------------------------------


def probe_port(host: str, port: int, timeout_s: Optional[float] = None) -> bool:
    """Return ``True`` when a connection to ``host:port`` **completes**.

    Deliberately not "returns False on a refused connection": on this host a closed port
    does not refuse, it swallows the SYN and the connect times out. Completion is the
    positive fact, and its absence — by refusal, by timeout, by anything — is the
    negative one.
    """
    budget = constants.RELAY_READY_CONNECT_TIMEOUT_S if timeout_s is None else timeout_s
    try:
        with socket.create_connection((host, port), timeout=budget):
            return True
    except OSError:
        return False


def probe_health(base_url: str, timeout_s: Optional[float] = None) -> Optional[dict]:
    """GET the relay's health endpoint and return the decoded body, or ``None``.

    ``None`` means "no positive statement" — the connection failed, the status was not
    ``200``, or the body was not a JSON object. It never means "probably ready".
    """
    budget = constants.RELAY_READY_CONNECT_TIMEOUT_S if timeout_s is None else timeout_s
    body = _request(base_url, "GET", constants.RELAY_HEALTH_PATH, None, budget)
    if body is None or not isinstance(body[1], dict) or body[0] != 200:
        return None
    return body[1]


def mint_room(base_url: str, name: str) -> dict:
    """Ask the relay to mint a room, and return its ``{id, token}`` verbatim.

    The relay mints both values itself; the client cannot dictate either. The shape is
    reused verbatim from the headless harness rather than reinvented. Neither value is
    printed or logged anywhere — the token is a credential.
    """
    result = _request(
        base_url,
        "POST",
        constants.RELAY_ROOMS_PATH,
        {"name": name},
        constants.RELAY_READY_CONNECT_TIMEOUT_S,
    )
    if result is None:
        raise RoomMintFailed(f"the relay at {base_url} did not answer a room request")
    status, body = result
    if status not in (200, 201) or not isinstance(body, dict):
        raise RoomMintFailed(
            f"the relay at {base_url} answered a room request with status {status}"
        )
    if not body.get("id") or not body.get("token"):
        # The keys are named, never the values.
        raise RoomMintFailed(
            f"the relay at {base_url} minted a room without an 'id' and a 'token'"
        )
    return body


def _request(
    base_url: str,
    method: str,
    path: str,
    payload: Optional[Mapping[str, object]],
    timeout_s: float,
):
    """Return ``(status, decoded_body)``, or ``None`` when the request did not complete."""
    parts = urlsplit(base_url)
    connection = http.client.HTTPConnection(
        parts.hostname or constants.RELAY_HOST, parts.port, timeout=timeout_s
    )
    try:
        if payload is None:
            connection.request(method, path)
        else:
            connection.request(
                method,
                path,
                body=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
            )
        response = connection.getresponse()
        raw = response.read()
        try:
            return response.status, json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            return response.status, None
    except (OSError, http.client.HTTPException):
        return None
    finally:
        connection.close()


# ---------------------------------------------------------------------------
# The relay lifecycle
# ---------------------------------------------------------------------------


class LocalRelay:
    """Build-or-verify, start, readiness, room, stop and release — for one run.

    Everything that touches the outside world is an injected seam: the console, the port
    probe, the health probe, the room minter, the clock and the pause. That is what makes
    the whole lifecycle testable without opening a socket or starting a process, and it
    is the same property that makes it impossible for a test to reach a real relay by
    accident.
    """

    def __init__(
        self,
        *,
        console,
        repo_root: PathLike,
        run_id: str,
        store_root: Optional[PathLike] = None,
        port_probe: Optional[Callable[[str, int], bool]] = None,
        health_probe: Optional[Callable[[str], Optional[dict]]] = None,
        room_minter: Optional[Callable[[str, str], Mapping[str, str]]] = None,
        clock: Optional[Callable[[], float]] = None,
        sleeper: Optional[Callable[[float], None]] = None,
    ) -> None:
        self._console = console
        self._repo_root = Path(repo_root)
        self._run_id = run_id
        self._store_root = Path(store_root) if store_root is not None else Path(_temp_root())
        self._port_probe = port_probe or probe_port
        self._health_probe = health_probe or probe_health
        self._room_minter = room_minter or mint_room
        self._clock = clock or _DEFAULT_CLOCK
        self._sleeper = sleeper or _DEFAULT_SLEEPER

        self._started = False
        self._started_by_rig = False
        self._ready = False
        self._stopped = False
        self._console_id: Optional[str] = None
        self._room: Optional[RelayRoom] = None
        self._health: Optional[dict] = None

    # -- read-only state -----------------------------------------------------

    @property
    def started(self) -> bool:
        """A launch payload reached the console. **Not** a readiness fact."""
        return self._started

    @property
    def started_by_rig(self) -> bool:
        """The rig owns this process, so the rig may stop it (D15/S2)."""
        return self._started_by_rig

    @property
    def ready(self) -> bool:
        return self._ready

    @property
    def stopped(self) -> bool:
        return self._stopped

    @property
    def console_id(self) -> Optional[str]:
        return self._console_id

    @property
    def room(self) -> Optional[RelayRoom]:
        return self._room

    @property
    def health(self) -> Optional[dict]:
        return self._health

    @property
    def run_id(self) -> str:
        return self._run_id

    @property
    def base_url(self) -> str:
        return constants.RELAY_BASE_URL

    @property
    def room_name(self) -> str:
        return f"{constants.RELAY_ROOM_NAME_PREFIX}{self._run_id}"

    @property
    def entry_path(self) -> Path:
        return self._repo_root / constants.RELAY_ENTRY_REL

    @property
    def server_dir(self) -> Path:
        return self._repo_root / constants.RELAY_SERVER_DIR_REL

    @property
    def store_dir(self) -> Path:
        """The run-scoped store directory. Named before it exists, so a refusal can be
        checked not to have created it."""
        return self._store_root / constants.RELAY_STORE_ROOT_NAME / self._run_id

    # -- the store -----------------------------------------------------------

    def prepare_store(self) -> Path:
        """Create the run-scoped store directory and its three subdirectories."""
        for relative in constants.RELAY_STORE_SUBDIRS:
            (self.store_dir / relative).mkdir(parents=True, exist_ok=True)
        return self.store_dir

    def store_paths(self) -> dict:
        """Return ``{relative subdirectory: absolute path}`` for the three stores."""
        self.prepare_store()
        return {rel: self.store_dir / rel for rel in constants.RELAY_STORE_SUBDIRS}

    def _remove_store(self) -> bool:
        directory = self.store_dir
        if not directory.exists():
            return False
        shutil.rmtree(directory, ignore_errors=True)
        return not directory.exists()

    # -- build ---------------------------------------------------------------

    def ensure_built(self) -> bool:
        """Verify the server entry point is present, building it once if it is not.

        Returns ``True`` when a build was planned. The build is the terminating ``tsc``
        script, so — unlike the plugin's dev build — it *is* awaited; there is no watch
        trap on this side.
        """
        if self.entry_path.is_file():
            return False
        console_id = self._console.run_command(
            ["npm", "run", constants.RELAY_BUILD_SCRIPT],
            title="obsidian-e2e-relay-build",
            cwd=str(self.server_dir),
        )
        self._console.await_console(console_id)
        if not self.entry_path.is_file():
            raise RelayBuildFailed(
                f"the server build did not produce {self.entry_path}; a build that did "
                "not emit an entry point is never a relay, whatever it exited with"
            )
        return True

    # -- start ---------------------------------------------------------------

    def start(self) -> str:
        """Refuse an occupied port, then plan exactly one launch. Never both.

        The refusal happens **before** anything reaches the console and before the store
        directory exists: a plan that reached the console is a process on the operator's
        machine, whatever the rig then reports.
        """
        if self._port_probe(constants.RELAY_HOST, constants.RELAY_PORT):
            raise RelayPortOccupied(
                f"{constants.RELAY_HOST}:{constants.RELAY_PORT} already has a listener; "
                "the rig neither adopts a relay it did not start nor terminates a "
                "process it does not own"
            )

        self.ensure_built()
        self.prepare_store()

        store = self.store_dir
        self._console_id = self._console.run_command(
            ["node", str(self.entry_path.resolve())],
            title="obsidian-e2e-relay",
            cwd=str(store),
            env={
                "PORT": str(constants.RELAY_PORT),
                # Belt and braces: this is the one store path the server reads from the
                # environment. The other two follow from the cwd and cannot be set at
                # all without a `server/` change, which is an abort criterion.
                "BLOB_STORE_PATH": str((store / constants.RELAY_STORE_SUBDIRS[0]).resolve()),
            },
        )
        self._started = True
        self._started_by_rig = True
        self._ready = False
        self._stopped = False
        return self._console_id

    # -- readiness -----------------------------------------------------------

    def wait_ready(self, timeout_s: Optional[float] = None) -> dict:
        """Poll the health endpoint until it reports ``ok``; expire naming the condition.

        The oracle is the body the server sends about itself. A spawn that returned is
        not readiness — node binds late — and neither is elapsed time.
        """
        if not self._started:
            raise GateOrderViolation(
                "readiness was awaited before the relay was started; the pinned order is "
                "port free -> started -> healthy -> room minted"
            )
        budget = constants.RELAY_READY_BUDGET_S if timeout_s is None else timeout_s
        deadline = self._clock() + budget
        while True:
            body = self._health_probe(self.base_url)
            if isinstance(body, _MappingABC) and body.get("ok") is True:
                self._health = dict(body)
                self._ready = True
                return dict(body)
            if self._clock() >= deadline:
                raise RelayReadinessTimeout(
                    f"the relay did not report {constants.RELAY_HEALTH_PATH} 'ok' within "
                    f"{budget}s; the awaited condition was a GET "
                    f"{constants.RELAY_HEALTH_PATH} answering with ok=true"
                )
            self._sleeper(constants.RELAY_READY_POLL_INTERVAL_S)

    # -- the room ------------------------------------------------------------

    def mint_room(self) -> RelayRoom:
        """Mint the run's room on **this** relay, once it has said it is healthy."""
        if not self._started:
            raise GateOrderViolation(
                "a room was requested before the relay was started; a room minted "
                "anywhere else is a room the run's peers cannot meet in"
            )
        if not self._ready:
            raise GateOrderViolation(
                f"a room was requested before {constants.RELAY_HEALTH_PATH} reported ok; "
                "a relay that has not said it is serving cannot mint the run's room"
            )
        payload = self._room_minter(self.base_url, self.room_name)
        if (
            not isinstance(payload, _MappingABC)
            or not payload.get("id")
            or not payload.get("token")
        ):
            raise RoomMintFailed(
                f"the relay at {self.base_url} did not return a room id and token"
            )
        self._room = RelayRoom(
            id=str(payload["id"]),
            token=str(payload["token"]),
            name=self.room_name,
            base_url=self.base_url,
        )
        return self._room

    # -- stop and release ----------------------------------------------------

    def stop(self, timeout_s: Optional[float] = None) -> RelayStopResult:
        """Stop the relay **the rig started**, and verify it by probing the port.

        A relay the rig did not start is reported, never closed and never terminated: on
        a developer machine, closing "whatever is on the relay port" closes the
        operator's own server. Calling this twice is safe; the second call closes
        nothing a second time.
        """
        self._ready = False

        if not self._started or self._console_id is None:
            # Nothing of the rig's is running. Report whatever is on the port — a
            # foreign listener is evidence for the run record, never a target.
            port_free = not self._port_probe(constants.RELAY_HOST, constants.RELAY_PORT)
            self._stopped = True
            return RelayStopResult(closed=False, stopped=True, port_free=port_free)

        self._console.close_console(self._console_id)

        budget = constants.RELAY_STOPPED_BUDGET_S if timeout_s is None else timeout_s
        deadline = self._clock() + budget
        while True:
            if not self._port_probe(constants.RELAY_HOST, constants.RELAY_PORT):
                self._started = False
                self._stopped = True
                return RelayStopResult(closed=True, stopped=True, port_free=True)
            if self._clock() >= deadline:
                self._stopped = False
                raise RelayNotStopped(
                    f"{constants.RELAY_HOST}:{constants.RELAY_PORT} still completes a "
                    f"connection {budget}s after the console was closed; an orphaned "
                    "listener holds the port and poisons the next run"
                )
            self._sleeper(constants.RELAY_STOPPED_POLL_INTERVAL_S)

    def release(self, timeout_s: Optional[float] = None) -> RelayStopResult:
        """Stop, then remove the run-scoped store directory. Safe to call twice.

        Called unconditionally from teardown, so a stop that refuses must not prevent
        the store from being removed — both are attempted and both are reported.
        """
        closed = False
        stopped = False
        port_free: Optional[bool] = None
        reason: Optional[str] = None
        try:
            result = self.stop(timeout_s)
            closed, stopped, port_free = result.closed, result.stopped, result.port_free
        except RelayNotStopped as err:
            closed = True
            stopped = False
            port_free = False
            reason = err.reason
        store_removed = self._remove_store()
        return RelayStopResult(
            closed=closed,
            stopped=stopped,
            port_free=port_free,
            store_removed=store_removed,
            reason=reason,
        )

    # -- every exit path -----------------------------------------------------

    def __enter__(self) -> "LocalRelay":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        """Release on success, failure, abort **and** interruption.

        ``KeyboardInterrupt`` and ``SystemExit`` derive from ``BaseException``, so a
        teardown hung off ``except Exception`` misses exactly the two paths on which a
        relay is most likely to be left holding the port. ``__exit__`` runs for all of
        them. The run's own failure is what must reach the caller, so a stuck relay is
        reported through the record rather than substituted for it.
        """
        try:
            self.release()
        except BaseException:  # noqa: BLE001 - teardown never replaces the run's failure
            pass
        return False


def _temp_root() -> str:
    import tempfile

    return tempfile.gettempdir()


# ---------------------------------------------------------------------------
# AC5 — the mechanism and its two channels. Not the demonstration.
# ---------------------------------------------------------------------------


def evaluate_propagation(evidence: PropagationEvidence) -> PropagationVerdict:
    """Evaluate AC5's two channels, and refuse rather than infer.

    ⚠ **This does not observe propagation and may not be cited as evidence that any was
    observed.** AC5's positive leg needs two real Obsidian instances, which is a later
    work package's run. What lives here is the mechanism: the two channels, the
    conditions under which each is a channel at all, and the refusals.

    Three distinct outcomes, deliberately not collapsed into one:

    ├── a channel is **absent, incomplete, or not a control at all** → refusal
    ├── both channels are present and the change arrived **anyway** → a FAILED run under
    │   its own name, never a stronger result and never re-run until green
    └── both present, the relay saw two distinct clients carry traffic on the run's
        document, and the change did not arrive without it → satisfied
    """
    positive = evidence.positive
    negative = evidence.negative

    if positive is None or negative is None:
        missing = POSITIVE_CHANNEL if positive is None else ""
        if negative is None:
            missing = f"{missing} {NEGATIVE_CHANNEL}".strip()
        raise PropagationEvidenceUnavailable(
            f"AC5 needs two independent channels and one is absent: {missing}"
        )

    if evidence.positive_window_s is None or evidence.negative_window_s is None:
        raise PropagationEvidenceUnavailable(
            "AC5's channels carry no measured window; a negative control that was not "
            "timed cannot be compared with the positive leg it must outlast"
        )

    absent = [key for key in RELAY_EVIDENCE_KEYS if key not in positive]
    if absent:
        raise PropagationEvidenceUnavailable(
            f"the {POSITIVE_CHANNEL} channel is missing the relay-side key(s) "
            f"{', '.join(absent)}; content observed in vault B is not a relay-side "
            "observation and may not be substituted for one"
        )

    absent_negative = [key for key in NEGATIVE_EVIDENCE_KEYS if key not in negative]
    if absent_negative:
        raise PropagationEvidenceUnavailable(
            f"the {NEGATIVE_CHANNEL} channel is missing the key(s) "
            f"{', '.join(absent_negative)}"
        )

    if negative.get("relayMediated") is not False:
        raise PropagationEvidenceUnavailable(
            f"the {NEGATIVE_CHANNEL} was run with the relay-mediated path in place; a "
            "control that keeps the thing it controls for is not a control"
        )

    positive_window = float(evidence.positive_window_s)
    negative_window = float(evidence.negative_window_s)
    if negative_window < positive_window:
        raise PropagationEvidenceUnavailable(
            f"the {NEGATIVE_CHANNEL} window of {negative_window}s is shorter than the "
            f"{positive_window}s the positive leg needed; a change that had no time to "
            "arrive by the other path proves nothing about the other path"
        )

    positive_observed = (
        _count(positive, "documents") >= 1
        and _count(positive, "clients") >= 2
        and _count(positive, "frames") >= 1
        and bool(positive.get("roomId"))
    )
    negative_leaked = bool(negative.get("changed"))

    if negative_leaked:
        # The seductive misreading is "both legs passed, so the result is stronger". A
        # change that arrives without the relay means the run can attribute nothing to
        # the relay, and the engine that can do that fires at instance start-up.
        reason: Optional[str] = constants.NEGATIVE_CONTROL_LEAKED
        satisfied = False
        run_failed = True
    elif not positive_observed:
        reason = constants.PROPAGATION_EVIDENCE_UNAVAILABLE
        satisfied = False
        run_failed = False
    else:
        reason = None
        satisfied = True
        run_failed = False

    return PropagationVerdict(
        positive_observed=positive_observed,
        negative_leaked=negative_leaked,
        satisfied=satisfied,
        run_failed=run_failed,
        reason=reason,
        positive_window_s=positive_window,
        negative_window_s=negative_window,
    )


def _count(channel: Mapping[str, object], key: str) -> int:
    value = channel.get(key)
    return value if isinstance(value, int) and not isinstance(value, bool) else 0
