# WP70 / AC5 — "a **negative control** in which the same gesture … does **not** produce
# the change in vault B within a window **at least as long as the positive leg needed**."
#
# A negative control measured over a shorter window than the positive leg took proves
# nothing: the change may simply not have had time to arrive by the other path. The
# window comparison is therefore a precondition of the negative channel being a channel
# at all — not a stylistic preference — so a short window is refused rather than scored.
#
#   ├── T1 a negative window shorter than the positive leg is refused
#   ├── T2 the refusal names both windows so the operator can widen the right one
#   ├── T3 an exactly equal window is accepted — "at least as long" includes equal
#   ├── T4 a longer negative window is accepted
#   ├── T5 the check is on the WINDOWS, not on the counts — a strong positive cannot buy it
#   └── T6 a zero-length negative window is refused even when the positive leg was fast
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
POSITIVE = {"roomId": ROOM_ID, "documents": 1, "clients": 2, "frames": 9}
STRONG_POSITIVE = {"roomId": ROOM_ID, "documents": 5, "clients": 6, "frames": 4096}
CLEAN = {"relayMediated": False, "changed": False}


def evidence(positive_window: float, negative_window: float, positive=POSITIVE):
    return relay.PropagationEvidence(
        positive=dict(positive),
        negative=dict(CLEAN),
        positive_window_s=positive_window,
        negative_window_s=negative_window,
    )


def test_a_shorter_negative_window_is_refused() -> None:
    with pytest.raises(relay.PropagationEvidenceUnavailable) as excinfo:
        relay.evaluate_propagation(evidence(8.0, 3.0))
    assert excinfo.value.reason == constants.PROPAGATION_EVIDENCE_UNAVAILABLE


def test_the_refusal_names_both_windows() -> None:
    with pytest.raises(relay.PropagationEvidenceUnavailable) as excinfo:
        relay.evaluate_propagation(evidence(8.0, 3.0))
    message = str(excinfo.value)
    assert "8" in message and "3" in message


def test_an_exactly_equal_window_is_accepted() -> None:
    verdict = relay.evaluate_propagation(evidence(4.0, 4.0))
    assert verdict.satisfied is True
    assert verdict.negative_window_s == 4.0
    assert verdict.positive_window_s == 4.0


def test_a_longer_negative_window_is_accepted() -> None:
    verdict = relay.evaluate_propagation(evidence(4.0, 40.0))
    assert verdict.satisfied is True
    assert verdict.negative_window_s >= verdict.positive_window_s


def test_a_strong_positive_leg_cannot_buy_a_short_window() -> None:
    # The window comparison is about the negative channel's adequacy. No amount of
    # relay-side traffic makes a too-short negative control into a negative control.
    with pytest.raises(relay.PropagationEvidenceUnavailable):
        relay.evaluate_propagation(evidence(30.0, 1.0, positive=STRONG_POSITIVE))


def test_a_zero_length_negative_window_is_refused() -> None:
    with pytest.raises(relay.PropagationEvidenceUnavailable):
        relay.evaluate_propagation(evidence(0.5, 0.0))
