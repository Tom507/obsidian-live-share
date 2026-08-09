"""WP124 — `tools/e2e/ls_records.py` measured against the REAL convergence oracle.

HOW THESE ROWS ARE DRIVEN, AND WHAT IS A DOUBLE
-----------------------------------------------
Every judgement in this file comes out of the SHIPPED `routeCommand` /
`judgeConvergence` / `parseCanvasReport`, reached over real HTTP through
`tools/e2e/judge_bridge.py`. Nothing here hand-writes a verdict.

The one double is the `host` object behind the bridge's control server, which is
empty. `convergence.judge` is a pure case and reads no host member, so that one
command answers exactly as a live instance does — and every other command
answers with a structured failure, which `tp06a` asserts as a positive control.
A bridge that answered `session.info` would be a general-purpose fake and every
row here would be measuring the author's imagination.

THE PRE-WP123 RIG IS ALSO NOT HAND-WRITTEN. `tp03a` obtains it by asking the
REAL oracle the same question with the records clause removed — which is, byte
for byte, what a rig without WP123 returns for that input — and then dropping
`peersAgreeOnRecords`, a field that did not exist before WP123. The driver is
then handed that answer together with the expectation that DID state records.
That is `S179` exactly: the driver asked, the rig did not judge, and the answer
says `converged: true`.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from judge_bridge import JudgeBridge  # noqa: E402
from ls_records import (  # noqa: E402
    NOT_ASKED,
    NOT_JUDGED,
    SATISFIED,
    VIOLATED,
    OracleUnreachable,
    RecordsExpectationError,
    assess_records,
    disk_reading,
    judge,
    judge_canvas_round,
    readings,
    records_clause,
    records_converged,
    records_expectation,
    records_line,
    wait_records_converged,
)

# ---------------------------------------------------------------------------
# fixtures: ONE board, several spellings — the whole reason records exist
# ---------------------------------------------------------------------------

#: the author's spelling: indented, spaces after the colons
AUTHORED = (
    '{\n'
    '  "nodes": [\n'
    '    {"id": "n1", "type": "text", "text": "card", "x": 100, "y": 200, '
    '"width": 160, "height": 80}\n'
    '  ],\n'
    '  "edges": []\n'
    '}'
)
#: Obsidian's canonical spelling of the SAME board: no whitespace at all
CANONICAL = (
    '{"nodes":[{"id":"n1","type":"text","text":"card","x":100,"y":200,'
    '"width":160,"height":80}],"edges":[]}'
)
#: the SAME board again, keys reordered and `json.dumps` default separators —
#: a third stable spelling, and a third size
REORDERED = (
    '{"edges": [], "nodes": [{"height": 80, "width": 160, "y": 200, "x": 100, '
    '"text": "card", "type": "text", "id": "n1"}]}'
)
#: the card MOVED 199 px. Same spelling family as CANONICAL.
MOVED = (
    '{"nodes":[{"id":"n1","type":"text","text":"card","x":100,"y":399,'
    '"width":160,"height":80}],"edges":[]}'
)
#: not JSON at all. `parseCanvas` degrades to empty records for this and never
#: throws — the vacuous green `readCanvasRecords` exists to refuse.
UNREADABLE = "{this is not a canvas at all"


def reading(peer: str, text: str) -> dict:
    """A `canvas.file`-shaped reading built from bytes, as a live driver builds it."""
    import hashlib

    raw = text.encode("utf-8")
    return {
        "peer": peer,
        "file": {
            "exists": True,
            "sha256": hashlib.sha256(raw).hexdigest(),
            "size": len(raw),
            "content": text,
        },
    }


AT_100_200 = [{"id": "n1", "x": 100, "y": 200}]


@pytest.fixture(scope="session")
def bridge():
    with JudgeBridge() as b:
        yield b


@pytest.fixture()
def post(bridge):
    return bridge.post


# ---------------------------------------------------------------------------
# tp01 — THE DRIVER SENDS THE CLAUSE AND THE REAL RIG JUDGES IT
# ---------------------------------------------------------------------------

def test_tp01a_three_spellings_of_one_board_are_one_verdict(post):
    """The payoff. Three byte spellings, three digests, three sizes, ONE board —
    and the driver's own green comes back True while the BYTE answer is False."""
    expected = records_expectation("the driver planted n1 at (100,200) before the round", AT_100_200)
    peers = [reading("A", AUTHORED), reading("B", CANONICAL), reading("C", REORDERED)]
    assert len({p["file"]["sha256"] for p in peers}) == 3, "the fixtures must be 3 spellings"
    assert len({p["file"]["size"] for p in peers}) == 3

    v = judge(post, peers, expected)

    assert v["peersAgree"] is False, "the BYTE oracle must call this board diverged"
    assert v["peersAgreeOnRecords"] is True, "the RECORD oracle must call it one board"
    assert v["converged"] is True
    green, why = records_converged(expected, v)
    assert green is True, why


def test_tp01b_the_clause_row_is_stated_and_satisfied(post):
    expected = records_expectation("the driver planted n1 at (100,200)", AT_100_200)
    v = judge(post, [reading("A", AUTHORED), reading("B", CANONICAL)], expected)

    row = records_clause(v)
    assert row is not None
    assert row["stated"] is True
    assert row["satisfied"] is True

    outcome = assess_records(expected, v)
    assert outcome.status == SATISFIED
    assert outcome.judged is True
    assert outcome.green is True
    assert outcome.peers_agree_on_records is True
    assert "n1.x" in outcome.detail and "n1.y" in outcome.detail


def test_tp01c_the_log_line_names_both_agreements(post):
    """An unqualified 'the peers agree' next to `peersAgree: false` is how a
    reader is misled. The battery line must carry both, always."""
    expected = records_expectation("the driver planted n1 at (100,200)", AT_100_200)
    v = judge(post, [reading("A", AUTHORED), reading("B", CANONICAL)], expected)
    line = records_line(expected, v)
    assert "peersAgreeOnRecords=True" in line
    assert "peersAgreeOnBytes=False" in line
    assert "records=SATISFIED" in line and "green=True" in line


# ---------------------------------------------------------------------------
# tp02 — AND IT SAYS NO
# ---------------------------------------------------------------------------

def test_tp02a_a_card_that_moved_is_not_green(post):
    """Both peers hold the SAME bytes and the card is 199 px from where the
    driver put it. Byte agreement is perfect; the round is not green."""
    expected = records_expectation("the driver planted n1 at (100,200)", AT_100_200)
    v = judge(post, [reading("A", MOVED), reading("B", MOVED)], expected)

    assert v["peersAgree"] is True
    assert v["peersAgreeOnRecords"] is True
    assert v["verdict"] == "agreed-on-wrong-bytes"
    assert "records" in v["violations"]

    outcome = assess_records(expected, v)
    assert outcome.status == VIOLATED
    assert outcome.judged is True
    assert outcome.green is False
    assert "n1.y: expected 200, observed 399" in outcome.detail

    green, why = records_converged(expected, v)
    assert green is False
    assert "VIOLATED" in why


def test_tp02b_peers_holding_different_boards_are_not_green(post):
    expected = records_expectation("the driver planted n1 at (100,200)", AT_100_200)
    v = judge(post, [reading("A", CANONICAL), reading("B", MOVED)], expected)

    assert v["peersAgreeOnRecords"] is False
    green, why = records_converged(expected, v)
    assert green is False
    assert v["verdict"] == "diverged"


def test_tp02d_a_satisfied_records_clause_does_not_carry_a_violated_byte_clause(post):
    """WRITTEN BECAUSE A PLANT FOUND NOTHING (BK7). Deleting the `converged`
    conjunct from `records_converged` left all 34 rows green, because in every
    other row a false verdict already coincides with a non-satisfied records
    clause or with record disagreement. This is the case where it does not: the
    board's geometry is exactly right, the peers agree on the records, and a
    DIFFERENT stated clause is violated. `records` is a clause, not the verdict."""
    expected = records_expectation("the driver planted n1 at (100,200)", AT_100_200,
                                   at_least_bytes=10_000)
    v = judge(post, [reading("A", CANONICAL), reading("B", REORDERED)], expected)

    outcome = assess_records(expected, v)
    assert outcome.status == SATISFIED, "the geometry itself is right"
    assert outcome.peers_agree_on_records is True, "and the peers hold the same board"
    assert v["converged"] is False
    assert v["violations"] == ["atLeastBytes"]

    green, why = records_converged(expected, v)
    assert green is False, "a round with a violated clause is not a pass"
    assert "atLeastBytes" in why


def test_tp02c_a_named_node_that_is_absent_is_not_green(post):
    expected = records_expectation("the driver planted n2 at (0,0)", [{"id": "n2", "x": 0, "y": 0}])
    v = judge(post, [reading("A", CANONICAL), reading("B", CANONICAL)], expected)

    outcome = assess_records(expected, v)
    assert outcome.status == VIOLATED
    assert "ABSENT" in outcome.detail
    assert records_converged(expected, v)[0] is False


# ---------------------------------------------------------------------------
# tp03 — THE POINT OF THE PACKAGE: A SILENTLY IGNORED EXPECTATION IS NOT A PASS
# ---------------------------------------------------------------------------

def _pre_wp123_answer(post, board: str) -> dict:
    """What a rig WITHOUT WP123 returns for this board — obtained from the real
    oracle by asking without the records clause, then dropping the field WP123
    added. Not hand-written; the only edit is the removal of things that did not
    exist before WP123."""
    v = judge(post, [reading("A", board), reading("B", board)],
              {"origin": "the driver planted n1 at (100,200)", "exists": True})
    v = dict(v)
    v.pop("peersAgreeOnRecords", None)
    v["clauses"] = [c for c in v["clauses"] if c["clause"] != "records"]
    return v


def test_tp03a_a_pre_wp123_rig_answering_converged_is_NOT_JUDGED(post):
    """S179 in one row. The driver sent a records expectation; the rig ignored
    it and answered `converged: true` for a board whose card moved 199 px."""
    expected = records_expectation("the driver planted n1 at (100,200)", AT_100_200)
    v = _pre_wp123_answer(post, MOVED)

    assert v["converged"] is True, "the trap: the ignored round LOOKS like a pass"
    assert v["violations"] == []
    assert records_clause(v) is None

    outcome = assess_records(expected, v)
    assert outcome.status == NOT_JUDGED
    assert outcome.judged is False
    assert outcome.green is False
    assert outcome.satisfied is None, "never a bare boolean for an unmeasured clause"

    green, why = records_converged(expected, v)
    assert green is False
    assert "NOT_JUDGED" in why


def test_tp03b_NOT_ASKED_and_NOT_JUDGED_are_different_answers(post):
    """The discrimination itself. The SAME rig answer reads NOT_JUDGED for a
    caller who asked and NOT_ASKED for a caller who did not — which is why
    `assess_records` takes the expectation and not only the judgement."""
    v = _pre_wp123_answer(post, MOVED)

    asked = records_expectation("the driver planted n1 at (100,200)", AT_100_200)
    not_asked = {"origin": "the driver planted n1 at (100,200)", "exists": True}

    assert assess_records(asked, v).status == NOT_JUDGED
    assert assess_records(not_asked, v).status == NOT_ASKED
    assert assess_records(asked, v).status != assess_records(not_asked, v).status
    assert records_converged(asked, v)[0] is False
    assert records_converged(not_asked, v)[0] is False, "no records clause is never green"


def test_tp03c_the_real_rig_reports_not_stated_when_nobody_asked(post):
    """The rig's own half of the discrimination, measured rather than assumed:
    `stated: false` / `satisfied: null` / `peersAgreeOnRecords: null`."""
    expected = {"origin": "the driver planted n1 at (100,200)", "exists": True}
    v = judge(post, [reading("A", CANONICAL), reading("B", CANONICAL)], expected)

    row = records_clause(v)
    assert row is not None, "the row is present in EVERY branch, stated or not"
    assert row["stated"] is False
    assert row["satisfied"] is None
    assert v["peersAgreeOnRecords"] is None

    outcome = assess_records(expected, v)
    assert outcome.status == NOT_ASKED
    assert outcome.green is False


def test_tp03d_a_malformed_records_clause_is_a_failure_not_a_silence(post):
    """WP123 R4, driven against the real rig by BYPASSING the local builder — a
    driver written by hand can still send a flatter shape, and it must come back
    stated=true/satisfied=false, never 'not asked'."""
    expected = {"origin": "a hand-written driver sent a flatter shape",
                "records": {"nodes": []}}
    v = judge(post, [reading("A", CANONICAL), reading("B", CANONICAL)], expected)

    row = records_clause(v)
    assert row["stated"] is True
    assert row["satisfied"] is False
    assert "CANNOT BE APPLIED" in row["detail"]

    outcome = assess_records(expected, v)
    assert outcome.status == VIOLATED, "asked-and-unreadable is a failure, not a silence"
    assert records_converged(expected, v)[0] is False


def test_tp03e_a_judged_row_with_a_null_agreement_is_NOT_JUDGED(post):
    """The two halves of the answer must agree that a question was asked. A rig
    whose clause row says stated=true while `peersAgreeOnRecords` is null has
    judged one peer and answered nothing about the others."""
    expected = records_expectation("the driver planted n1 at (100,200)", AT_100_200)
    v = judge(post, [reading("A", CANONICAL), reading("B", CANONICAL)], expected)
    assert assess_records(expected, v).status == SATISFIED, "positive control on the same object"

    half = dict(v)
    half["peersAgreeOnRecords"] = None
    assert assess_records(expected, half).status == NOT_JUDGED

    missing = dict(v)
    missing.pop("peersAgreeOnRecords")
    assert assess_records(expected, missing).status == NOT_JUDGED

    unstated = dict(v)
    unstated["clauses"] = [
        {**c, "stated": False, "satisfied": None} if c["clause"] == "records" else c
        for c in v["clauses"]
    ]
    assert assess_records(expected, unstated).status == NOT_JUDGED


# ---------------------------------------------------------------------------
# tp04 — NEVER SCORED ON BYTES
# ---------------------------------------------------------------------------

def test_tp04a_two_unreadable_peers_never_agree_on_records(post):
    """The vacuous green, executed. Byte-identical UNPARSEABLE content: the byte
    oracle says the peers agree, and the record oracle refuses to."""
    expected = records_expectation("the driver planted n1 at (100,200)", AT_100_200)
    v = judge(post, [reading("A", UNREADABLE), reading("B", UNREADABLE)], expected)

    assert v["peersAgree"] is True, "byte-identical: the byte oracle agrees"
    assert v["peersAgreeOnRecords"] is False, "and the record oracle must not"

    outcome = assess_records(expected, v)
    assert outcome.status == VIOLATED
    assert outcome.green is False
    assert records_converged(expected, v)[0] is False


def test_tp04b_a_green_is_never_read_off_peersAgree(post):
    """A judgement with byte agreement True and record agreement False must not
    be green, whatever the clause row says. This is the field-substitution bug in
    one row: the numbers are the real rig's, the substitution is the plant."""
    expected = records_expectation("the driver planted n1 at (100,200)", AT_100_200)
    v = judge(post, [reading("A", AUTHORED), reading("B", CANONICAL)], expected)
    assert records_converged(expected, v)[0] is True, "positive control on the same object"

    swapped = dict(v)
    swapped["peersAgreeOnRecords"] = False
    swapped["peersAgree"] = True
    green, why = records_converged(expected, swapped)
    assert green is False
    assert "peersAgreeOnRecords" in why


def test_tp04c_contains_is_not_a_geometry_clause(post):
    """`'"x": 100'` is not `'"x":100'`. The same board, the same x, two answers
    from the byte clause and one from the records clause."""
    byte_clause = {"origin": "the driver planted n1 at (100,200)", "contains": ['"x": 100']}
    v_authored = judge(post, [reading("A", AUTHORED), reading("B", AUTHORED)], byte_clause)
    v_canonical = judge(post, [reading("A", CANONICAL), reading("B", CANONICAL)], byte_clause)
    assert v_authored["converged"] is True
    assert v_canonical["converged"] is False, "the same x, spelt without the space"

    expected = records_expectation("the driver planted n1 at (100,200)", AT_100_200)
    for board in (AUTHORED, CANONICAL, REORDERED):
        v = judge(post, [reading("A", board), reading("B", board)], expected)
        assert records_converged(expected, v)[0] is True, f"spelling-dependent on {board[:20]}"


# ---------------------------------------------------------------------------
# tp05 — THE EXPECTATION IS REFUSED AT CONSTRUCTION, NOT AN HOUR INTO A BATTERY
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "origin,nodes,needle",
    [
        ("", AT_100_200, "origin"),
        ("   ", AT_100_200, "origin"),
        ("o", [], "names nothing"),
        ("o", [{"x": 1}], "`id`"),
        ("o", [{"id": ""}], "`id`"),
        ("o", [{"id": "n1"}], "no field of it"),
        ("o", [{"id": "n1", "x": "100"}], "not a number"),
        ("o", [{"id": "n1", "x": True}], "not a number"),
        ("o", [{"id": "n1", "x": float("nan")}], "not finite"),
        ("o", [{"id": "n1", "x": float("inf")}], "not finite"),
        ("o", [{"id": "n1", "text": "card"}], "does not compare"),
        ("o", ["n1"], "not a mapping"),
    ],
)
def test_tp05a_malformed_expectations_are_refused_locally(origin, nodes, needle):
    with pytest.raises(RecordsExpectationError) as e:
        records_expectation(origin, nodes)
    assert needle in str(e.value)


def test_tp05b_what_the_builder_emits_is_what_the_rig_accepts(post):
    """Round-tripped through JSON, exactly as the wire does it."""
    expected = records_expectation("the driver planted n1 at (100,200)", AT_100_200,
                                   exists=True, at_least_bytes=10)
    assert expected == {
        "origin": "the driver planted n1 at (100,200)",
        "records": {"nodes": [{"id": "n1", "x": 100, "y": 200}]},
        "exists": True,
        "atLeastBytes": 10,
    }
    over_the_wire = json.loads(json.dumps(expected))
    v = judge(post, [reading("A", AUTHORED), reading("B", CANONICAL)], over_the_wire)
    assert records_converged(over_the_wire, v)[0] is True


def test_tp05c_width_and_height_are_comparable_fields(post):
    expected = records_expectation("the driver planted n1 160x80", [{"id": "n1", "width": 160, "height": 80}])
    v = judge(post, [reading("A", AUTHORED), reading("B", REORDERED)], expected)
    assert assess_records(expected, v).status == SATISFIED

    wrong = records_expectation("the driver planted n1 160x81", [{"id": "n1", "height": 81}])
    v2 = judge(post, [reading("A", AUTHORED), reading("B", REORDERED)], wrong)
    assert assess_records(expected=wrong, judgement=v2).status == VIOLATED


# ---------------------------------------------------------------------------
# tp06 — CONTROLS: the bridge is not a fake, and an unreachable oracle is not a verdict
# ---------------------------------------------------------------------------

def test_tp06a_the_bridge_answers_only_the_pure_command(bridge):
    """POSITIVE CONTROL on the instrument. The host behind this bridge is empty,
    so anything that needs it must fail structurally. If this row ever goes
    green, the bridge has become a general-purpose fake and every judgement in
    this file is worthless."""
    assert bridge.post("session.info").get("ok") is False
    assert bridge.post("canvas.state", {"path": "x.canvas"}).get("ok") is False
    assert bridge.post("nonsense.command").get("ok") is False
    assert bridge.post("convergence.judge", {
        "peers": [reading("A", CANONICAL), reading("B", CANONICAL)],
        "expected": {"origin": "o", "exists": True},
    }).get("ok") is True, "and the one pure command must answer"


def test_tp06b_an_unreachable_oracle_is_never_a_verdict():
    def refusing_post(_cmd, _args=None):
        return {"ok": False, "error": "unknown cmd: convergence.judge"}

    with pytest.raises(OracleUnreachable):
        judge(refusing_post, [], {"origin": "o"})

    def resultless_post(_cmd, _args=None):
        return {"ok": True}

    with pytest.raises(OracleUnreachable):
        judge(resultless_post, [], {"origin": "o"})


def test_tp06c_fewer_than_two_peers_is_unjudgeable_and_not_green(post):
    expected = records_expectation("the driver planted n1 at (100,200)", AT_100_200)
    v = judge(post, [reading("A", CANONICAL)], expected)
    assert v["verdict"] == "unjudgeable"
    assert v["converged"] is False
    assert v["peersAgreeOnRecords"] is False, "one peer has nobody to agree with"
    assert records_converged(expected, v)[0] is False


# ---------------------------------------------------------------------------
# tp07 — SECRETS (§4)
# ---------------------------------------------------------------------------

def test_tp07a_a_reading_of_data_json_is_refused(tmp_path):
    secret = tmp_path / "data.json"
    secret.write_text('{"token": "not-a-real-one"}', encoding="utf-8")
    with pytest.raises(ValueError) as e:
        disk_reading("A", secret)
    assert "data.json" in str(e.value)
    assert "sha256" in str(e.value)


def test_tp07b_readings_are_built_from_disk_bytes(tmp_path, post):
    a = tmp_path / "a.canvas"
    b = tmp_path / "b.canvas"
    a.write_text(AUTHORED, encoding="utf-8")
    b.write_text(CANONICAL, encoding="utf-8")

    peers = readings([("A", a), ("B", b)])
    assert peers[0]["file"]["size"] != peers[1]["file"]["size"]

    expected = records_expectation("the driver wrote both boards to disk", AT_100_200)
    v = judge(post, peers, expected)
    assert records_converged(expected, v)[0] is True


# ---------------------------------------------------------------------------
# tp08 — THE TWO CALLS A LIVE BATTERY ACTUALLY MAKES
# ---------------------------------------------------------------------------

def test_tp08a_one_round_end_to_end(post, tmp_path):
    a, b = tmp_path / "a.canvas", tmp_path / "b.canvas"
    a.write_text(AUTHORED, encoding="utf-8")
    b.write_text(REORDERED, encoding="utf-8")

    green, why, v, expected = judge_canvas_round(
        post, [("A", a), ("B", b)], "the driver planted n1 at (100,200)", AT_100_200)
    assert green is True, why
    assert v["peersAgree"] is False, "and it was green while the BYTES disagreed"
    assert expected["records"]["nodes"] == [{"id": "n1", "x": 100, "y": 200}]

    b.write_text(MOVED, encoding="utf-8")
    green2, why2, _v2, _e2 = judge_canvas_round(
        post, [("A", a), ("B", b)], "the driver planted n1 at (100,200)", AT_100_200)
    assert green2 is False
    assert "NOT_JUDGED" not in why2, "this is a real divergence, not a missing measurement"


def test_tp08b_a_bound_that_expires_is_not_a_pass(post, tmp_path):
    """The wait returns its OBSERVED elapsed time in both outcomes, and a board
    that never arrives is False after the bound — never True 'because we waited'."""
    a, b = tmp_path / "a.canvas", tmp_path / "b.canvas"
    a.write_text(CANONICAL, encoding="utf-8")
    b.write_text(MOVED, encoding="utf-8")

    green, elapsed, why, v = wait_records_converged(
        post, [("A", a), ("B", b)], "the driver planted n1 at (100,200)", AT_100_200,
        bound_s=0.6, interval=0.1)
    assert green is False
    assert elapsed >= 0.6, f"the bound must actually have been spent: {elapsed}"
    assert v["peersAgreeOnRecords"] is False
    # The REFERENCE reading (peer A) satisfies the clause; it is the OTHER peer
    # that never arrived. `why` must name the agreement, not the clause, or the
    # battery author will go looking at the wrong peer.
    assert "peersAgreeOnRecords=False" in why
    assert assess_records(
        {"origin": "o", "records": {"nodes": [{"id": "n1", "x": 100, "y": 200}]}}, v
    ).status == SATISFIED


def test_tp08c_a_board_that_is_already_there_returns_immediately(post, tmp_path):
    a, b = tmp_path / "a.canvas", tmp_path / "b.canvas"
    a.write_text(AUTHORED, encoding="utf-8")
    b.write_text(CANONICAL, encoding="utf-8")

    green, elapsed, why, _v = wait_records_converged(
        post, [("A", a), ("B", b)], "the driver planted n1 at (100,200)", AT_100_200,
        bound_s=5.0, interval=0.1)
    assert green is True, why
    assert elapsed < 5.0, "a green must not be read off the bound expiring"


def test_tp07c_an_absent_file_reads_as_absent(tmp_path):
    r = disk_reading("A", tmp_path / "nope.canvas")
    assert r == {"exists": False, "sha256": "", "size": 0, "content": None}
