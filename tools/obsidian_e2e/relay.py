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
    "Secret",
    "RedactedMapping",
    "mint_room",
    "evaluate_propagation",
    "relay_observation",
    "build_relay_channel",
    "build_negative_channel",
    "build_propagation_evidence",
    "RELAY_EVIDENCE_KEYS",
    "NEGATIVE_EVIDENCE_KEYS",
    "SECRET_BEARING_KEYS",
    "REDACTED",
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

#: Member names whose *values* are credentials. Nothing keyed by one of these may be
#: rendered by a general-purpose stringification, and no evidence channel may carry one:
#: a channel is a statement about what the relay counted, and a credential can only have
#: arrived there by a caller copying a settings payload into it.
SECRET_BEARING_KEYS = constants.SECRET_SETTINGS_KEYS

#: What every general-purpose rendering of a secret produces instead of the value. Named
#: at module scope so a caller, a run record or a checker can *assert* that a rendering
#: was redacted rather than merely assert that the secret is absent — "the token is not in
#: this string" is also true of a string that dropped the field entirely.
REDACTED = "<redacted>"

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
# Secret-bearing values — a type, not an audit
# ---------------------------------------------------------------------------


class Secret:
    """A value that carries a credential, and therefore cannot be *rendered*.

    The rule this type exists to make structural: **a value that carries a secret cannot
    be rendered by any general-purpose stringification, and cannot arrive in a message,
    a log record or a traceback by accident.**

    Auditing call sites is a promise; a type is a guarantee. The audit form of this rule
    fails in the ordinary way — ``@dataclass`` synthesises a ``__repr__`` that prints
    every field, ``repr()`` is what ``str()`` falls back to, ``logging``'s lazy ``%s``
    interpolation renders at emit time and long after the call site was reviewed, and an
    exception carries its arguments into every traceback that is ever printed. Each of
    those is a *different* call site, and every one of them reaches the same object. So
    the object refuses instead:

    ├── ``__repr__`` / ``__str__`` / ``__format__`` ─ redacted, so f-strings, ``%s``,
    │   ``.format()``, ``print``, ``logging`` and traceback rendering all yield nothing
    ├── ``__bytes__`` / ``__iter__`` / ``__contains__`` ─ refused outright, so no
    │   slicing, joining or membership test can spell the value out one piece at a time
    └── :meth:`reveal` ─ the **only** accessor, and it has to be written at the call
        site, which is exactly what makes the few legitimate uses greppable

    Equality is deliberately *not* closed: comparing a secret against a candidate is an
    explicit act by a caller who already holds the candidate, and it discloses nothing
    the caller did not have. Rendering is the accidental act, and rendering is what is
    shut.
    """

    __slots__ = ("_value",)

    #: The module-level placeholder, bound here so ``Secret.REDACTED`` and
    #: :data:`REDACTED` can never drift apart.
    REDACTED = REDACTED

    def __init__(self, value: object) -> None:
        object.__setattr__(
            self, "_value", value.reveal() if isinstance(value, Secret) else value
        )

    # -- the one explicit accessor -------------------------------------------

    def reveal(self):
        """Return the wrapped value. The only way out, and it is spelled at the site."""
        return self._value

    # -- immutable: a secret that can be swapped is a secret nobody can reason about --

    def __setattr__(self, name: str, value: object) -> None:
        raise AttributeError(f"{type(self).__name__} is immutable")

    def __delattr__(self, name: str) -> None:
        raise AttributeError(f"{type(self).__name__} is immutable")

    # -- copying keeps the wrapper, and never unwraps ------------------------
    #
    # ``copy.deepcopy`` — which ``dataclasses.asdict`` uses on every leaf — reconstructs
    # by assigning attributes, which the immutability above refuses. Left alone that is a
    # trap: a run-record writer calling ``asdict(record)`` gets an ``AttributeError``, and
    # the obvious workaround is to unwrap the secret first, which is the whole failure
    # this type exists to prevent. An immutable value is its own copy, so both hand the
    # *wrapper* back and the redaction survives the copy.

    def __copy__(self) -> "Secret":
        return self

    def __deepcopy__(self, memo: dict) -> "Secret":
        return self

    def __reduce__(self):
        return (type(self), (self._value,))

    # -- every general-purpose rendering path, closed -------------------------

    def __repr__(self) -> str:
        return f"{type(self).__name__}({self.REDACTED})"

    def __str__(self) -> str:
        return self.REDACTED

    def __format__(self, format_spec: str) -> str:
        return self.REDACTED

    def __bytes__(self) -> bytes:
        raise TypeError(f"{type(self).__name__} refuses to be encoded; use .reveal()")

    def __iter__(self):
        raise TypeError(f"{type(self).__name__} refuses to be iterated; use .reveal()")

    def __contains__(self, item: object) -> bool:
        raise TypeError(f"{type(self).__name__} refuses membership tests; use .reveal()")

    # -- comparison and truthiness disclose nothing ---------------------------

    def __eq__(self, other: object) -> bool:
        if isinstance(other, Secret):
            return self._value == other.reveal()
        return self._value == other

    def __ne__(self, other: object) -> bool:
        return not self.__eq__(other)

    def __hash__(self) -> int:
        return hash(self._value)

    def __bool__(self) -> bool:
        return bool(self._value)


class RedactedMapping(dict):
    """A ``dict`` whose secret-bearing members are never rendered.

    The same property as :class:`Secret`, one level up: a *mapping* that carries a
    credential under a known key is exactly as renderable as the credential itself, and
    a caller that logs "the member set it is about to provision" is the ordinary way
    that happens. Subscripting still returns the real value — this closes the rendering
    path, not the use.
    """

    #: The member names whose values are redacted when this mapping is rendered.
    SECRET_KEYS = SECRET_BEARING_KEYS

    def __repr__(self) -> str:
        rendered = ", ".join(
            f"{key!r}: {Secret.REDACTED if key in self.SECRET_KEYS else repr(value)}"
            for key, value in self.items()
        )
        return "{" + rendered + "}"

    def __str__(self) -> str:
        return self.__repr__()


# ---------------------------------------------------------------------------
# Value types — no credential is ever a field a record prints
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RelayRoom:
    """A room minted by the relay.

    ``id`` and ``token`` are minted **server-side** — a uuid and a nanoid — so nothing
    can predict or dictate them and no room id found in a vault may be reused.

    ``POST /rooms`` mints the token server-side, so it is a **live credential** and not a
    fixture value. It is therefore not stored in a renderable field at all: whatever a
    caller passes is normalised into a :class:`Secret`, so the ``__repr__`` ``@dataclass``
    generates for this class prints ``token=Secret(<redacted>)`` and every derived
    rendering — ``str()``, an f-string, ``%s`` in a log record, a traceback frame's local
    variables — prints the same. :meth:`reveal_token` is the one way to the value, and it
    has exactly two legitimate callers: the settings splice that writes it into the
    provisioned file, and the client that hands it to the relay.
    """

    id: str
    token: Secret
    name: str
    base_url: str

    def __post_init__(self) -> None:
        if not isinstance(self.token, Secret):
            object.__setattr__(self, "token", Secret(self.token))

    def reveal_token(self):
        """Return the minted token. Spelled out at the call site, deliberately."""
        return self.token.reveal()


@dataclass(frozen=True)
class RelayStopResult:
    """What a stop or a release actually did.

    ``stopped`` is the verdict of the **port probe**, not of the close call's return
    value: on Windows a termination that returned tells you only that it returned.

    ``host`` and ``port`` are what was actually probed rather than what the constants
    say, so a run driven against an overridden port reports the port it drove.

    ``probes`` is how many times the port was actually asked. It is here because the
    verdict is only worth what the evidence behind it is worth: a result that says
    ``stopped=True`` after **zero** probes is a result that inferred the stop from the
    close call's return, which is the exact substitution this whole path exists to
    forbid, and without this field the two are indistinguishable in a run record.
    """

    closed: bool
    stopped: bool
    port_free: Optional[bool]
    store_removed: bool = False
    reason: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = None
    probes: int = 0


@dataclass(frozen=True)
class PropagationEvidence:
    """The two channels AC5 requires, plus the two windows they were measured over.

    The ``__repr__`` is written rather than generated: a channel is a mapping a *caller*
    built, so nothing about it is under this module's control, and a generated repr would
    print whatever the caller put in it — including a token copied out of a settings
    payload. The rendering therefore states each channel's **key set** and the two
    windows, which is what a run record needs, and never a channel's values.
    """

    positive: Optional[Mapping[str, object]] = None
    negative: Optional[Mapping[str, object]] = None
    positive_window_s: Optional[float] = None
    negative_window_s: Optional[float] = None

    def __repr__(self) -> str:
        return (
            f"{type(self).__name__}("
            f"positive_keys={_channel_keys(self.positive)!r}, "
            f"negative_keys={_channel_keys(self.negative)!r}, "
            f"positive_window_s={self.positive_window_s!r}, "
            f"negative_window_s={self.negative_window_s!r})"
        )

    def __str__(self) -> str:
        return self.__repr__()


def _channel_keys(channel: object) -> Optional[tuple]:
    """Return a channel's key names, or ``None`` when it is not a mapping at all."""
    if isinstance(channel, _MappingABC):
        return tuple(str(key) for key in channel)
    return None


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
    """Ask the relay to mint a room, and return its ``{id, token}``.

    The relay mints both values itself; the client cannot dictate either. The shape is
    reused verbatim from the headless harness rather than reinvented.

    The payload is returned as a :class:`RedactedMapping` rather than as the plain
    ``dict`` the JSON decoder produced. The token in it is a **live credential minted
    server-side**, and a plain mapping handed back to a caller is one ``logging.debug``
    away from being in a log file — so the value stays reachable by subscript and
    unreachable by rendering.
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
    if not body.get("id") or not body.get(constants.SETTINGS_TOKEN_KEY):
        # The keys are named, never the values.
        raise RoomMintFailed(
            f"the relay at {base_url} minted a room without an 'id' and a "
            f"{constants.SETTINGS_TOKEN_KEY!r}"
        )
    return RedactedMapping(body)


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
        host: Optional[str] = None,
        port: Optional[int] = None,
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
        # An override is an override *everywhere*: one resolved endpoint feeds the free
        # probe, the launch payload, the health URL, the room URL, the stop probe, every
        # refusal message and the stop record. A run driven against a different port that
        # reports the pinned one has reported something it did not do.
        self._host = constants.RELAY_HOST if host is None else str(host)
        self._port = constants.RELAY_PORT if port is None else int(port)
        if self._port <= 0:
            raise ValueError(f"the relay port must be a positive integer, got {self._port!r}")
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
    def host(self) -> str:
        """The host actually probed and launched against — the override when there is one."""
        return self._host

    @property
    def port(self) -> int:
        """The port actually probed and launched against — the override when there is one."""
        return self._port

    @property
    def base_url(self) -> str:
        """The base URL of **this** relay, derived from the endpoint actually in use.

        The pinned constant is returned unchanged for the pinned endpoint, so the digits
        of the port still live in exactly one place; an overridden endpoint is rendered
        from the pinned URL's own scheme rather than from a second spelling of it.
        """
        if self._host == constants.RELAY_HOST and self._port == constants.RELAY_PORT:
            return constants.RELAY_BASE_URL
        scheme = urlsplit(constants.RELAY_BASE_URL).scheme
        return f"{scheme}://{self._host}:{self._port}"

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

    def _port_answers(self) -> bool:
        """``True`` when the port is known to accept a connection.

        An **exception** out of the probe is neither of the two facts: it is "not known".
        On this side it is folded into "occupied", and that direction is deliberate and is
        the same one in both callers — a port the rig cannot establish as free is a port
        it does not start on, and a port it cannot establish as free is not a port it
        reports as released. The unknowable case never becomes the permissive one.
        """
        try:
            return bool(self._port_probe(self._host, self._port))
        except Exception:  # noqa: BLE001 - unknown is never "free"; see the docstring
            return True

    def start(self) -> str:
        """Refuse an occupied port, then plan exactly one launch. Never both.

        The refusal happens **before** anything reaches the console, before the build and
        before the store directory exists: a plan that reached the console is a process on
        the operator's machine, whatever the rig then reports. It is also *repeatable* —
        the refusal changes no state at all, so a second call refuses identically and a
        refused port never turns into an adopted one.
        """
        if self._started:
            # A relay is a process, not a flag. Planning a second launch while the first
            # is up puts a second node on a port the first one holds, and leaves the rig
            # owning a console id it can no longer close.
            raise GateOrderViolation(
                f"the relay on {self._host}:{self._port} is already started; a second "
                "launch would put a second process on a port the first one holds"
            )
        if self._port_answers():
            raise RelayPortOccupied(
                f"{self._host}:{self._port} already has a listener, or could not be "
                "established as free; the rig neither adopts a relay it did not start "
                "nor terminates a process it does not own"
            )

        self.ensure_built()
        self.prepare_store()

        store = self.store_dir
        self._console_id = self._console.run_command(
            ["node", str(self.entry_path.resolve())],
            title="obsidian-e2e-relay",
            cwd=str(store),
            env={
                "PORT": str(self._port),
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

    def _probe_health_once(self) -> Optional[dict]:
        """One readiness observation: the body, or ``None`` for *not ready yet*.

        A refused connection, a socket timeout, a truncated response and a body that is
        not JSON are all the **same** fact — the relay has not yet said it is serving —
        and none of them is an error. Treating any of them as an error turns "node has not
        finished binding" into a failed run, and node binds late by construction. Only the
        expiry of the bounded budget is an error, and it names what it was waiting for.
        """
        try:
            body = self._health_probe(self.base_url)
        except (OSError, http.client.HTTPException, ValueError, UnicodeDecodeError):
            return None
        return body if isinstance(body, _MappingABC) else None

    def wait_ready(self, timeout_s: Optional[float] = None) -> dict:
        """Poll the health endpoint until it reports ``ok``; expire naming the condition.

        The oracle is the body the server sends about itself. A spawn that returned is
        not readiness — node binds late — and neither is elapsed time.

        Readiness, once established, is a fact about this relay and is **not re-probed**:
        a second call returns the body that established it. Re-probing would let a run
        that was ready become not-ready because of one dropped packet, which is a flake
        the rig would then attribute to the thing under test.
        """
        if not self._started:
            raise GateOrderViolation(
                "readiness was awaited before the relay was started; the pinned order is "
                "port free -> started -> healthy -> room minted"
            )
        if self._ready and self._health is not None:
            return dict(self._health)
        budget = constants.RELAY_READY_BUDGET_S if timeout_s is None else timeout_s
        deadline = self._clock() + budget
        while True:
            body = self._probe_health_once()
            if body is not None and body.get("ok") is True:
                self._health = dict(body)
                self._ready = True
                return dict(body)
            if self._clock() >= deadline:
                raise RelayReadinessTimeout(
                    f"the relay at {self.base_url} did not report "
                    f"{constants.RELAY_HEALTH_PATH} 'ok' within {budget}s; the awaited "
                    f"condition was a GET {constants.RELAY_HEALTH_PATH} answering with "
                    "ok=true"
                )
            self._sleeper(constants.RELAY_READY_POLL_INTERVAL_S)

    # -- the room ------------------------------------------------------------

    def mint_room(self) -> RelayRoom:
        """Mint the run's room on **this** relay, once it has said it is healthy.

        Single-shot, and that is a correctness property rather than an optimisation: the
        run's two peers are provisioned with *one* room id and *one* token, so a second
        minting on the same relay produces a second room that half the run could end up
        pointed at — two peers that connect successfully to places where they cannot
        meet, which reads as a sync bug and is not one.
        """
        if self._room is not None:
            raise GateOrderViolation(
                f"a room has already been minted on the relay at {self.base_url}; a run "
                "has exactly one room, and a second one is a place its peers cannot meet"
            )
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
            or not payload.get(constants.SETTINGS_TOKEN_KEY)
        ):
            raise RoomMintFailed(
                f"the relay at {self.base_url} did not return a room id and token"
            )
        # The token goes straight into a Secret. It is never held as a plain string on
        # this object, so no rendering of the relay, the room or a traceback frame that
        # holds either can spell it out.
        minted = payload[constants.SETTINGS_TOKEN_KEY]
        self._room = RelayRoom(
            id=str(payload["id"]),
            token=minted if isinstance(minted, Secret) else Secret(str(minted)),
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

        The oracle is *"a connection no longer completes within a bounded budget"*, not
        *"a connection is refused"*: measured on this host, a port with nothing listening
        does not send an RST at all — every unused port drops the SYN and the connect
        raises ``TimeoutError`` after consuming its whole timeout. An oracle written
        against refusal could never fire here and would look correct only because a
        surrounding handler swallowed the timeout. The reading is non-vacuous because the
        positive direction was measured too: a live relay accepted the connection and
        answered its health endpoint on the first poll, so the two states are
        distinguishable and both halves are kept.
        """
        self._ready = False
        probes = 0

        if not self._started or self._console_id is None:
            # Nothing of the rig's is running. Report whatever is on the port — a
            # foreign listener is evidence for the run record, never a target.
            port_free = not self._port_answers()
            probes += 1
            self._stopped = True
            return RelayStopResult(
                closed=False,
                stopped=True,
                port_free=port_free,
                host=self._host,
                port=self._port,
                probes=probes,
            )

        self._console.close_console(self._console_id)

        budget = constants.RELAY_STOPPED_BUDGET_S if timeout_s is None else timeout_s
        deadline = self._clock() + budget
        while True:
            answers = self._port_answers()
            probes += 1
            if not answers:
                self._started = False
                self._stopped = True
                return RelayStopResult(
                    closed=True,
                    stopped=True,
                    port_free=True,
                    host=self._host,
                    port=self._port,
                    probes=probes,
                )
            if self._clock() >= deadline:
                self._stopped = False
                raise RelayNotStopped(
                    f"{self._host}:{self._port} still completes a connection {budget}s "
                    "after the console was closed; an orphaned listener holds the port "
                    "and poisons the next run"
                )
            self._sleeper(constants.RELAY_STOPPED_POLL_INTERVAL_S)

    def release(self, timeout_s: Optional[float] = None) -> RelayStopResult:
        """Stop, then remove the run-scoped store directory. Safe to call twice.

        Two obligations that are often confused, kept apart here:

        ├── **This step finishes its own work whatever happens.** A stop that fails must
        │   not prevent the store from being removed, for *every* way it can fail and not
        │   only the named one — an unexpected exception out of the console seam that
        │   skipped the removal would leave a run-scoped LevelDB store on the operator's
        │   machine, which is the failure AC3 exists to prevent.
        └── **…and then it reports the failure by raising.** An orphaned listener is a
            **failed run**, not a field. Swallowing it into ``reason`` on a returned
            record makes a failed run look like a successful call to every caller that
            does not think to inspect the record, and "teardown runs to completion even
            when a step fails" is a property of the *teardown driver*
            (:func:`obsidian_e2e.provisioning.run_teardown`), not a licence for a step to
            hide its own failure. That driver is what keeps a stuck relay from stopping
            either vault's restore, and it can only do that for failures it is told about.
        """
        failure: Optional[BaseException] = None
        result: Optional[RelayStopResult] = None
        try:
            result = self.stop(timeout_s)
        except BaseException as err:  # noqa: BLE001 - the store is removed regardless
            failure = err

        store_removed = self._remove_store()

        if failure is not None:
            raise failure

        assert result is not None
        return RelayStopResult(
            closed=result.closed,
            stopped=result.stopped,
            port_free=result.port_free,
            store_removed=store_removed,
            reason=result.reason,
            host=self._host,
            port=self._port,
            probes=result.probes,
        )

    # -- AC5's positive channel, built only from what this relay actually said --

    def retained_frames(self) -> int:
        """Count the frames **this relay's own store** retained for the run.

        Read off the run-scoped directory the relay was started in, not taken from a
        caller. That is the point of the channel: a hermetic relay's own accounting is
        evidence no file-copying engine can manufacture, and a count a caller supplies is
        evidence about the caller.
        """
        frames_dir = self.store_dir / constants.RELAY_STORE_SUBDIRS[0]
        if not frames_dir.is_dir():
            return 0
        return sum(1 for entry in frames_dir.rglob("*") if entry.is_file())

    def propagation_channel(self, *, frames: object = None) -> dict:
        """Build AC5's positive channel out of **this** relay's own accounting.

        A channel that cannot exist yet cannot be built: the relay's counts are only
        evidence about the run's room, so a relay that never minted one has nothing to
        report about it, and a relay that never said it was serving never reported
        anything at all. Both are :data:`PROPAGATION_EVIDENCE_UNAVAILABLE` — the same
        refusal a caller gets for handing in a channel that is missing a key, because it
        is the same fact.

        ``frames`` defaults to :meth:`retained_frames`, i.e. to what the relay's store
        actually holds; it is overridable only so a caller that has already counted does
        not have to walk the directory twice.

        Every value is type-validated rather than tested for truth: a count that is not a
        genuine integer is not a small count, it is a channel that did not measure
        anything. And the channel carries **no token** — it is an accounting of documents,
        clients and frames, and a credential can only have got in by being copied there.
        """
        if not self._ready or self._health is None:
            raise PropagationEvidenceUnavailable(
                f"the {POSITIVE_CHANNEL} channel cannot be built from a relay that never "
                f"reported {constants.RELAY_HEALTH_PATH} ok; a relay that never said it "
                "was serving observed nothing"
            )
        if self._room is None:
            raise PropagationEvidenceUnavailable(
                f"the {POSITIVE_CHANNEL} channel cannot be built from a relay with no "
                "minted room; there is no room for its counts to be about"
            )
        if frames is None:
            frames = self.retained_frames()
        if not _is_count(frames):
            raise PropagationEvidenceUnavailable(
                f"the {POSITIVE_CHANNEL} channel needs a retained-frame count as a "
                "non-negative integer; a missing or wrongly-typed count is not a count "
                "of zero"
            )
        channel = {
            "roomId": self._room.id,
            "documents": self._health.get("documents"),
            "clients": self._health.get("clients"),
            "frames": int(frames),
        }
        missing = [key for key in RELAY_EVIDENCE_KEYS if key not in channel]
        if missing:
            raise PropagationEvidenceUnavailable(
                f"the {POSITIVE_CHANNEL} channel is missing the relay-side key(s) "
                f"{', '.join(missing)}"
            )
        for key in ("documents", "clients"):
            if not _is_count(channel[key]):
                raise PropagationEvidenceUnavailable(
                    f"the {POSITIVE_CHANNEL} channel's {key!r} is not a relay-reported "
                    f"integer count; {constants.RELAY_HEALTH_PATH} did not say it"
                )
        return _checked_channel(channel, POSITIVE_CHANNEL)

    #: The same builder under the name a caller reading AC5 is likely to reach for.
    relay_channel = propagation_channel

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
#
# One rule runs through everything below: **validate the type, never the truthiness.**
# Anything that decides a run's verdict is decided on what a value *is*, not on whether
# it is falsy. `0` is not `False`, `""` is not "absent", `None` is not "no", and an
# empty or wrongly-typed channel is *absent* rather than falsy-but-present. Truthiness
# collapses distinctions that are exactly the ones a verdict turns on, and it collapses
# them silently.
# ---------------------------------------------------------------------------


def _is_int(value: object) -> bool:
    """``True`` for a genuine integer. ``bool`` is excluded: it is not a count."""
    return isinstance(value, int) and not isinstance(value, bool)


def _is_count(value: object) -> bool:
    """``True`` for a genuine non-negative integer — the shape a *built* count may take."""
    return _is_int(value) and value >= 0


def _is_window(value: object) -> bool:
    """``True`` for a real, finite, strictly positive measured window.

    Zero is refused rather than read as "no wait was needed": a window of zero is a leg
    that was never given a chance to happen, and a negative one is a measurement that
    cannot have been taken. Neither is a short observation; both are the absence of one.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    return value == value and value not in (float("inf"), float("-inf")) and value > 0


def _checked_channel(channel: Mapping[str, object], name: str) -> dict:
    """Return ``channel`` as a plain dict, refusing one that carries a credential.

    An evidence channel is an accounting of what the relay counted. A member keyed by a
    secret-bearing name can only have arrived by a caller copying a settings payload into
    it, and a channel goes into run records — so it is refused at the boundary rather
    than redacted downstream, where one renderer that has not heard about it is enough.
    """
    leaked = [key for key in channel if key in SECRET_BEARING_KEYS]
    if leaked:
        raise PropagationEvidenceUnavailable(
            f"the {name} channel carries the credential-bearing key(s) "
            f"{', '.join(sorted(leaked))}; an evidence channel is a count, never a secret"
        )
    return dict(channel)


def _require_channel(channel: object, name: str, keys: tuple) -> dict:
    """Return the channel, or refuse — absent, not-a-mapping and empty are one fact."""
    if channel is None:
        raise PropagationEvidenceUnavailable(
            f"AC5 needs two independent channels and one is absent: {name}"
        )
    if not isinstance(channel, _MappingABC):
        raise PropagationEvidenceUnavailable(
            f"the {name} channel is a {type(channel).__name__} rather than a mapping of "
            "observations; a value that is not a channel is an absent channel"
        )
    if len(channel) == 0:
        raise PropagationEvidenceUnavailable(
            f"the {name} channel is empty; an empty channel is an absent channel, not a "
            "channel that observed nothing"
        )
    checked = _checked_channel(channel, name)
    absent = [key for key in keys if key not in checked]
    if absent:
        raise PropagationEvidenceUnavailable(
            f"the {name} channel is missing the key(s) {', '.join(absent)}"
        )
    return checked


def relay_observation(local_relay: "LocalRelay", *, frames: object = None) -> dict:
    """Build AC5's positive channel from what **the relay itself** holds.

    Module-level form of :meth:`LocalRelay.propagation_channel`, and the name AC5's own
    wording reaches for: the positive leg is *a relay-side observation*. ``frames``
    defaults to the count of what the run's own store retained.
    """
    return local_relay.propagation_channel(frames=frames)


#: The same builder under the name that says what it is built *from*.
build_relay_channel = relay_observation


def build_negative_channel(*, relay_mediated: object, changed: object) -> dict:
    """Build AC5's negative control channel, refusing anything that is not a verdict.

    Both members are verdicts, so both must be actual booleans: ``0`` is not ``False``
    and ``None`` is not "the change did not arrive". A control whose two statements are
    not statements is not a control.
    """
    if not isinstance(relay_mediated, bool) or not isinstance(changed, bool):
        raise PropagationEvidenceUnavailable(
            f"the {NEGATIVE_CHANNEL} channel's 'relayMediated' and 'changed' must both be "
            "booleans; a falsy stand-in is not a verdict"
        )
    if relay_mediated:
        raise PropagationEvidenceUnavailable(
            f"the {NEGATIVE_CHANNEL} was run with the relay-mediated path in place; a "
            "control that keeps the thing it controls for is not a control"
        )
    return {"relayMediated": relay_mediated, "changed": changed}


def build_propagation_evidence(
    local_relay: "LocalRelay",
    *,
    frames: object = None,
    positive_window_s: object,
    negative_window_s: object,
    changed: object,
) -> PropagationEvidence:
    """Build both channels and the two windows, refusing at the first thing that is not one."""
    positive = build_relay_channel(local_relay, frames=frames)
    negative = build_negative_channel(relay_mediated=False, changed=changed)
    if not _is_window(positive_window_s) or not _is_window(negative_window_s):
        raise PropagationEvidenceUnavailable(
            "AC5's channels carry no measured window; a window that is absent, zero, "
            "negative or not a number is not a shorter observation but the absence of one"
        )
    return PropagationEvidence(
        positive=positive,
        negative=negative,
        positive_window_s=float(positive_window_s),
        negative_window_s=float(negative_window_s),
    )


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
    if evidence.positive is None and evidence.negative is None:
        raise PropagationEvidenceUnavailable(
            f"AC5 needs two independent channels and both are absent: "
            f"{POSITIVE_CHANNEL} {NEGATIVE_CHANNEL}"
        )

    positive = _require_channel(evidence.positive, POSITIVE_CHANNEL, RELAY_EVIDENCE_KEYS)
    negative = _require_channel(evidence.negative, NEGATIVE_CHANNEL, NEGATIVE_EVIDENCE_KEYS)

    # The positive channel's keys must be present *and* be relay-side observations.
    # Content observed in vault B is not one and may not be substituted for one, however
    # it is dressed up: a file-copying engine can manufacture vault-B content and cannot
    # manufacture a hermetic relay's own document and client counts.
    if not isinstance(positive["roomId"], str) or not positive["roomId"].strip():
        raise PropagationEvidenceUnavailable(
            f"the {POSITIVE_CHANNEL} channel names no room; counts that are not about "
            "the run's own room are not about the run"
        )
    # The **type** decides whether this is a channel; the **value** decides the verdict.
    # A count that is not an integer at all is a channel that measured nothing, and that
    # is a refusal. A count that is an integer but is too small — or is impossible, like a
    # negative one — is a measurement, and a measurement that does not meet the criterion
    # is `positive_observed=False`, not an abort. Collapsing the two would either turn a
    # legible "not enough traffic" into an exception or a malformed channel into a quiet
    # zero, and those are the two errors this split exists to keep apart.
    for key in ("documents", "clients", "frames"):
        if not _is_int(positive[key]):
            raise PropagationEvidenceUnavailable(
                f"the {POSITIVE_CHANNEL} channel's {key!r} is not an integer count; a "
                "wrongly-typed count is a channel that measured nothing, not a count of "
                "zero"
            )

    mediated = negative["relayMediated"]
    changed = negative["changed"]
    if not isinstance(mediated, bool) or not isinstance(changed, bool):
        raise PropagationEvidenceUnavailable(
            f"the {NEGATIVE_CHANNEL} channel's 'relayMediated' and 'changed' must both be "
            "booleans; a falsy stand-in is not a verdict, and a verdict is what a control "
            "consists of"
        )
    if mediated is not False:
        raise PropagationEvidenceUnavailable(
            f"the {NEGATIVE_CHANNEL} was run with the relay-mediated path in place; a "
            "control that keeps the thing it controls for is not a control"
        )

    if not _is_window(evidence.positive_window_s) or not _is_window(evidence.negative_window_s):
        raise PropagationEvidenceUnavailable(
            f"AC5's channels carry no measured window ({evidence.positive_window_s!r} / "
            f"{evidence.negative_window_s!r}); a window that is absent, zero, negative or "
            "not a number is not a short observation but the absence of one, and an "
            "untimed control cannot be compared with the leg it must outlast"
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
        positive["documents"] >= 1
        and positive["clients"] >= 2
        and positive["frames"] >= 1
    )
    negative_leaked = changed is True

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
