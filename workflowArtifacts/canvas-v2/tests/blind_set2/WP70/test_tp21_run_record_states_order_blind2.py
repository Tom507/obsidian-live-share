# WP70 / AC4 — blind counterpart 2 for "the run record states which steps ran in which
# order".
#
# Different angle: the ORDER ITSELF is the assertion, checked against the causal chain
# AC4 spells out rather than against a copied list. Every pairwise "must come before"
# relation in the criterion is asserted on `GateSequence.STEPS`, and the record produced
# by a complete run must reproduce that same order.
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

from obsidian_e2e import provisioning  # noqa: E402

RUN_ID = "20260803T105959Z-36-001122"
STEPS = provisioning.GateSequence.STEPS

# AC4, read as a set of causal constraints rather than as a list to copy.
BEFORE = (
    ("install_bundle", "relay_started"),
    ("relay_port_free", "relay_started"),
    ("relay_started", "relay_healthy"),
    ("relay_healthy", "room_minted"),
    ("room_minted", "settings_provisioned"),
    ("community_plugins_disabled", "settings_provisioned"),
    ("settings_provisioned", "obsidian_launched"),
    ("obsidian_launched", "readiness_identity"),
    ("readiness_identity", "scratch_created"),
    ("scratch_created", "matrix_case_1"),
)


@pytest.mark.parametrize("earlier,later", BEFORE)
def test_each_causal_constraint_holds_in_the_pinned_order(earlier: str, later: str) -> None:
    steps = list(STEPS)
    assert earlier in steps, f"{earlier} is not a pinned step"
    assert later in steps, f"{later} is not a pinned step"
    assert steps.index(earlier) < steps.index(later)


def test_a_complete_run_records_the_pinned_order(tmp_path: Path) -> None:
    sequence = provisioning.GateSequence(run_id=RUN_ID)
    for step in STEPS:
        sequence.begin(step)
        sequence.complete(step)

    record = sequence.record()
    assert record["order"] == list(STEPS)
    assert [entry["ordinal"] for entry in record["steps"]] == list(range(1, len(STEPS) + 1))
    assert sequence.teardown_order() == tuple(reversed(STEPS))


@pytest.mark.parametrize("earlier,later", BEFORE)
def test_the_recorded_order_reproduces_each_constraint(earlier: str, later: str) -> None:
    sequence = provisioning.GateSequence(run_id=RUN_ID)
    for step in STEPS:
        sequence.begin(step)
        sequence.complete(step)
    order = sequence.record()["order"]
    assert order.index(earlier) < order.index(later)


def test_the_matrix_case_is_the_last_step_and_the_install_is_the_first() -> None:
    assert STEPS[0] == "install_bundle"
    assert STEPS[-1] == "matrix_case_1"


def test_the_record_of_a_complete_run_is_json_serialisable() -> None:
    sequence = provisioning.GateSequence(run_id=RUN_ID)
    for step in STEPS:
        sequence.begin(step)
        sequence.complete(step)
    parsed = json.loads(json.dumps(sequence.record()))
    assert parsed["order"] == list(STEPS)
    assert parsed["runId"] == RUN_ID
