# WP70 / AC5 — blind counterpart 1 for "content appearing in vault B alone does not
# satisfy the criterion".
#
# ⚠ Nothing here observes propagation. AC5's positive leg is WP7's run.
#
# Different angle: the vault-B facts are added ON TOP of a complete relay-side channel.
# Extra keys must neither help nor hurt — the verdict must be decided by the relay's own
# accounting alone, so a channel with the relay keys is accepted whatever else it carries,
# and a channel without them is refused however convincing the rest looks.
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

ROOM = "bbbb2222-cccc-3333-dddd-444455556666"
RELAY_SIDE = {"roomId": ROOM, "documents": 1, "clients": 2, "frames": 17}
VAULT_B_FACTS = {
    "vaultBContent": True,
    "vaultBSha256": "a" * 64,
    "vaultBMtime": 1785000000,
    "gitPullOnBoot": True,
    "obsidianGitDisabled": True,
}
NEGATIVE = {"relayMediated": False, "changed": False}


def evaluate(positive):
    return relay.evaluate_propagation(
        relay.PropagationEvidence(
            positive=positive,
            negative=dict(NEGATIVE),
            positive_window_s=6.0,
            negative_window_s=6.0,
        )
    )


def test_vault_b_facts_alone_are_refused() -> None:
    with pytest.raises(relay.PropagationEvidenceUnavailable):
        evaluate(dict(VAULT_B_FACTS))


def test_vault_b_facts_on_top_of_a_relay_channel_do_not_change_the_verdict() -> None:
    plain = evaluate(dict(RELAY_SIDE))
    dressed = evaluate({**RELAY_SIDE, **VAULT_B_FACTS})
    assert plain.satisfied == dressed.satisfied is True
    assert plain.positive_observed == dressed.positive_observed is True
    assert plain.reason == dressed.reason


@pytest.mark.parametrize("missing", sorted(RELAY_SIDE))
def test_dropping_one_relay_key_is_refused_however_much_vault_b_evidence_remains(
    missing: str,
) -> None:
    positive = {**RELAY_SIDE, **VAULT_B_FACTS}
    positive.pop(missing)
    with pytest.raises(relay.PropagationEvidenceUnavailable):
        evaluate(positive)


def test_the_obsidian_git_disposition_is_not_a_relay_side_key() -> None:
    for key in ("obsidianGitDisabled", "gitPullOnBoot", "communityPluginsRestored"):
        assert key not in relay.RELAY_EVIDENCE_KEYS


def test_a_vault_b_only_channel_is_refused_even_with_a_leaked_negative_control() -> None:
    # An absent channel cannot be evaluated at all, so the leak is not even reached.
    with pytest.raises(relay.PropagationEvidenceUnavailable):
        relay.evaluate_propagation(
            relay.PropagationEvidence(
                positive=dict(VAULT_B_FACTS),
                negative={"relayMediated": False, "changed": True},
                positive_window_s=6.0,
                negative_window_s=6.0,
            )
        )
