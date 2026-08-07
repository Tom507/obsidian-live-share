# WP70 / AC5 — blind counterpart 2 for "the negative-control window is at least as long
# as the positive leg needed".
#
# ⚠ Nothing here observes propagation. AC5's positive leg is WP7's run.
#
# Different angle: PRECEDENCE. An inadequate negative-control window means the negative
# channel is not a channel, so it must be refused BEFORE the leak is scored — otherwise a
# run with a too-short window and an apparent leak would be reported as a leak, which
# claims more than the measurement supports. The order of the checks is the assertion.
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

ROOM = "00007777-1111-8888-2222-9999aaaabbbb"
POSITIVE = {"roomId": ROOM, "documents": 1, "clients": 2, "frames": 4}


def evidence(negative: dict, positive_window: float, negative_window: float):
    return relay.PropagationEvidence(
        positive=dict(POSITIVE),
        negative=dict(negative),
        positive_window_s=positive_window,
        negative_window_s=negative_window,
    )


def test_a_short_window_is_refused_even_when_the_control_leaked() -> None:
    # The leak would be the louder outcome, but it is not supported: the window was too
    # short to have shown anything either way.
    with pytest.raises(relay.PropagationEvidenceUnavailable):
        relay.evaluate_propagation(
            evidence({"relayMediated": False, "changed": True}, 30.0, 1.0)
        )


def test_a_short_window_is_refused_even_when_the_control_was_clean() -> None:
    with pytest.raises(relay.PropagationEvidenceUnavailable):
        relay.evaluate_propagation(
            evidence({"relayMediated": False, "changed": False}, 30.0, 1.0)
        )


def test_an_adequate_window_lets_the_leak_be_scored() -> None:
    result = relay.evaluate_propagation(
        evidence({"relayMediated": False, "changed": True}, 30.0, 30.0)
    )
    assert result.reason == constants.NEGATIVE_CONTROL_LEAKED
    assert result.run_failed is True


def test_an_absent_channel_is_refused_before_the_window_is_compared() -> None:
    with pytest.raises(relay.PropagationEvidenceUnavailable) as excinfo:
        relay.evaluate_propagation(
            relay.PropagationEvidence(
                positive=None,
                negative={"relayMediated": False, "changed": True},
                positive_window_s=30.0,
                negative_window_s=1.0,
            )
        )
    assert relay.POSITIVE_CHANNEL in str(excinfo.value)


def test_the_window_refusal_names_both_measurements() -> None:
    with pytest.raises(relay.PropagationEvidenceUnavailable) as excinfo:
        relay.evaluate_propagation(
            evidence({"relayMediated": False, "changed": False}, 12.0, 5.0)
        )
    message = str(excinfo.value)
    assert "12" in message and "5" in message


def test_the_verdict_reports_both_windows_when_it_does_evaluate() -> None:
    result = relay.evaluate_propagation(
        evidence({"relayMediated": False, "changed": False}, 3.0, 7.0)
    )
    assert result.positive_window_s == 3.0
    assert result.negative_window_s == 7.0
    assert result.satisfied is True
