# WP70 / AC5 — "A run in which the positive leg passes and the negative control also
# 'passes' (the change appears anyway) is a **failed** run reported under a named
# reason, not a stronger result."
#
# This is the assertion that keeps the mechanism honest. If both legs "succeed", the
# obvious reading is *everything worked twice* — but a change that arrives without the
# relay means the run cannot attribute anything to the relay, and `obsidian-git`'s
# `autoPullOnBoot: true` is a live mechanism for exactly that. So: NEGATIVE_CONTROL_LEAKED,
# FAILED, reported under its name. Never re-run until green.
#
#   ├── T1 a leaked negative control yields satisfied=False with the named reason
#   ├── T2 it is a FAILED run: run_failed is True
#   ├── T3 a STRONG positive leg does not rescue it — a leak is never upgraded
#   ├── T4 the leak is visible in the verdict as its own field, not only as a reason
#   ├── T5 the reason is NEGATIVE_CONTROL_LEAKED, not PROPAGATION_EVIDENCE_UNAVAILABLE
#   └── T6 a clean negative control with the same positive leg is satisfied
#
# DATA SAFETY: pure in-memory evaluation. No socket, no process, no vault.

from __future__ import annotations

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

from obsidian_e2e import constants, relay  # noqa: E402

ROOM_ID = "11111111-2222-3333-4444-555555555555"
STRONG_POSITIVE = {"roomId": ROOM_ID, "documents": 3, "clients": 4, "frames": 512}
MODEST_POSITIVE = {"roomId": ROOM_ID, "documents": 1, "clients": 2, "frames": 1}
LEAKED = {"relayMediated": False, "changed": True}
CLEAN = {"relayMediated": False, "changed": False}


def evidence(positive: dict, negative: dict) -> relay.PropagationEvidence:
    return relay.PropagationEvidence(
        positive=dict(positive),
        negative=dict(negative),
        positive_window_s=5.0,
        negative_window_s=9.0,
    )


def test_a_leaked_negative_control_is_not_satisfied() -> None:
    verdict = relay.evaluate_propagation(evidence(MODEST_POSITIVE, LEAKED))
    assert verdict.satisfied is False
    assert verdict.reason == constants.NEGATIVE_CONTROL_LEAKED


def test_a_leaked_negative_control_is_a_failed_run() -> None:
    verdict = relay.evaluate_propagation(evidence(MODEST_POSITIVE, LEAKED))
    assert verdict.run_failed is True
    assert constants.NEGATIVE_CONTROL_LEAKED in constants.FAILURE_REASONS


def test_a_strong_positive_leg_does_not_rescue_a_leak() -> None:
    # The seductive misreading: "both legs passed, so the result is stronger."
    verdict = relay.evaluate_propagation(evidence(STRONG_POSITIVE, LEAKED))
    assert verdict.positive_observed is True
    assert verdict.satisfied is False
    assert verdict.run_failed is True
    assert verdict.reason == constants.NEGATIVE_CONTROL_LEAKED


def test_the_leak_is_its_own_field_in_the_verdict() -> None:
    verdict = relay.evaluate_propagation(evidence(STRONG_POSITIVE, LEAKED))
    assert verdict.negative_leaked is True
    clean = relay.evaluate_propagation(evidence(STRONG_POSITIVE, CLEAN))
    assert clean.negative_leaked is False


def test_the_reason_is_the_leak_not_an_unavailable_channel() -> None:
    # Both channels were present and both were measured. Reporting the leak as a
    # missing channel would hide the one thing the run actually learned.
    verdict = relay.evaluate_propagation(evidence(STRONG_POSITIVE, LEAKED))
    assert verdict.reason != constants.PROPAGATION_EVIDENCE_UNAVAILABLE
    assert verdict.reason == constants.NEGATIVE_CONTROL_LEAKED


def test_a_clean_negative_control_with_the_same_positive_leg_is_satisfied() -> None:
    verdict = relay.evaluate_propagation(evidence(MODEST_POSITIVE, CLEAN))
    assert verdict.satisfied is True
    assert verdict.run_failed is False
    assert verdict.reason is None
