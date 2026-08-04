# WP70 / AC4 — "Provisioning into a vault whose plugin is already loaded is refused under
# the existing `RESTART_REQUIRED_OPERATOR` reason rather than performed: the settings are
# read once at load (`main.ts:408–417`), so a late write is not read — and worse, any
# later `saveSettings()` in that live instance writes its in-memory copy back over the
# rig's file, silently reverting the provisioning and corrupting the borrow the restore
# depends on."
#
# "Rather than performed" is the load-bearing half. A write followed by a warning has
# already put the borrow at risk, so the assertion is on the vault, not on the message.
# No new reason is invented: WP45's existing `RESTART_REQUIRED_OPERATOR` is reused.
#
#   ├── T1 an answering control port refuses under RESTART_REQUIRED_OPERATOR
#   ├── T2 the refusal writes nothing at all — no settings, no backup, no marker
#   ├── T3 the probe is asked for THIS role's port, not the other role's
#   ├── T4 a silent control port provisions normally, so T1 is not vacuous
#   ├── T5 the reason is the existing WP45 one — no new reason was invented
#   └── T6 the refusal names the vault and the port and leaks no settings value
#
# DATA SAFETY: synthetic fixture vaults under tmp_path, guarded against both owner
# vaults. No socket is opened — the control probe is injected.

from __future__ import annotations

import hashlib
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

from obsidian_e2e import constants, provisioning, relay  # noqa: E402

OWNER_VAULTS = (
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga"),
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie"),
)

RUN_ID = "20260804T000000Z-1-a1b2c3"
SENTINEL_ROOM_TOKEN = "SENTINEL-ROOM-TOKEN-c0ffee-DO-NOT-LEAK"
ORIGINAL = b'{\n  "clientId": "fixture-client-loaded"\n}\n'


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
        id="11111111-2222-3333-4444-555555555555",
        token=SENTINEL_ROOM_TOKEN,
        name=f"{constants.RELAY_ROOM_NAME_PREFIX}{RUN_ID}",
        base_url=constants.RELAY_BASE_URL,
    )


def plugin_dir_names(vault: Path) -> list:
    return sorted(p.name for p in (vault / constants.PLUGIN_DIR_REL).iterdir())


def test_an_answering_control_port_refuses_under_the_existing_reason(
    tmp_path: Path,
) -> None:
    vault = make_vault(tmp_path, "vault-loaded")
    with pytest.raises(provisioning.RestartRequiredOperator) as excinfo:
        provisioning.provision_gate_settings(
            vault,
            constants.ROLE_A,
            room=make_room(),
            run_id=RUN_ID,
            control_probe=lambda port: True,
        )
    assert excinfo.value.reason == constants.RESTART_REQUIRED_OPERATOR


def test_the_refusal_writes_nothing_at_all(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-loaded-nowrite")
    digest = hashlib.sha256(ORIGINAL).hexdigest()

    with pytest.raises(provisioning.RestartRequiredOperator):
        provisioning.provision_gate_settings(
            vault,
            constants.ROLE_B,
            room=make_room(),
            run_id=RUN_ID,
            control_probe=lambda port: True,
        )

    data = (vault / constants.PLUGIN_DATA_REL).read_bytes()
    assert hashlib.sha256(data).hexdigest() == digest
    assert plugin_dir_names(vault) == ["data.json"]


def test_the_probe_is_asked_for_this_roles_port(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-role-port")
    asked: list = []

    with pytest.raises(provisioning.RestartRequiredOperator):
        provisioning.provision_gate_settings(
            vault,
            constants.ROLE_B,
            room=make_room(),
            run_id=RUN_ID,
            control_probe=lambda port: asked.append(port) or True,
        )

    assert asked == [constants.REAL_CONTROL_PORT_B]
    assert constants.REAL_CONTROL_PORT_A not in asked


def test_a_silent_control_port_provisions_normally(tmp_path: Path) -> None:
    # Without this, the refusal would pass for an implementation that refuses always.
    vault = make_vault(tmp_path, "vault-silent")
    record = provisioning.provision_gate_settings(
        vault,
        constants.ROLE_A,
        room=make_room(),
        run_id=RUN_ID,
        control_probe=lambda port: False,
    )
    assert record.provisioned_keys == constants.PROVISIONED_SETTINGS_KEYS
    assert (vault / constants.PROVISION_MARKER_REL).is_file()


def test_no_new_reason_was_invented() -> None:
    assert constants.RESTART_REQUIRED_OPERATOR == "RESTART_REQUIRED_OPERATOR"
    assert constants.RESTART_REQUIRED_OPERATOR in constants.FAILURE_REASONS
    assert constants.FAILURE_REASONS.count(constants.RESTART_REQUIRED_OPERATOR) == 1


def test_the_refusal_names_the_vault_and_port_and_leaks_no_settings_value(
    tmp_path: Path,
) -> None:
    vault = make_vault(tmp_path, "vault-message")
    with pytest.raises(provisioning.RestartRequiredOperator) as excinfo:
        provisioning.provision_gate_settings(
            vault,
            constants.ROLE_A,
            room=make_room(),
            run_id=RUN_ID,
            control_probe=lambda port: True,
        )
    message = str(excinfo.value)
    assert str(constants.REAL_CONTROL_PORT_A) in message
    assert vault.name in message
    assert SENTINEL_ROOM_TOKEN not in message
    assert "fixture-client-loaded" not in message
