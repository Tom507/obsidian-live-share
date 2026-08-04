# WP70 / AC4 — blind counterpart 2 for "provisioning a vault whose plugin is already
# loaded is refused under RESTART_REQUIRED_OPERATOR and writes nothing".
#
# Different angle: what the probe itself does. A probe that RAISES must not be read as
# "not running" — assuming the instance is down because the question could not be asked
# is precisely how the borrow gets clobbered by a later `saveSettings()`. And the check
# must happen BEFORE the backup is captured, so a refusal never leaves a half-borrow.
#
# DATA SAFETY: synthetic fixture vaults under tmp_path, guarded against both owner
# vaults. No socket is opened; the control probe is injected.

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

from obsidian_e2e import constants, provisioning, relay  # noqa: E402

OWNER_VAULTS = (
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga"),
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie"),
)

RUN_ID = "20260803T125959Z-34-eeff00"
ORIGINAL = b'{\r\n\t"clientId": "fixture-probe"\r\n}'


class ProbeExploded(RuntimeError):
    pass


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
        id="fedcbafe-dcba-fedc-bafe-dcbafedcbafe",
        token="SENTINEL-BLIND2-TOKEN",
        name=f"{constants.RELAY_ROOM_NAME_PREFIX}{RUN_ID}",
        base_url=constants.RELAY_BASE_URL,
    )


def test_a_probe_that_raises_is_not_read_as_not_running(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-explode")

    def probe(port: int) -> bool:
        raise ProbeExploded("the control probe could not be answered")

    with pytest.raises((ProbeExploded, provisioning.RestartRequiredOperator)):
        provisioning.provision_gate_settings(
            vault, constants.ROLE_A, room=make_room(), run_id=RUN_ID, control_probe=probe
        )
    assert (vault / constants.PLUGIN_DATA_REL).read_bytes() == ORIGINAL
    assert not (vault / constants.SETTINGS_BACKUP_REL).exists()
    assert not (vault / constants.PROVISION_MARKER_REL).exists()


def test_the_check_happens_before_the_backup_is_captured(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-before-backup")
    with pytest.raises(provisioning.RestartRequiredOperator):
        provisioning.provision_gate_settings(
            vault, constants.ROLE_B, room=make_room(), run_id=RUN_ID,
            control_probe=lambda port: True,
        )
    assert sorted(p.name for p in (vault / constants.PLUGIN_DIR_REL).iterdir()) == ["data.json"]


def test_the_check_happens_before_the_room_is_written_anywhere(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-no-room-write")
    with pytest.raises(provisioning.RestartRequiredOperator):
        provisioning.provision_gate_settings(
            vault, constants.ROLE_A, room=make_room(), run_id=RUN_ID,
            control_probe=lambda port: True,
        )
    raw = (vault / constants.PLUGIN_DATA_REL).read_bytes()
    assert b"fedcbafe" not in raw
    assert b"SENTINEL-BLIND2-TOKEN" not in raw


def test_a_running_instance_that_stops_lets_the_run_proceed(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-then-stopped")
    running = {"yes": True}

    with pytest.raises(provisioning.RestartRequiredOperator):
        provisioning.provision_gate_settings(
            vault, constants.ROLE_A, room=make_room(), run_id=RUN_ID,
            control_probe=lambda port: running["yes"],
        )

    running["yes"] = False  # the operator closed the window, as instructed
    record = provisioning.provision_gate_settings(
        vault, constants.ROLE_A, room=make_room(), run_id=RUN_ID,
        control_probe=lambda port: running["yes"],
    )
    assert record.provisioned_keys == constants.PROVISIONED_SETTINGS_KEYS
    provisioning.restore_gate_settings(vault)
    assert (vault / constants.PLUGIN_DATA_REL).read_bytes() == ORIGINAL


def test_the_refusal_instructs_rather_than_restarting_anything(tmp_path: Path) -> None:
    # WP45's reason means "stop and instruct". The rig never closes the owner's window.
    vault = make_vault(tmp_path, "vault-instruct")
    with pytest.raises(provisioning.RestartRequiredOperator) as excinfo:
        provisioning.provision_gate_settings(
            vault, constants.ROLE_B, room=make_room(), run_id=RUN_ID,
            control_probe=lambda port: True,
        )
    message = str(excinfo.value).lower()
    assert constants.RESTART_REQUIRED_OPERATOR.lower() in message
    assert str(constants.REAL_CONTROL_PORT_B) in str(excinfo.value)
