# WP70 / AC4 — "the run record states which steps ran in which order."
#
# In a mediated run the ordering is the thing most easily lost. A record that lists the
# steps as a SET, or that records only the ones that succeeded, or that renders them in
# whatever order a dict happened to iterate, does not state an order. The assertions
# therefore pin the sequence, the ordinals and the status of every step — including the
# one that failed.
#
#   ├── T1 the pinned start-up order is exactly the sequence AC4 names
#   ├── T2 the record lists the completed steps in the order they ran, with ordinals
#   ├── T3 an interrupted run records the step that was open when it stopped
#   ├── T4 the record does NOT invent steps that never ran
#   ├── T5 teardown_order() is the reverse of what actually ran
#   └── T6 the record is JSON-serialisable and carries the run id
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
        _REPO = _parent
        _TOOLS = _parent / "tools"
        break
else:  # pragma: no cover
    raise RuntimeError(f"obsidian-live-share repo root not found from {__file__}")
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, provisioning  # noqa: E402

RUN_ID = "20260804T000000Z-1-a1b2c3"

# AC4, verbatim: install+verify bundle (C69) -> relay port free -> relay started ->
# relay healthz-ok -> room minted on THAT relay -> per vault: obsidian-git disabled ->
# data.json borrowed and provisioned -> launch/attach (C45) -> readiness+identity (C46)
# -> scratch (C47) -> matrix case 1 (C50).
EXPECTED_ORDER = (
    "install_bundle",
    "relay_port_free",
    "relay_started",
    "relay_healthy",
    "room_minted",
    "community_plugins_disabled",
    "settings_provisioned",
    "obsidian_launched",
    "readiness_identity",
    "scratch_created",
    "matrix_case_1",
)


def run_through(sequence, upto: int) -> None:
    for step in provisioning.GateSequence.STEPS[:upto]:
        sequence.begin(step)
        sequence.complete(step)


def test_the_pinned_start_up_order_is_the_one_ac4_names() -> None:
    assert provisioning.GateSequence.STEPS == EXPECTED_ORDER
    assert len(set(EXPECTED_ORDER)) == len(EXPECTED_ORDER)
    # The three constraints the pinned table owns must be adjacent in this order.
    steps = list(EXPECTED_ORDER)
    assert steps.index("relay_healthy") < steps.index("room_minted")
    assert steps.index("room_minted") < steps.index("settings_provisioned")
    assert steps.index("settings_provisioned") < steps.index("obsidian_launched")
    assert steps.index("community_plugins_disabled") < steps.index("settings_provisioned")


def test_the_record_lists_the_completed_steps_in_the_order_they_ran() -> None:
    sequence = provisioning.GateSequence(run_id=RUN_ID)
    run_through(sequence, 5)

    record = sequence.record()
    assert record["order"] == list(EXPECTED_ORDER[:5])
    ordinals = [entry["ordinal"] for entry in record["steps"]]
    assert ordinals == list(range(1, 6))
    assert all(entry["status"] == "completed" for entry in record["steps"])


def test_an_interrupted_run_records_the_step_that_was_open() -> None:
    sequence = provisioning.GateSequence(run_id=RUN_ID)
    run_through(sequence, 3)
    sequence.begin(EXPECTED_ORDER[3])  # started, never completed

    record = sequence.record()
    assert record["order"][-1] == EXPECTED_ORDER[3]
    assert record["steps"][-1]["status"] == "started"
    assert sequence.current == EXPECTED_ORDER[3]
    assert sequence.completed == EXPECTED_ORDER[:3]


def test_the_record_does_not_invent_steps_that_never_ran() -> None:
    sequence = provisioning.GateSequence(run_id=RUN_ID)
    run_through(sequence, 2)

    record = sequence.record()
    named = {entry["step"] for entry in record["steps"]}
    assert named == set(EXPECTED_ORDER[:2])
    assert "matrix_case_1" not in named


def test_teardown_order_is_the_reverse_of_what_actually_ran() -> None:
    sequence = provisioning.GateSequence(run_id=RUN_ID)
    run_through(sequence, 4)
    assert sequence.teardown_order() == tuple(reversed(EXPECTED_ORDER[:4]))
    # Not the reverse of the WHOLE pinned order — steps that never ran are not undone.
    assert "matrix_case_1" not in sequence.teardown_order()


def test_the_record_is_json_serialisable_and_carries_the_run_id() -> None:
    sequence = provisioning.GateSequence(run_id=RUN_ID)
    run_through(sequence, 6)
    raw = json.dumps(sequence.record(), sort_keys=True)
    parsed = json.loads(raw)
    assert parsed["runId"] == RUN_ID
    assert len(parsed["steps"]) == 6


def test_an_unknown_step_is_never_recorded() -> None:
    sequence = provisioning.GateSequence(run_id=RUN_ID)
    with pytest.raises(provisioning.GateOrderViolation):
        sequence.begin("relay_teleported")
    assert sequence.record()["steps"] == []
