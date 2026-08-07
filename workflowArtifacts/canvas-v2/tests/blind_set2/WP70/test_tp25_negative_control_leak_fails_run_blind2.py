# WP70 / AC5 — blind counterpart 2 for "a negative control that 'passes' (the change
# appears anyway) is NEGATIVE_CONTROL_LEAKED and a FAILED run, not a stronger result".
#
# ⚠ Nothing here observes propagation. AC5's positive leg is WP7's run.
#
# Different angle: WHY the leak matters. `obsidian-git` carries `autoPullOnBoot: true` in
# both vaults over dirty trees with `origin` remotes, and it fires at LAUNCH — so content
# it brings in arrives at instance start-up rather than in response to the gesture. That
# is precisely a change that "appears anyway", and it is why the disposition record may
# not substitute for the negative control.
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

ROOM = "eeee5555-ffff-6666-0000-777788889999"
POSITIVE = {"roomId": ROOM, "documents": 2, "clients": 2, "frames": 33}


def evaluate(negative: dict):
    return relay.evaluate_propagation(
        relay.PropagationEvidence(
            positive=dict(POSITIVE),
            negative=dict(negative),
            positive_window_s=4.0,
            negative_window_s=15.0,
        )
    )


def test_a_change_that_arrived_without_the_relay_fails_the_run() -> None:
    result = evaluate({"relayMediated": False, "changed": True})
    assert result.run_failed is True
    assert result.reason == constants.NEGATIVE_CONTROL_LEAKED


def test_claiming_obsidian_git_was_disabled_does_not_excuse_the_leak() -> None:
    # "If satisfying this criterion required trusting that the disabling actually took
    # effect, the disposition record would have become the evidence."
    result = evaluate(
        {
            "relayMediated": False,
            "changed": True,
            "obsidianGitDisabled": True,
            "communityPluginsRestored": True,
        }
    )
    assert result.satisfied is False
    assert result.reason == constants.NEGATIVE_CONTROL_LEAKED


def test_a_negative_leg_that_still_had_the_relay_path_is_not_a_control() -> None:
    with pytest.raises(relay.PropagationEvidenceUnavailable):
        evaluate({"relayMediated": True, "changed": False})
    with pytest.raises(relay.PropagationEvidenceUnavailable):
        evaluate({"relayMediated": True, "changed": True})


@pytest.mark.parametrize("changed", [True, 1, "yes"])
def test_only_a_boolean_false_counts_as_no_change(changed) -> None:
    # A truthy non-boolean must not be silently read as "no change"; the mechanism
    # either fails the run or refuses, but never reports green.
    if changed is True:
        assert evaluate({"relayMediated": False, "changed": changed}).run_failed is True
    else:
        with pytest.raises(relay.PropagationEvidenceUnavailable):
            evaluate({"relayMediated": False, "changed": changed})


def test_a_clean_control_over_a_long_window_is_the_only_green_shape() -> None:
    result = evaluate({"relayMediated": False, "changed": False})
    assert result.satisfied is True
    assert result.run_failed is False
    assert result.negative_leaked is False
    assert result.negative_window_s >= result.positive_window_s
