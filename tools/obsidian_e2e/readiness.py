"""WP46 — readiness and instance-identity handshake for the real-Obsidian rig.

Outcome (charter §1): it is structurally impossible for a run to drive one vault twice,
or to drive a vault nobody intended.

The weak signal this module replaces is *"the port answered"*. A port answering says
nothing about **which vault** is behind it — Obsidian is single-instance, so the second
vault is another window in the *same* process tree (D14) and process identity is
worthless. Readiness therefore asks every endpoint to identify itself and refuses unless
the answers positively agree with what the run was configured to drive.

Acceptance criteria and how this module satisfies them:

- **AC2** — :func:`check_readiness` requires, within a bounded timeout, that *both*
  endpoints answer, report **different** vault identities, and report the **same** room.
  The three conditions are three separate rungs of :func:`_verdict_present`'s ladder and
  each has its own named refusal: :data:`~obsidian_e2e.constants.READINESS_TIMEOUT`,
  :data:`~obsidian_e2e.constants.IDENTITY_SAME_VAULT`,
  :data:`~obsidian_e2e.constants.ROOM_MISMATCH`.
- **AC2 (no edit is issued)** — structurally, not incidentally. This module has exactly
  **one** outbound request site, :func:`_default_transport`, and it sends exactly one
  frozen payload, the module-level :data:`_SESSION_INFO_BODY`. There is no parameter, no
  branch and no caller-supplied value that can make it send anything else, so no failure
  path *can* reach an instance with an edit. Auditing the claim is one grep for
  ``urlopen``.
- **AC3** — readiness is a **positive assertion**. A verdict is ``ready=True`` only after
  every rung has been positively satisfied; there is no path where "nothing raised" turns
  into ready. A timeout, a **non-2xx response** (however well-formed its body), a partially
  initialised instance (answers, identity fields missing), an HTTP 200 carrying a body that
  is not a well-formed ``session.info``, and an endpoint reporting a vault outside the
  configured pair
  (:data:`~obsidian_e2e.constants.IDENTITY_UNKNOWN_VAULT`) each stop the run.
- **AC4** — the check is pure with respect to this process: it holds no cache and no
  module state, so calling it twice re-probes and the verdict follows reality rather than
  the first call. Teardown reuses the *same* probe inverted through
  :func:`check_endpoints_gone` (``expect_absent``): both endpoints refusing connections is
  the **success** condition in that direction, and one survivor is a failure that names
  the surviving role and its vault.

**Environment reality (T3_SharedContract §1.1).** The build installed in both real vaults
is a *production* build with ``src/testing/`` tree-shaken out, so no real endpoint can
ever answer, whatever port is provisioned. That is a different diagnosis from a slow
instance and conflating the two would mislead WP50/WP51, so pass WP43's per-role plugin
state as ``plugin_states=`` and this module reports
:data:`~obsidian_e2e.constants.PLUGIN_NOT_E2E_CAPABLE` (the named state from
:mod:`obsidian_e2e.vaults`) **without probing at all**, instead of waiting out a timeout
it already knows the answer to.

Everything is bounded and everything is injectable: the timeout is an argument and names
the condition it waited for, the endpoint map is an argument, and the transport is an
argument — so the whole module can be pointed at in-process fakes and nothing here can
only talk to a real instance. Standard library only; every named refusal is imported from
:mod:`obsidian_e2e.constants` and this module declares no reason string of its own.
"""

from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Callable, Mapping, Optional

from . import constants

__all__ = [
    "ReadinessVerdict",
    "EndpointAnswer",
    "RawAnswer",
    "probe_endpoints",
    "check_readiness",
    "check_endpoints_gone",
]


# ---------------------------------------------------------------------------
# The one thing this module ever sends (AC2 — "no edit is issued")
# ---------------------------------------------------------------------------

#: The **only** payload this module puts on the wire, built once at import time from the
#: pinned command name. It is a module constant rather than a per-call value on purpose:
#: with no parameter feeding it, no code path — success, refusal or bug — can turn this
#: probe into an edit. Contract §7: "the probe is ``POST {url}/command`` with
#: ``{"cmd": "session.info"}`` — and nothing else, ever."
_SESSION_INFO_BODY = json.dumps({"cmd": constants.CMD_SESSION_INFO}).encode("utf-8")

_JSON_HEADERS = {"Content-Type": "application/json"}


# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------


def _is_success_status(status: Optional[int]) -> bool:
    """Is this a *successful* HTTP status — the 2xx class, and nothing else?

    One predicate for the whole module, so "the request succeeded" is decided in one place
    and cannot drift into "the request came back". Redirects included: a 3xx says the thing
    that answered is not the control endpoint, and following it is not this probe's job.
    """
    return status is not None and 200 <= int(status) < 300


@dataclass(frozen=True)
class RawAnswer:
    """What a transport saw: an HTTP answer, or none at all.

    ``status is None`` means *nothing answered* — a refused connection, a reset, or a
    silence that outlived the bound. Contract §7 gives no separate refusal reason, so a
    refusal and a silence are deliberately the same signal here.

    :attr:`answered` and :attr:`succeeded` are **different questions**, and keeping them
    apart is the whole point of this type: teardown asks "did anything answer at all", and
    readiness asks "did the request succeed". A 4xx/5xx answers the first question with yes
    and the second with no.
    """

    status: Optional[int] = None
    body: Optional[bytes] = None
    error: str = ""

    @property
    def answered(self) -> bool:
        """``True`` when the endpoint produced *any* HTTP response, usable or not."""
        return self.status is not None

    @property
    def succeeded(self) -> bool:
        """``True`` only for a 2xx — the transport-level outcome, before any parsing."""
        return _is_success_status(self.status)


@dataclass(frozen=True)
class EndpointAnswer:
    """One role's probe result, after parsing."""

    role: str
    url: str
    answered: bool
    status: Optional[int] = None
    #: The raw ``session.info`` result object, or ``None`` when the request did not
    #: succeed, or succeeded without a well-formed ``{"ok": true, "result": {...}}``
    #: envelope. A body is only ever parsed **after** the status has been accepted.
    info: Optional[dict] = None
    error: str = ""

    @property
    def succeeded(self) -> bool:
        """``True`` only when the endpoint answered with a 2xx (transport level)."""
        return _is_success_status(self.status)

    @property
    def usable(self) -> bool:
        """``True`` only when the request **succeeded** *and* the answer parsed.

        The status is checked first and independently: a perfectly well-formed
        ``session.info`` body served with a 500, a 403 or a 302 describes an endpoint that
        failed to serve the request, and a good-looking body must never rescue it.
        """
        return self.answered and self.succeeded and isinstance(self.info, dict)


@dataclass(frozen=True)
class ReadinessVerdict:
    """The verdict. ``reason`` is exactly one ``constants.*`` name when not ready.

    ``detail`` is human text for a log line and is **never** the oracle — callers branch
    on :attr:`ready` and :attr:`reason`, never on the wording of :attr:`detail`.
    """

    ready: bool
    reason: Optional[str] = None
    #: role -> the raw ``session.info`` result, for the roles that answered usably.
    identities: dict = field(default_factory=dict)
    detail: str = ""


# ---------------------------------------------------------------------------
# Transport — the single outbound request site in this module
# ---------------------------------------------------------------------------

#: A transport takes ``(base_url, timeout_s)`` and returns a :class:`RawAnswer`. Injecting
#: one is how a test points this module at a fake without a socket.
Transport = Callable[[str, float], RawAnswer]


def _default_transport(base_url: str, timeout_s: float) -> RawAnswer:
    """``POST <base_url>/command`` with the frozen ``session.info`` body.

    The only ``urlopen`` in this module. A protocol-level refusal (HTTP 4xx) is still an
    *answer* — it proves something is alive on that port — so it is reported with its
    status rather than swallowed; that distinction is what makes the teardown direction
    (:func:`check_endpoints_gone`) correct.
    """
    url = f"{base_url.rstrip('/')}{constants.CONTROL_COMMAND_PATH}"
    request = urllib.request.Request(  # noqa: S310 - fixed http scheme, localhost rig
        url, data=_SESSION_INFO_BODY, headers=dict(_JSON_HEADERS), method="POST"
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_s) as response:  # noqa: S310
            return RawAnswer(status=int(response.getcode() or 0), body=response.read())
    except urllib.error.HTTPError as exc:  # an answer, just a refusing one
        try:
            body = exc.read()
        except Exception:  # pragma: no cover - defensive
            body = b""
        return RawAnswer(status=int(exc.code), body=body, error="http error")
    except Exception as exc:  # refused / reset / timed out / malformed HTTP framing
        return RawAnswer(error=type(exc).__name__)


# ---------------------------------------------------------------------------
# Bounded, concurrent probing
# ---------------------------------------------------------------------------


def _parse_session_info(raw: RawAnswer) -> Optional[dict]:
    """Extract the ``session.info`` result object, or ``None``.

    Every way of being unusable collapses to ``None`` here — a non-2xx status, non-JSON, a
    truncated body, an envelope with no ``result``, a protocol-level ``ok: false``, or a
    ``result`` that is not an object. "The port answered" is precisely the signal WP46
    replaces, so none of those may survive as far as the identity checks.

    **The transport-level outcome is validated first.** A body is only looked at once the
    request has been accepted as successful, so there is no ordering in which a well-formed
    payload can rescue a failed request.
    """
    if not raw.succeeded:
        return None
    if raw.body is None:
        return None
    try:
        payload = json.loads(raw.body.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return None
    if not isinstance(payload, dict) or payload.get("ok") is not True:
        return None
    result = payload.get("result")
    return result if isinstance(result, dict) else None


def probe_endpoints(
    endpoints: Mapping[str, str],
    timeout_s: float,
    *,
    transport: Optional[Transport] = None,
) -> dict:
    """Probe every endpoint once, concurrently, within one bounded deadline.

    Returns ``role -> EndpointAnswer`` for **every** role in ``endpoints``; a role whose
    probe has not come back by the deadline is reported as not answered rather than
    waited on further. The wait is therefore bounded by ``timeout_s`` overall and not by
    ``timeout_s`` per endpoint — a pair of silent instances costs one timeout, not two.
    """
    send = transport or _default_transport
    budget = max(0.0, float(timeout_s))
    deadline = time.monotonic() + budget

    raw: dict = {}
    lock = threading.Lock()

    def run(role: str, url: str) -> None:
        answer = send(url, budget)
        with lock:
            raw[role] = answer

    threads = []
    for role, url in endpoints.items():
        thread = threading.Thread(
            target=run, args=(role, url), name=f"wp46-probe-{role}", daemon=True
        )
        thread.start()
        threads.append(thread)

    for thread in threads:
        thread.join(max(0.0, deadline - time.monotonic()))

    answers: dict = {}
    for role, url in endpoints.items():
        with lock:
            got = raw.get(role)
        if got is None:
            # Still in flight at the deadline. The worker is a daemon thread and its own
            # socket timeout will collect it; the verdict does not wait for that.
            answers[role] = EndpointAnswer(
                role=role,
                url=url,
                answered=False,
                error="no answer within the bounded timeout",
            )
            continue
        answers[role] = EndpointAnswer(
            role=role,
            url=url,
            answered=got.answered,
            status=got.status,
            # Transport first, payload second: ``_parse_session_info`` refuses anything
            # that did not come back 2xx, so a non-2xx never reaches the identity ladder
            # with an ``info`` attached however well-formed its body was.
            info=_parse_session_info(got),
            error=got.error or ("" if got.succeeded else f"http status {got.status}"),
        )
    return answers


def _identities(answers: Mapping[str, EndpointAnswer]) -> dict:
    """role -> the raw ``session.info`` result, for the roles that answered usably."""
    return {role: dict(a.info) for role, a in answers.items() if a.usable and a.info is not None}


# ---------------------------------------------------------------------------
# Capability pre-check (T3_SharedContract §1.1)
# ---------------------------------------------------------------------------


def _plugin_state_of(value: object) -> Optional[str]:
    """Read a plugin state from a bare string or from a WP43 ``VaultInstance``-like."""
    if isinstance(value, str):
        return value
    state = getattr(value, "plugin_state", None)
    return state if isinstance(state, str) else None


def _capability_refusal(plugin_states: Optional[Mapping[str, object]]) -> Optional[tuple]:
    """Return ``(reason, detail)`` when a known plugin state already rules the run out.

    A production build has no control server *at all* — waiting for it to answer and then
    reporting ``READINESS_TIMEOUT`` would name the wrong defect. When WP43's per-role
    state is supplied and it is already a named failure, that name is the verdict and no
    probe is sent.
    """
    if not plugin_states:
        return None
    for role, value in plugin_states.items():
        state = _plugin_state_of(value)
        if state is None or state == constants.PLUGIN_OK:
            continue
        if state in constants.FAILURE_REASONS:
            return state, f"role {role!r}: {state} — the control endpoint cannot exist"
    return None


# ---------------------------------------------------------------------------
# The verdict ladders
# ---------------------------------------------------------------------------


def _blank(value: object) -> bool:
    """``True`` for anything that is not a non-whitespace string."""
    return not isinstance(value, str) or not value.strip()


def _verdict_present(
    answers: Mapping[str, EndpointAnswer],
    configured_vaults: Mapping[str, str],
) -> ReadinessVerdict:
    """The ``expect_absent=False`` direction: every condition must be positively met.

    The rungs are ordered so that the most fundamental diagnosis wins: an endpoint that
    never answered is not asked what vault it serves, and a vault nobody configured is
    named as such rather than as "distinct enough" from the other one. Ids and rooms are
    compared **exactly** — no case folding, no trimming, no normalisation — because a
    near-miss is a different vault and must read as one.
    """
    identities = _identities(answers)

    # 1. Both endpoints answer (AC2, first condition).
    silent = sorted(role for role, a in answers.items() if not a.answered)
    if silent:
        return ReadinessVerdict(
            ready=False,
            reason=constants.READINESS_TIMEOUT,
            identities=identities,
            detail=f"waited for: session.info from every endpoint; silent: {silent}",
        )

    # 2. Every answer is a *successful* request (AC3). Readiness is an assertion about a
    #    request that succeeded, not about one whose body happened to parse: a 4xx, a 5xx
    #    or a redirect means the thing on that port did not serve session.info, whatever it
    #    put in the body. Checked before the payload so no ordering can let a good-looking
    #    body rescue a failed request.
    unsuccessful = sorted(role for role, a in answers.items() if not a.succeeded)
    if unsuccessful:
        return ReadinessVerdict(
            ready=False,
            reason=constants.PLUGIN_NOT_E2E_CAPABLE,
            identities=identities,
            detail=(
                "waited for: a successful session.info response; answered with a non-2xx "
                "status: "
                + ", ".join(f"{role}={answers[role].status}" for role in unsuccessful)
            ),
        )

    # 3. Every successful answer is a usable session.info carrying all §6.2 fields (AC3).
    #    A pre-WP46 production build answers the legacy quartet perfectly well.
    incomplete = sorted(
        role
        for role, a in answers.items()
        if a.info is None or any(f not in a.info for f in constants.SESSION_INFO_FIELDS)
    )
    if incomplete:
        return ReadinessVerdict(
            ready=False,
            reason=constants.PLUGIN_NOT_E2E_CAPABLE,
            identities=identities,
            detail=(
                "waited for: a complete session.info identity; "
                f"answered without one: {incomplete}"
            ),
        )

    vault_of = {role: a.info.get(constants.SESSION_INFO_VAULT_ID) for role, a in answers.items()}

    # 4. Every reported vault is one of the two configured ones (AC3). A blank id is not
    #    an identity, so it is unknown rather than "empty but fine".
    configured = {v for v in configured_vaults.values() if isinstance(v, str)}
    unknown = sorted(
        role
        for role, vault in vault_of.items()
        if _blank(vault) or vault not in configured
    )
    if unknown:
        return ReadinessVerdict(
            ready=False,
            reason=constants.IDENTITY_UNKNOWN_VAULT,
            identities=identities,
            detail=(
                "waited for: every endpoint to serve a configured vault; "
                f"unintended vault reported by: {unknown}"
            ),
        )

    # 5. The endpoints serve *different* vaults (AC2, second condition). This is the rung
    #    that makes driving one vault twice structurally impossible; client ids differing
    #    proves nothing, because one process can host both windows (D14).
    if len(set(vault_of.values())) != len(vault_of):
        return ReadinessVerdict(
            ready=False,
            reason=constants.IDENTITY_SAME_VAULT,
            identities=identities,
            detail="waited for: two distinct vault identities; the endpoints report one vault",
        )

    # 6. The endpoints share one room (AC2, third condition). Two correctly separated
    #    vaults in different rooms would look exactly like a sync bug later on.
    rooms = {role: a.info.get(constants.SESSION_INFO_ROOM_ID) for role, a in answers.items()}
    if any(_blank(r) for r in rooms.values()) or len(set(rooms.values())) > 1:
        return ReadinessVerdict(
            ready=False,
            reason=constants.ROOM_MISMATCH,
            identities=identities,
            detail=f"waited for: one shared room across all endpoints; rooms: {sorted(rooms)}",
        )

    # Only here — every rung positively satisfied — is the run allowed to proceed.
    misrouted = sorted(
        role
        for role, vault in vault_of.items()
        if role in configured_vaults and vault != configured_vaults[role]
    )
    detail = "ready: all endpoints answered, vaults are distinct and configured, room shared"
    if misrouted:
        # Both configured vaults are present, just not on the roles they were expected on.
        # §7 pins no reason for this, so it is reported, not refused.
        detail += f"; note: role/vault assignment differs from configuration for {misrouted}"
    return ReadinessVerdict(ready=True, reason=None, identities=identities, detail=detail)


def _verdict_absent(answers: Mapping[str, EndpointAnswer]) -> ReadinessVerdict:
    """The ``expect_absent=True`` direction: nothing may answer.

    *Any* HTTP answer means "still present", even an unusable one — a half-torn-down run
    is exactly the state that lets the next run attach to a stale instance and drive the
    wrong vault, so one survivor never rounds up to success.
    """
    survivors = sorted(role for role, a in answers.items() if a.answered)
    if not survivors:
        return ReadinessVerdict(
            ready=True,
            reason=None,
            identities={},
            detail="teardown: no endpoint answers — the control endpoints are gone",
        )
    # §7 pins no reason for a failed teardown; rather than invent one, this reuses the
    # sanctioned WAIT_TIMEOUT, whose whole contract is to name the condition waited for.
    return ReadinessVerdict(
        ready=False,
        reason=constants.WAIT_TIMEOUT,
        identities=_identities(answers),
        detail=f"waited for: control endpoints gone; still answering: {survivors}",
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def check_readiness(
    endpoints: Mapping[str, str],
    configured_vaults: Mapping[str, str],
    timeout_s: float,
    *,
    plugin_states: Optional[Mapping[str, object]] = None,
    transport: Optional[Transport] = None,
) -> ReadinessVerdict:
    """Decide whether the configured pair of instances may be driven.

    Ready requires, within ``timeout_s``, that **every** endpoint answers, that the
    answers carry a complete identity, that every reported vault is one of
    ``configured_vaults.values()``, that the vaults are **different**, and that the room
    is the **same**. Anything else is a refusal under exactly one ``constants.*`` name and
    no edit is issued — the only thing this function can put on the wire is
    ``session.info``.

    Args:
        endpoints: role -> control base URL, e.g. ``{"a": "http://127.0.0.1:39431"}``.
        configured_vaults: role -> the vault id that role is expected to serve.
        timeout_s: the whole bounded budget for the probe, not a per-endpoint budget.
        plugin_states: optional role -> WP43 plugin state (a string or a ``VaultInstance``).
            When one of them is already a named failure — notably
            ``PLUGIN_NOT_E2E_CAPABLE`` for the production build installed in the owner's
            vaults — that name is returned and nothing is probed.
        transport: optional injected transport, for tests that must not open a socket.

    Re-runnable by construction: no cache, no module state, nothing memoised, so a second
    call re-probes and a pair that degrades mid-run is caught by the same function (AC4).
    """
    refusal = _capability_refusal(plugin_states)
    if refusal is not None:
        reason, detail = refusal
        return ReadinessVerdict(ready=False, reason=reason, identities={}, detail=detail)

    answers = probe_endpoints(endpoints, timeout_s, transport=transport)
    return _verdict_present(answers, configured_vaults)


def check_endpoints_gone(
    endpoints: Mapping[str, str],
    timeout_s: float,
    *,
    transport: Optional[Transport] = None,
) -> ReadinessVerdict:
    """The same probe, inverted for teardown: ``ready=True`` iff **no** endpoint answers.

    This is the ``expect_absent`` mode of the readiness check and it is exposed on purpose
    (AC4): teardown must not reimplement the probe, or the two directions would drift and
    "gone" would stop meaning the opposite of "ready". On one identical world state,
    :func:`check_readiness` returns ``READINESS_TIMEOUT`` exactly where this returns
    ``ready=True``.

    A survivor is named: it appears in :attr:`~ReadinessVerdict.identities` by role when
    its answer parses, so a half-finished teardown says *which* instance is still up. It
    receives nothing but ``session.info``.
    """
    answers = probe_endpoints(endpoints, timeout_s, transport=transport)
    return _verdict_absent(answers)
