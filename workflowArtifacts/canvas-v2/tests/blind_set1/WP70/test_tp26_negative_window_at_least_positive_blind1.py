# WP70 / AC5 — blind counterpart 1 for "the negative-control window is at least as long
# as the positive leg needed".
#
# ⚠ Nothing here observes propagation. AC5's positive leg is WP7's run.
#
# Different angle: the boundary is walked with fractional and very small windows, where a
# comparison written as `>` instead of `>=`, or one that rounds, shows up. A window of
# zero or a negative window is refused whatever the positive leg cost.
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

ROOM = "ffff6666-0000-7777-1111-88889999aaaa"
POSITIVE = {"roomId": ROOM, "documents": 1, "clients": 2, "frames": 4}
CLEAN = {"relayMediated": False, "changed": False}


def evaluate(positive_window: float, negative_window: float):
    return relay.evaluate_propagation(
        relay.PropagationEvidence(
            positive=dict(POSITIVE),
            negative=dict(CLEAN),
            positive_window_s=positive_window,
            negative_window_s=negative_window,
        )
    )


@pytest.mark.parametrize(
    "positive_window,negative_window",
    [(0.125, 0.125), (1.0, 1.0), (2.5, 2.5), (0.001, 0.001)],
)
def test_an_exactly_equal_window_is_accepted(positive_window, negative_window) -> None:
    result = evaluate(positive_window, negative_window)
    assert result.satisfied is True
    assert result.positive_window_s == positive_window
    assert result.negative_window_s == negative_window


@pytest.mark.parametrize(
    "positive_window,negative_window",
    [(0.126, 0.125), (1.0, 0.999), (60.0, 59.999), (2.0, 1.0)],
)
def test_a_window_shorter_by_any_margin_is_refused(positive_window, negative_window) -> None:
    with pytest.raises(relay.PropagationEvidenceUnavailable):
        evaluate(positive_window, negative_window)


@pytest.mark.parametrize("negative_window", [0.0, -0.001, -30.0])
def test_a_zero_or_negative_window_is_refused(negative_window) -> None:
    with pytest.raises(relay.PropagationEvidenceUnavailable):
        evaluate(0.001, negative_window)


@pytest.mark.parametrize("positive_window", [0.0, -1.0])
def test_a_zero_or_negative_positive_window_is_refused(positive_window) -> None:
    # A positive leg that took no time is not a measurement either.
    with pytest.raises(relay.PropagationEvidenceUnavailable):
        evaluate(positive_window, 30.0)


def test_a_longer_negative_window_is_always_accepted() -> None:
    for factor in (1.5, 2.0, 100.0):
        assert evaluate(2.0, 2.0 * factor).satisfied is True
