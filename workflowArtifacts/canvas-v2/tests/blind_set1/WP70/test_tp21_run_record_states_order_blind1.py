# WP70 / AC4 — blind counterpart 1 for "the run record states which steps ran in which
# order".
#
# Different angle: the degenerate records. A run that did nothing, a run that did one
# step, and a run whose record is asked for twice must all produce a stable, honest
# statement — a record that renumbers itself between reads is not a record.
#
# DATA SAFETY: pure in-memory bookkeeping. Nothing is written, started or opened.

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

# --- repo bootstrap (T3_SharedContract §0.2) --------------------------------------
for _parent in Path(__file__).resolve().parents:
    if (_parent / "tools").is_dir() and (_parent / "plugin").is_dir():
        _TOOLS = _parent / "tools"
        break
else:  # pragma: no cover
    raise RuntimeError(f"obsidian-live-share repo root not found from {__file__}")
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, provisioning  # noqa: E402

RUN_ID = "20260803T115959Z-35-ff0011"
STEPS = provisioning.GateSequence.STEPS


def test_a_run_that_did_nothing_records_nothing(tmp_path: Path) -> None:
    sequence = provisioning.GateSequence(run_id=RUN_ID)
    record = sequence.record()
    assert record["runId"] == RUN_ID
    assert record["steps"] == []
    assert record["order"] == []
    assert sequence.completed == ()
    assert sequence.current is None
    assert sequence.teardown_order() == ()


def test_a_run_that_did_one_step_records_exactly_that_step() -> None:
    sequence = provisioning.GateSequence(run_id=RUN_ID)
    sequence.begin(STEPS[0])
    sequence.complete(STEPS[0])

    record = sequence.record()
    assert record["order"] == [STEPS[0]]
    assert record["steps"] == [{"ordinal": 1, "step": STEPS[0], "status": "completed"}]
    assert sequence.teardown_order() == (STEPS[0],)


def test_the_record_is_stable_across_repeated_reads() -> None:
    sequence = provisioning.GateSequence(run_id=RUN_ID)
    for step in STEPS[:4]:
        sequence.begin(step)
        sequence.complete(step)

    first = json.dumps(sequence.record(), sort_keys=True)
    second = json.dumps(sequence.record(), sort_keys=True)
    assert first == second


def test_a_record_taken_mid_run_does_not_change_the_run() -> None:
    sequence = provisioning.GateSequence(run_id=RUN_ID)
    sequence.begin(STEPS[0])
    sequence.record()
    sequence.complete(STEPS[0])
    sequence.record()
    sequence.begin(STEPS[1])

    assert sequence.completed == (STEPS[0],)
    assert sequence.current == STEPS[1]
    assert [entry["ordinal"] for entry in sequence.record()["steps"]] == [1, 2]


def test_two_sequences_do_not_share_state() -> None:
    a = provisioning.GateSequence(run_id="run-a")
    b = provisioning.GateSequence(run_id="run-b")
    a.begin(STEPS[0])
    a.complete(STEPS[0])

    assert b.completed == ()
    assert b.record()["runId"] == "run-b"
    assert a.record()["runId"] == "run-a"


def test_a_refused_step_leaves_the_record_untouched() -> None:
    sequence = provisioning.GateSequence(run_id=RUN_ID)
    sequence.begin(STEPS[0])
    sequence.complete(STEPS[0])
    before = json.dumps(sequence.record(), sort_keys=True)

    with pytest.raises(provisioning.GateOrderViolation):
        sequence.begin(STEPS[3])

    assert json.dumps(sequence.record(), sort_keys=True) == before
