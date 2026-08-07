# WP70 / AC5 — the MECHANISM only. "the refusal — `PROPAGATION_EVIDENCE_UNAVAILABLE`
# when either channel is absent."
#
# ⚠ Scope, stated so no reader mistakes a passing WP70 for evidence: AC5's POSITIVE LEG
# CANNOT BE SETTLED BY THIS WORK PACKAGE AT ALL. It needs two real Obsidian instances,
# which is WP7's run. What is testable here is the mechanism and its two evidence
# channels, and the refusal that fires when either is missing. Nothing in this file
# observes propagation, and nothing in it may be cited as evidence that propagation was
# observed.
#
#   ├── T1 an absent positive channel refuses under PROPAGATION_EVIDENCE_UNAVAILABLE
#   ├── T2 an absent negative channel refuses the same way
#   ├── T3 both absent refuses the same way
#   ├── T4 a positive channel missing any relay-side key refuses
#   ├── T5 a negative "control" that was NOT run without the relay path is refused
#   └── T6 a complete pair of channels evaluates — so the refusals are not vacuous
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

POSITIVE = {"roomId": ROOM_ID, "documents": 1, "clients": 2, "frames": 7}
NEGATIVE = {"relayMediated": False, "changed": False}


def evidence(**overrides) -> relay.PropagationEvidence:
    fields = {
        "positive": dict(POSITIVE),
        "negative": dict(NEGATIVE),
        "positive_window_s": 4.0,
        "negative_window_s": 6.0,
    }
    fields.update(overrides)
    return relay.PropagationEvidence(**fields)


def test_an_absent_positive_channel_is_refused() -> None:
    with pytest.raises(relay.PropagationEvidenceUnavailable) as excinfo:
        relay.evaluate_propagation(evidence(positive=None))
    assert excinfo.value.reason == constants.PROPAGATION_EVIDENCE_UNAVAILABLE
    assert constants.PROPAGATION_EVIDENCE_UNAVAILABLE in constants.FAILURE_REASONS


def test_an_absent_negative_channel_is_refused() -> None:
    with pytest.raises(relay.PropagationEvidenceUnavailable) as excinfo:
        relay.evaluate_propagation(evidence(negative=None))
    assert excinfo.value.reason == constants.PROPAGATION_EVIDENCE_UNAVAILABLE


def test_both_channels_absent_is_refused() -> None:
    with pytest.raises(relay.PropagationEvidenceUnavailable):
        relay.evaluate_propagation(evidence(positive=None, negative=None))


@pytest.mark.parametrize("missing", ["roomId", "documents", "clients", "frames"])
def test_a_positive_channel_missing_a_relay_side_key_is_refused(missing: str) -> None:
    partial = dict(POSITIVE)
    partial.pop(missing)
    with pytest.raises(relay.PropagationEvidenceUnavailable) as excinfo:
        relay.evaluate_propagation(evidence(positive=partial))
    assert missing in str(excinfo.value)


def test_a_negative_leg_run_with_the_relay_path_in_place_is_refused() -> None:
    # "the same gesture, performed while the relay-mediated path is provably NOT in
    # place". A negative control run with the relay connected is not a negative control.
    with pytest.raises(relay.PropagationEvidenceUnavailable):
        relay.evaluate_propagation(
            evidence(negative={"relayMediated": True, "changed": False})
        )


@pytest.mark.parametrize("missing", ["relayMediated", "changed"])
def test_a_negative_channel_missing_a_required_key_is_refused(missing: str) -> None:
    partial = dict(NEGATIVE)
    partial.pop(missing)
    with pytest.raises(relay.PropagationEvidenceUnavailable):
        relay.evaluate_propagation(evidence(negative=partial))


def test_an_absent_window_measurement_is_refused() -> None:
    with pytest.raises(relay.PropagationEvidenceUnavailable):
        relay.evaluate_propagation(evidence(positive_window_s=None))
    with pytest.raises(relay.PropagationEvidenceUnavailable):
        relay.evaluate_propagation(evidence(negative_window_s=None))


def test_a_complete_pair_of_channels_evaluates() -> None:
    # Without this, every refusal above would pass for a mechanism that refuses always.
    verdict = relay.evaluate_propagation(evidence())
    assert verdict.positive_observed is True
    assert verdict.negative_leaked is False
    assert verdict.satisfied is True
    assert verdict.run_failed is False
    assert verdict.channels == (relay.POSITIVE_CHANNEL, relay.NEGATIVE_CHANNEL)
