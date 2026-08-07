# WP70 / AC5 — blind counterpart 1 for "the mechanism refuses under
# PROPAGATION_EVIDENCE_UNAVAILABLE when either evidence channel is absent".
#
# ⚠ AC5's positive leg cannot be settled by this work package at all — it needs two real
# Obsidian instances, which is WP7's run. Nothing here observes propagation.
#
# Different angle: a channel that is present but EMPTY, or of the wrong type, is still an
# absent channel. `{}`, `[]`, `""`, `0` and a list-of-pairs all "exist" in the sense that
# they are not `None`, and none of them is an evidence channel.
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

ROOM = "aaaa1111-bbbb-2222-cccc-333344445555"
GOOD_POSITIVE = {"roomId": ROOM, "documents": 2, "clients": 3, "frames": 40}
GOOD_NEGATIVE = {"relayMediated": False, "changed": False}

EMPTY_ISH = ({}, [], "", 0, [("roomId", ROOM)], ())


def evidence(**overrides) -> relay.PropagationEvidence:
    fields = {
        "positive": dict(GOOD_POSITIVE),
        "negative": dict(GOOD_NEGATIVE),
        "positive_window_s": 2.5,
        "negative_window_s": 12.0,
    }
    fields.update(overrides)
    return relay.PropagationEvidence(**fields)


@pytest.mark.parametrize("value", EMPTY_ISH, ids=lambda v: repr(v)[:20])
def test_an_empty_or_wrongly_typed_positive_channel_is_absent(value) -> None:
    with pytest.raises(relay.PropagationEvidenceUnavailable):
        relay.evaluate_propagation(evidence(positive=value))


@pytest.mark.parametrize("value", EMPTY_ISH, ids=lambda v: repr(v)[:20])
def test_an_empty_or_wrongly_typed_negative_channel_is_absent(value) -> None:
    with pytest.raises(relay.PropagationEvidenceUnavailable):
        relay.evaluate_propagation(evidence(negative=value))


def test_the_refusal_names_the_channel_that_is_missing() -> None:
    with pytest.raises(relay.PropagationEvidenceUnavailable) as excinfo:
        relay.evaluate_propagation(evidence(positive=None))
    assert relay.POSITIVE_CHANNEL in str(excinfo.value)

    with pytest.raises(relay.PropagationEvidenceUnavailable) as excinfo:
        relay.evaluate_propagation(evidence(negative=None))
    assert relay.NEGATIVE_CHANNEL in str(excinfo.value)


def test_the_refusal_is_a_named_reason_from_the_shared_enum() -> None:
    with pytest.raises(relay.PropagationEvidenceUnavailable) as excinfo:
        relay.evaluate_propagation(evidence(negative=None))
    assert excinfo.value.reason == constants.PROPAGATION_EVIDENCE_UNAVAILABLE
    assert excinfo.value.reason in constants.FAILURE_REASONS
    assert issubclass(relay.PropagationEvidenceUnavailable, relay.RelayError)


def test_both_channels_present_evaluates_without_raising() -> None:
    verdict = relay.evaluate_propagation(evidence())
    assert verdict.satisfied is True
    assert verdict.reason is None
    assert verdict.channels == (relay.POSITIVE_CHANNEL, relay.NEGATIVE_CHANNEL)
