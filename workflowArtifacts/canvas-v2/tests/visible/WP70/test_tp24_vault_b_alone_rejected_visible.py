# WP70 / AC5 — "Content appearing in vault B is **not** sufficient on its own and may
# not be recorded as satisfying this criterion."
#
# This is the substitution AC5 exists to refuse, and it is the substitution that is
# easiest to make by accident: the second engine (`obsidian-git`, enabled in both vaults
# with `autoPullOnBoot: true`) can bring content into either vault by a path that has
# nothing to do with the relay — and it fires at LAUNCH, so its content can arrive before
# the gesture and make the positive leg look better than it is.
#
# ⚠ AC5's positive leg cannot be settled by WP70 at all; nothing here observes
# propagation. These tests pin only that the mechanism REFUSES a verdict built on
# vault-B content.
#
#   ├── T1 a positive channel that is only a vault-B observation is refused
#   ├── T2 the same, dressed up with a file hash and a timestamp, is still refused
#   ├── T3 the disposition record of obsidian-git cannot stand in for the channel either
#   ├── T4 relay-side keys are what the mechanism requires, and they are named
#   ├── T5 insufficient relay counts are NOT satisfied — one client is not two
#   └── T6 a genuine relay-side observation is accepted — T1..T5 are not vacuous
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
NEGATIVE = {"relayMediated": False, "changed": False}

VAULT_B_ONLY = {"vaultBContent": True}
VAULT_B_DRESSED = {
    "vaultBContent": True,
    "vaultBSha256": "9" * 64,
    "observedAt": "2026-08-04T12:00:00+00:00",
    "gestureApplied": True,
}
DISPOSITION_ONLY = {
    "obsidianGitDisabled": True,
    "communityPluginsRestored": True,
    "vaultBContent": True,
}


def evidence(positive) -> relay.PropagationEvidence:
    return relay.PropagationEvidence(
        positive=positive,
        negative=dict(NEGATIVE),
        positive_window_s=4.0,
        negative_window_s=6.0,
    )


def test_a_vault_b_only_positive_channel_is_refused() -> None:
    with pytest.raises(relay.PropagationEvidenceUnavailable) as excinfo:
        relay.evaluate_propagation(evidence(dict(VAULT_B_ONLY)))
    assert excinfo.value.reason == constants.PROPAGATION_EVIDENCE_UNAVAILABLE


def test_a_dressed_up_vault_b_observation_is_still_refused() -> None:
    with pytest.raises(relay.PropagationEvidenceUnavailable):
        relay.evaluate_propagation(evidence(dict(VAULT_B_DRESSED)))


def test_the_obsidian_git_disposition_record_cannot_stand_in_for_the_channel() -> None:
    # "A precondition is a claim about what was configured; AC5 is a claim about what
    # the relay observed. If the disposition record could satisfy AC5, the record would
    # have become the evidence."
    with pytest.raises(relay.PropagationEvidenceUnavailable):
        relay.evaluate_propagation(evidence(dict(DISPOSITION_ONLY)))


def test_the_mechanism_names_the_relay_side_keys_it_requires() -> None:
    assert relay.RELAY_EVIDENCE_KEYS == ("roomId", "documents", "clients", "frames")
    for key in relay.RELAY_EVIDENCE_KEYS:
        assert key not in VAULT_B_DRESSED
    assert "vaultBContent" not in relay.RELAY_EVIDENCE_KEYS


@pytest.mark.parametrize(
    "positive",
    [
        {"roomId": ROOM_ID, "documents": 1, "clients": 1, "frames": 7},
        {"roomId": ROOM_ID, "documents": 1, "clients": 2, "frames": 0},
        {"roomId": ROOM_ID, "documents": 0, "clients": 2, "frames": 7},
    ],
)
def test_insufficient_relay_counts_are_not_satisfied(positive: dict) -> None:
    # One client is one peer talking to itself; zero frames is no traffic; zero
    # documents is no canvas document. None of them is "two distinct clients carried
    # traffic on the run's canvas document".
    verdict = relay.evaluate_propagation(evidence(positive))
    assert verdict.positive_observed is False
    assert verdict.satisfied is False
    assert verdict.reason == constants.PROPAGATION_EVIDENCE_UNAVAILABLE


def test_a_genuine_relay_side_observation_is_accepted() -> None:
    verdict = relay.evaluate_propagation(
        evidence({"roomId": ROOM_ID, "documents": 1, "clients": 2, "frames": 12})
    )
    assert verdict.positive_observed is True
    assert verdict.satisfied is True
