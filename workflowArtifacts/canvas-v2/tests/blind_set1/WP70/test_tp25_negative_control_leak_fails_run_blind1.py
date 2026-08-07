# WP70 / AC5 — blind counterpart 1 for "a negative control that 'passes' (the change
# appears anyway) is NEGATIVE_CONTROL_LEAKED and a FAILED run, not a stronger result".
#
# ⚠ Nothing here observes propagation. AC5's positive leg is WP7's run.
#
# Different angle: the leak dominates every other outcome. It is checked against a weak
# positive leg, a boundary positive leg and an overwhelming one, and against long and
# short windows — in every combination that is still evaluable, the verdict is the leak.
# "It must not be re-run until it passes, and it must not be recorded as green."
#
# DATA SAFETY: pure in-memory evaluation. No socket, no process, no vault.

from __future__ import annotations

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

from obsidian_e2e import constants, relay  # noqa: E402

ROOM = "dddd4444-eeee-5555-ffff-666677778888"
POSITIVES = {
    "weak": {"roomId": ROOM, "documents": 1, "clients": 1, "frames": 0},
    "boundary": {"roomId": ROOM, "documents": 1, "clients": 2, "frames": 1},
    "overwhelming": {"roomId": ROOM, "documents": 12, "clients": 9, "frames": 98765},
}
LEAKED = {"relayMediated": False, "changed": True}


def evaluate(positive: dict, windows=(2.0, 20.0)):
    return relay.evaluate_propagation(
        relay.PropagationEvidence(
            positive=dict(positive),
            negative=dict(LEAKED),
            positive_window_s=windows[0],
            negative_window_s=windows[1],
        )
    )


@pytest.mark.parametrize("label", sorted(POSITIVES))
def test_the_leak_decides_the_verdict_whatever_the_positive_leg_showed(label: str) -> None:
    result = evaluate(POSITIVES[label])
    assert result.negative_leaked is True
    assert result.satisfied is False
    assert result.run_failed is True
    assert result.reason == constants.NEGATIVE_CONTROL_LEAKED


@pytest.mark.parametrize("windows", [(2.0, 2.0), (0.5, 60.0), (10.0, 10.0)])
def test_the_leak_decides_the_verdict_over_every_adequate_window(windows) -> None:
    result = evaluate(POSITIVES["overwhelming"], windows)
    assert result.reason == constants.NEGATIVE_CONTROL_LEAKED
    assert result.run_failed is True


def test_a_leak_is_never_reported_as_a_missing_channel() -> None:
    result = evaluate(POSITIVES["boundary"])
    assert result.reason != constants.PROPAGATION_EVIDENCE_UNAVAILABLE


def test_a_leak_is_a_distinct_named_reason_in_the_shared_enum() -> None:
    assert constants.NEGATIVE_CONTROL_LEAKED in constants.FAILURE_REASONS
    assert constants.NEGATIVE_CONTROL_LEAKED != constants.PROPAGATION_EVIDENCE_UNAVAILABLE
    assert constants.FAILURE_REASONS.count(constants.NEGATIVE_CONTROL_LEAKED) == 1


def test_removing_the_leak_flips_the_verdict() -> None:
    # Without this, the leak assertions would pass for a mechanism that never succeeds.
    clean = relay.evaluate_propagation(
        relay.PropagationEvidence(
            positive=dict(POSITIVES["overwhelming"]),
            negative={"relayMediated": False, "changed": False},
            positive_window_s=2.0,
            negative_window_s=20.0,
        )
    )
    assert clean.satisfied is True
    assert clean.run_failed is False
    assert clean.negative_leaked is False
