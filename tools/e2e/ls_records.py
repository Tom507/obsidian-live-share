"""WP124 — THE DRIVER SIDE OF THE RECORDS ORACLE (`S179`, closing WP123's R2).

THE ONE SENTENCE
----------------
WP123 taught `ExpectedContent` to judge a canvas by its RECORDS. This module is
the half that was missing: it teaches a live driver to SEND that clause and, far
more importantly, to REFUSE TO CALL A ROUND GREEN when the rig did not actually
judge it.

WHY THE SECOND HALF IS THE POINT
--------------------------------
`S155`'s shape, one level up. A driver that posts a `records` expectation which
the rig silently ignores looks EXACTLY like a driver whose expectation passed:
both get `ok: true`, both can get `converged: true` (the verdict falls back to
BYTE agreement when no usable records clause was stated), and neither raises.
So `assess_records` below never reads `converged` on its own. It cross-checks
what we ASKED against what came back:

    ├── we stated no records clause                      -> NOT_ASKED   (never green)
    ├── we stated one and the answer shows no measurement:
    │      no `records` clause row at all
    │      / the row came back `stated: false`
    │      / the row is satisfied and `peersAgreeOnRecords`
    │        is absent or null                           -> NOT_JUDGED  (never green)
    ├── judged, and refused — a wrong field, an absent
    │      node, or an expectation the rig could not read -> VIOLATED
    └── judged, every named field holds, peers agree
           on the records                                -> SATISFIED

`NOT_JUDGED` is the whole reason this module exists. It is what a pre-WP123
bundle, a stale deploy, or a regression in the clause ledger looks like from the
driver's side, and without it all three read as a pass.

NEVER SCORE A CANVAS ON BYTES
-----------------------------
Three stable byte spellings of one identical board were measured live on this
build (235 / 296 / 218 B, `S174`/`S177`). `peersAgree` is a BYTE test
(`sameFileObservation`, `e2e-control.ts`) and `contains` is no escape —
`'"x": 111'` is not `'"x":111'`. The field a canvas round must read is
`peersAgreeOnRecords`, and `records_converged` below refuses to return True
without it.

WHAT THIS MODULE DOES NOT DO
----------------------------
  * It does not open a socket of its own. Every function takes the driver's own
    `post(cmd, args) -> response` callable, so it works unchanged against a live
    Obsidian control port, against `tools/e2e/judge_bridge.py`, and against
    anything else that speaks the `{cmd, args}` envelope.
  * It states nothing about EDGES. `ExpectedRecords` names nodes only (WP123 R1).
  * It compares only the fields the expectation NAMED (WP123 R3). A board where
    an unnamed field diverges reads as agreeing, and that is the price of not
    being a byte oracle. Say so in any report that quotes the field.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Optional, Sequence

#: The node fields a records expectation may name. Mirrors `RECORD_FIELDS` in
#: `plugin/src/testing/e2e-control.ts`; the rig refuses anything else.
RECORD_FIELDS = ("x", "y", "width", "height")

#: The clause row's name in the judgement ledger.
RECORDS_CLAUSE = "records"

# -- the four outcomes. Only one of them is green. --------------------------
NOT_ASKED = "NOT_ASKED"
NOT_JUDGED = "NOT_JUDGED"
VIOLATED = "VIOLATED"
SATISFIED = "SATISFIED"


class RecordsExpectationError(ValueError):
    """A records expectation the rig would refuse, caught before the wire.

    WP123's R4: a flatter shape gets a judged FAILURE rather than a crash, which
    is correct of the rig and useless to a driver author at 3 a.m. — the failure
    arrives an hour into a live battery and looks like a product defect. Failing
    here, loudly, at construction time, is the cheap half.
    """


class OracleUnreachable(RuntimeError):
    """`convergence.judge` did not answer. NEVER degraded into a verdict: a
    question that could not be asked must not be recorded as a pass."""


# ---------------------------------------------------------------------------
# 1. STATING THE EXPECTATION
# ---------------------------------------------------------------------------

def records_expectation(
    origin: str,
    nodes: Iterable[Mapping[str, Any]],
    *,
    exists: Optional[bool] = None,
    at_least_bytes: Optional[int] = None,
) -> dict:
    """Build the `expected` object for `convergence.judge`, records clause and all.

    `origin` is mandatory and non-empty because the one way to defeat this oracle
    is to derive the expectation from a peer under test. Write down the GESTURE
    the driver is about to issue, BEFORE issuing it — never a post-gesture read.

    `nodes` is an iterable of mappings, each with a non-empty string `id` and at
    least one of x / y / width / height as a finite number. Anything else raises
    `RecordsExpectationError` here rather than becoming a judged failure later.

    The optional byte clauses are pass-throughs, kept because a round often wants
    both ("the file must be there AND n1 must be at (100, 399)"). They are never
    a substitute for the records clause and this function will not build an
    expectation without one — that is what `judge` is for.
    """
    if not isinstance(origin, str) or origin.strip() == "":
        raise RecordsExpectationError(
            "`origin` is mandatory and must be non-empty: name the gesture this "
            "expectation came from, in your own words, before you issue it"
        )
    prepared: list[dict] = []
    for i, raw in enumerate(nodes):
        if not isinstance(raw, Mapping):
            raise RecordsExpectationError(f"nodes[{i}] is not a mapping: {type(raw).__name__}")
        node_id = raw.get("id")
        if not isinstance(node_id, str) or node_id == "":
            raise RecordsExpectationError(f"nodes[{i}] has no non-empty string `id`")
        row: dict = {"id": node_id}
        for field in RECORD_FIELDS:
            if field not in raw:
                continue
            value = raw[field]
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise RecordsExpectationError(
                    f"nodes[{i}].{field} is not a number: {value!r}"
                )
            if value != value or value in (float("inf"), float("-inf")):  # NaN / inf
                raise RecordsExpectationError(f"nodes[{i}].{field} is not finite: {value!r}")
            row[field] = value
        # Unknown fields are checked FIRST. `{"id": "n1", "text": "card"}` states
        # something the caller believes is being compared and nothing that is —
        # reporting it as "names no field" would send the author looking for the
        # wrong mistake.
        unknown = sorted(set(raw) - {"id"} - set(RECORD_FIELDS))
        if unknown:
            raise RecordsExpectationError(
                f"nodes[{i}] names {unknown} which the oracle does not compare; "
                "an expectation that silently drops a field is the failure this "
                "clause exists to prevent"
            )
        named = [f for f in RECORD_FIELDS if f in row]
        if not named:
            raise RecordsExpectationError(
                f"nodes[{i}] names node {node_id!r} and no field of it, so it states "
                f"nothing that could be compared (one of {', '.join(RECORD_FIELDS)})"
            )
        prepared.append(row)
    if not prepared:
        raise RecordsExpectationError(
            "`nodes` is empty, and an expectation that names nothing judges nothing — "
            "a satisfied comparison of empty against empty is exactly the vacuous "
            "green the records clause exists to refuse"
        )
    expected: dict = {"origin": origin, "records": {"nodes": prepared}}
    if exists is not None:
        expected["exists"] = bool(exists)
    if at_least_bytes is not None:
        expected["atLeastBytes"] = int(at_least_bytes)
    return expected


def states_records(expected: Mapping[str, Any]) -> bool:
    """Did this expectation ask a records question at all? Structural, not a guess."""
    records = expected.get("records") if isinstance(expected, Mapping) else None
    return records is not None


# ---------------------------------------------------------------------------
# 2. READINGS — from DISK, in python, never through the renderer
# ---------------------------------------------------------------------------

def disk_reading(peer: str, path: Path) -> dict:
    """One peer's file reading, shaped like `canvas.file`, taken from DISK.

    Secrets (§4): this refuses `data.json` by name. That file holds live
    credentials and a `canvas.file`-shaped reading carries `content` verbatim,
    so the refusal is structural rather than a convention someone must remember.
    """
    path = Path(path)
    if path.name == "data.json":
        raise ValueError(
            "refusing to build a reading of data.json — it holds live credentials "
            "and a reading carries `content` verbatim; compare it as sha256-of-bytes"
        )
    if not path.is_file():
        return {"exists": False, "sha256": "", "size": 0, "content": None}
    raw = path.read_bytes()
    return {
        "exists": True,
        "sha256": hashlib.sha256(raw).hexdigest(),
        "size": len(raw),
        "content": raw.decode("utf-8", "replace"),
    }


def readings(pairs: Iterable[tuple[str, Path]]) -> list[dict]:
    """`[(peer, path), ...] -> [{peer, file}, ...]`, the `convergence.judge` shape."""
    return [{"peer": peer, "file": disk_reading(peer, path)} for peer, path in pairs]


# ---------------------------------------------------------------------------
# 3. ASKING
# ---------------------------------------------------------------------------

Post = Callable[..., Mapping[str, Any]]


def judge(
    post: Post,
    peer_readings: Sequence[Mapping[str, Any]],
    expected: Mapping[str, Any],
) -> dict:
    """Ask the PRODUCT's oracle and return its judgement.

    `post` is the driver's own transport: `post(cmd, args) -> response`, where a
    response is `{"ok": True, "result": {...}}` or `{"ok": False, "error": ...}`.
    A non-ok answer raises `OracleUnreachable` — it is never turned into a
    verdict, because a rig that cannot answer and a rig that answered "fine" must
    not read alike.
    """
    response = post("convergence.judge", {"peers": list(peer_readings), "expected": dict(expected)})
    if not isinstance(response, Mapping) or response.get("ok") is not True:
        raise OracleUnreachable(
            f"convergence.judge did not answer: {response!r}. On a live instance this "
            "is a pre-WP116 bundle, a wrong port, or a stale deploy — it is NOT a verdict."
        )
    result = response.get("result")
    if not isinstance(result, Mapping):
        raise OracleUnreachable(f"convergence.judge answered without a result object: {response!r}")
    return dict(result)


# ---------------------------------------------------------------------------
# 4. CONSUMING — the half that makes the first half worth sending
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class RecordsOutcome:
    """What the rig did with the records question, as opposed to what it said.

    `status` is one of NOT_ASKED / NOT_JUDGED / VIOLATED / SATISFIED. `satisfied`
    is `None` for the first two on purpose — a bare boolean here would collapse
    "nobody judged this" into "this failed" or, far worse, into "this passed".
    """

    status: str
    stated: Optional[bool]
    satisfied: Optional[bool]
    peers_agree_on_records: Optional[bool]
    detail: str
    why: str

    @property
    def judged(self) -> bool:
        """Did the rig actually apply the records clause we sent?"""
        return self.status in (VIOLATED, SATISFIED)

    @property
    def green(self) -> bool:
        """The only status a canvas geometry round may record as a pass."""
        return self.status == SATISFIED


def records_clause(judgement: Mapping[str, Any]) -> Optional[Mapping[str, Any]]:
    """The `records` row of the clause ledger, or None if the rig emitted none."""
    clauses = judgement.get("clauses")
    if not isinstance(clauses, Sequence):
        return None
    for row in clauses:
        if isinstance(row, Mapping) and row.get("clause") == RECORDS_CLAUSE:
            return row
    return None


def assess_records(expected: Mapping[str, Any], judgement: Mapping[str, Any]) -> RecordsOutcome:
    """Cross-check what we ASKED against what came back. The S179 detector.

    Takes the expectation as well as the judgement, and that is the whole design:
    `stated: false` is a correct, honest answer for a caller who asked nothing,
    and a silent lie for a caller who asked. Only the caller knows which it is.
    """
    asked = states_records(expected)
    row = records_clause(judgement)
    agree = judgement.get("peersAgreeOnRecords", "<absent>")

    if not asked:
        return RecordsOutcome(
            status=NOT_ASKED,
            stated=None if row is None else row.get("stated"),
            satisfied=None,
            peers_agree_on_records=None,
            detail="" if row is None else str(row.get("detail", "")),
            why=(
                "this expectation states no `records` clause, so nothing about the "
                "board's geometry was judged. A canvas round scored without one is "
                "scored on bytes, and one board has three stable spellings on this build"
            ),
        )

    if row is None:
        return RecordsOutcome(
            status=NOT_JUDGED, stated=None, satisfied=None, peers_agree_on_records=None,
            detail="",
            why=(
                "a `records` expectation was sent and the judgement carries NO `records` "
                "clause row at all. The rig on the other end does not have WP123's clause "
                "ledger — a pre-WP123 bundle, a stale deploy, or a regression. This is not "
                "a failure of the board; it is the absence of a measurement"
            ),
        )

    stated = row.get("stated")
    satisfied = row.get("satisfied")
    detail = str(row.get("detail", ""))

    if stated is not True:
        return RecordsOutcome(
            status=NOT_JUDGED, stated=stated, satisfied=None, peers_agree_on_records=None,
            detail=detail,
            why=(
                f"a `records` expectation was sent and the rig reports stated={stated!r}. "
                "The rig did not read what we asked. 'Not asked' and 'asked and passed' "
                "must never read alike (S155) and here they would"
            ),
        )

    # THE ORDER MATTERS AND IT IS NOT ARBITRARY. The clause row's own verdict is
    # read BEFORE `peersAgreeOnRecords`, because a rig that read our expectation
    # and REFUSED it (`satisfied: false`, "CANNOT BE APPLIED") legitimately has no
    # record agreement to report — `peersAgreeOnRecords` is null for a malformed
    # expectation by design. Reading the agreement first would file that under
    # "the rig ignored us", which is a different diagnosis pointing at the wrong
    # side of the wire. Both are red either way; only the sentence differs.
    if satisfied is False:
        return RecordsOutcome(
            status=VIOLATED, stated=True, satisfied=False,
            peers_agree_on_records=None if agree in (None, "<absent>") else bool(agree),
            detail=detail,
            why=f"the board does not hold the records the expectation named: {detail}",
        )

    if satisfied is not True:
        return RecordsOutcome(
            status=NOT_JUDGED, stated=stated, satisfied=None, peers_agree_on_records=None,
            detail=detail,
            why=(
                f"the rig reports stated=true and satisfied={satisfied!r}, which its own "
                "contract says is impossible (`satisfied` is null exactly when `stated` is "
                "false). Nothing was measured here"
            ),
        )

    # satisfied is True — and a satisfied reference reading says nothing about the
    # other peers. With a usable records expectation the oracle ALWAYS answers the
    # record-level peer question, so a missing or null answer here is a rig that
    # judged half of what it was asked.
    if agree == "<absent>":
        return RecordsOutcome(
            status=NOT_JUDGED, stated=stated, satisfied=satisfied, peers_agree_on_records=None,
            detail=detail,
            why=(
                "the judgement carries no `peersAgreeOnRecords` field. The clause row was "
                "judged but the record-level PEER question was not answered, so there is no "
                "statement that the peers hold the same board — only that one of them does"
            ),
        )

    if agree is None:
        return RecordsOutcome(
            status=NOT_JUDGED, stated=stated, satisfied=satisfied, peers_agree_on_records=None,
            detail=detail,
            why=(
                "`peersAgreeOnRecords` is null, which the oracle means as 'no usable records "
                "expectation was stated' — and we stated one, and its clause row came back "
                "satisfied. The two halves of the answer disagree about whether we asked"
            ),
        )

    return RecordsOutcome(
        status=SATISFIED, stated=True, satisfied=True,
        peers_agree_on_records=bool(agree), detail=detail,
        why="every field the expectation named holds on the reference reading",
    )


def records_converged(expected: Mapping[str, Any], judgement: Mapping[str, Any]) -> tuple[bool, str]:
    """`(green, why)` for a canvas geometry round. The ONLY green a driver may record.

    Three conjuncts, and none of them is `peersAgree`:
      1. the records clause was JUDGED and SATISFIED (not merely answered),
      2. `peersAgreeOnRecords` is True — the peers hold the same board, whatever
         spelling each of them wrote it in,
      3. the oracle's own verdict is `converged`.

    (3) alone is the trap: `converged` falls back to BYTE agreement when no usable
    records expectation was stated, so a rig that ignored our clause can answer
    `converged: true` for a board whose card moved 199 px — measured in WP123's
    `tp02b`. (1) and (2) are what make (3) mean anything.
    """
    outcome = assess_records(expected, judgement)
    if outcome.status != SATISFIED:
        return False, f"records {outcome.status}: {outcome.why}"
    if outcome.peers_agree_on_records is not True:
        return False, (
            "the records clause is satisfied on the reference reading but "
            f"peersAgreeOnRecords={outcome.peers_agree_on_records!r} — the peers do not hold "
            f"the same board. {judgement.get('reason', '')}"
        )
    if judgement.get("converged") is not True:
        return False, (
            f"verdict={judgement.get('verdict')!r} with violations "
            f"{judgement.get('violations')!r}: {judgement.get('reason', '')}"
        )
    return True, (
        f"records satisfied ({outcome.detail}) and all peers agree on the records; "
        f"verdict={judgement.get('verdict')!r}"
    )


# ---------------------------------------------------------------------------
# 5. THE TWO CALLS A LIVE BATTERY ACTUALLY MAKES
# ---------------------------------------------------------------------------

def judge_canvas_round(
    post: Post,
    peers: Iterable[tuple[str, Path]],
    origin: str,
    nodes: Iterable[Mapping[str, Any]],
    *,
    exists: Optional[bool] = None,
    at_least_bytes: Optional[int] = None,
) -> tuple[bool, str, dict, dict]:
    """One canvas round, end to end: state -> read disk -> ask -> consume.

    Returns `(green, why, judgement, expected)`. `green` is `records_converged`'s
    and nothing else — a battery that logs `judgement["converged"]` instead has
    reintroduced the whole defect.
    """
    expected = records_expectation(origin, nodes, exists=exists, at_least_bytes=at_least_bytes)
    judgement = judge(post, readings(peers), expected)
    green, why = records_converged(expected, judgement)
    return green, why, judgement, expected


def wait_records_converged(
    post: Post,
    peers: Iterable[tuple[str, Path]],
    origin: str,
    nodes: Iterable[Mapping[str, Any]],
    bound_s: float,
    *,
    interval: float = 0.25,
    exists: Optional[bool] = None,
    at_least_bytes: Optional[int] = None,
) -> tuple[bool, float, str, dict]:
    """Poll DISK until the PRODUCT's oracle calls the round green, or the bound
    expires. Returns `(green, elapsed_s, why, judgement)`.

    THE EXPECTATION IS BUILT ONCE, HERE, BEFORE THE FIRST READ, and never rebuilt
    inside the loop. Rebuilding it per iteration is how an expectation quietly
    becomes a function of what the peers currently hold, which is the oracle
    `S158` names wearing this module's name.

    The elapsed time is always returned, green or not, because a bound that
    expired and a bound that was never approached are different results (`S85`).
    """
    import time

    expected = records_expectation(origin, nodes, exists=exists, at_least_bytes=at_least_bytes)
    peer_list = list(peers)
    t0 = time.monotonic()
    while True:
        judgement = judge(post, readings(peer_list), expected)
        green, why = records_converged(expected, judgement)
        if green:
            return True, time.monotonic() - t0, why, judgement
        if time.monotonic() - t0 >= bound_s:
            return False, time.monotonic() - t0, why, judgement
        time.sleep(interval)


def records_line(expected: Mapping[str, Any], judgement: Mapping[str, Any]) -> str:
    """One line for a battery log. Names BOTH agreements so an unqualified
    'the peers agree' can never be quoted next to `peersAgree: false`."""
    outcome = assess_records(expected, judgement)
    green, why = records_converged(expected, judgement)
    return (
        f"records={outcome.status} green={green} "
        f"peersAgreeOnRecords={judgement.get('peersAgreeOnRecords', '<absent>')!r} "
        f"peersAgreeOnBytes={judgement.get('peersAgree')!r} "
        f"verdict={judgement.get('verdict')!r} violations={judgement.get('violations')!r} "
        f"origin={judgement.get('expectationOrigin')!r} :: {why}"
    )
