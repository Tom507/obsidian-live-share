# WP70 / AC5 — blind counterpart 2 for "content appearing in vault B alone does not
# satisfy the criterion".
#
# ⚠ Nothing here observes propagation. AC5's positive leg is WP7's run.
#
# Different angle: the counts. "two distinct clients carried traffic in the rig's own
# room" is a statement about numbers the relay itself produced. A single client is one
# peer talking to itself; zero frames is no traffic; zero documents is no canvas doc. The
# boundary is walked one count at a time, from just-below to just-enough.
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

ROOM = "cccc3333-dddd-4444-eeee-555566667777"
CLEAN = {"relayMediated": False, "changed": False}


def verdict(documents: int, clients: int, frames: int):
    return relay.evaluate_propagation(
        relay.PropagationEvidence(
            positive={"roomId": ROOM, "documents": documents, "clients": clients, "frames": frames},
            negative=dict(CLEAN),
            positive_window_s=1.0,
            negative_window_s=1.0,
        )
    )


@pytest.mark.parametrize(
    "documents,clients,frames",
    [
        (0, 0, 0),
        (1, 0, 5),
        (1, 1, 5),
        (1, 2, 0),
        (0, 2, 5),
        (0, 5, 500),
    ],
)
def test_counts_below_the_boundary_are_not_a_positive_observation(
    documents: int, clients: int, frames: int
) -> None:
    result = verdict(documents, clients, frames)
    assert result.positive_observed is False
    assert result.satisfied is False
    assert result.run_failed is False


@pytest.mark.parametrize(
    "documents,clients,frames",
    [
        (1, 2, 1),
        (1, 2, 10_000),
        (3, 4, 7),
    ],
)
def test_counts_at_or_above_the_boundary_are_a_positive_observation(
    documents: int, clients: int, frames: int
) -> None:
    result = verdict(documents, clients, frames)
    assert result.positive_observed is True
    assert result.satisfied is True


def test_the_room_id_is_carried_through_to_the_verdict_channel_list() -> None:
    result = verdict(1, 2, 3)
    assert result.channels == (relay.POSITIVE_CHANNEL, relay.NEGATIVE_CHANNEL)
    assert relay.POSITIVE_CHANNEL != relay.NEGATIVE_CHANNEL


def test_a_negative_count_is_never_a_positive_observation() -> None:
    result = verdict(-1, -2, -3)
    assert result.positive_observed is False
    assert result.satisfied is False


def test_an_unsatisfied_positive_leg_is_not_a_failed_run() -> None:
    # "Not demonstrated" and "the negative control leaked" are different outcomes and
    # must not be reported under the same name.
    result = verdict(1, 1, 1)
    assert result.reason == constants.PROPAGATION_EVIDENCE_UNAVAILABLE
    assert result.reason != constants.NEGATIVE_CONTROL_LEAKED
    assert result.run_failed is False
