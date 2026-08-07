# WP70 / AC4 — blind counterpart 1 for "provisioning a vault whose plugin is already
# loaded is refused under RESTART_REQUIRED_OPERATOR and writes nothing".
#
# Different angle: ONE of the two vaults has a live instance. The other must still
# provision — a rig that refuses both on the strength of one answering port cannot run at
# all — and the pair must not be left half-provisioned when the second one refuses.
#
# DATA SAFETY: synthetic fixture vaults under tmp_path, guarded against both owner
# vaults. No socket is opened; the control probe is injected.

from __future__ import annotations

import hashlib
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

from obsidian_e2e import constants, provisioning, relay  # noqa: E402

OWNER_VAULTS = (
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga"),
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie"),
)

RUN_ID = "20260803T135959Z-33-ddeeff"
ORIGINAL = b'{\n  "clientId": "fixture-pair"\n}\n'
ORIGINAL_SHA = hashlib.sha256(ORIGINAL).hexdigest()


def assert_synthetic(path: Path) -> Path:
    resolved = Path(path).resolve()
    for owner in OWNER_VAULTS:
        owner_resolved = Path(owner).resolve()
        assert resolved != owner_resolved, f"ABORT: {resolved} is an owner vault"
        assert owner_resolved not in resolved.parents, f"ABORT: {resolved} is inside an owner vault"
        assert resolved not in owner_resolved.parents, f"ABORT: {resolved} contains an owner vault"
    return resolved


def make_vault(tmp_path: Path, name: str) -> Path:
    vault = assert_synthetic(tmp_path / name)
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(ORIGINAL)
    return vault


def make_room() -> relay.RelayRoom:
    return relay.RelayRoom(
        id="abcdefab-cdef-abcd-efab-cdefabcdefab",
        token="SENTINEL-BLIND1-TOKEN",
        name=f"{constants.RELAY_ROOM_NAME_PREFIX}{RUN_ID}",
        base_url=constants.RELAY_BASE_URL,
    )


def only_role_a_is_running(port: int) -> bool:
    return port == constants.REAL_CONTROL_PORT_A


def test_role_a_refuses_while_role_b_still_provisions(tmp_path: Path) -> None:
    room = make_room()
    vault_a = make_vault(tmp_path, "vault-a")
    vault_b = make_vault(tmp_path, "vault-b - Kopie")

    with pytest.raises(provisioning.RestartRequiredOperator):
        provisioning.provision_gate_settings(
            vault_a, constants.ROLE_A, room=room, run_id=RUN_ID,
            control_probe=only_role_a_is_running,
        )

    record = provisioning.provision_gate_settings(
        vault_b, constants.ROLE_B, room=room, run_id=RUN_ID,
        control_probe=only_role_a_is_running,
    )
    assert record.role == constants.ROLE_B
    assert hashlib.sha256((vault_a / constants.PLUGIN_DATA_REL).read_bytes()).hexdigest() == ORIGINAL_SHA


def test_the_refused_vault_keeps_no_rig_artefact(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-refused")
    with pytest.raises(provisioning.RestartRequiredOperator):
        provisioning.provision_gate_settings(
            vault, constants.ROLE_A, room=make_room(), run_id=RUN_ID,
            control_probe=only_role_a_is_running,
        )
    assert sorted(p.name for p in (vault / constants.PLUGIN_DIR_REL).iterdir()) == ["data.json"]


def test_the_probe_result_is_not_cached_across_vaults(tmp_path: Path) -> None:
    # A rig that asks once and reuses the answer would refuse both vaults, or neither.
    asked: list = []

    def probe(port: int) -> bool:
        asked.append(port)
        return port == constants.REAL_CONTROL_PORT_A

    room = make_room()
    a = make_vault(tmp_path, "cache-a")
    b = make_vault(tmp_path, "cache-b")
    with pytest.raises(provisioning.RestartRequiredOperator):
        provisioning.provision_gate_settings(
            a, constants.ROLE_A, room=room, run_id=RUN_ID, control_probe=probe
        )
    provisioning.provision_gate_settings(
        b, constants.ROLE_B, room=room, run_id=RUN_ID, control_probe=probe
    )
    assert asked == [constants.REAL_CONTROL_PORT_A, constants.REAL_CONTROL_PORT_B]


def test_the_reason_is_reused_and_not_reinvented() -> None:
    assert provisioning.RestartRequiredOperator.reason == constants.RESTART_REQUIRED_OPERATOR
    assert constants.RESTART_REQUIRED_OPERATOR in constants.FAILURE_REASONS
    # No WP70-specific variant was introduced beside it.
    variants = [r for r in constants.FAILURE_REASONS if "RESTART" in r]
    assert variants == [constants.RESTART_REQUIRED_OPERATOR]
