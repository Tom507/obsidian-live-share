# WP44 / AC1 (blind 1) — the settings file is the channel, seen from the
# "the key is already there" side.
#
# Angle: the visible set provisions into vaults that have never seen the hidden
# key. Here the key already exists — with a stale value from an earlier headless
# run, with a string value, and with a value of the wrong type entirely. Whatever
# was there, the provisioned port must be the one that ends up readable, and the
# rest of the file must not gain a second port-shaped key.

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

# T3_SharedContract import rule: `import tools.…` resolves to the WORKSPACE `tools`
# package (a regular package always beats a namespace portion), never to this repo's.
# Put <repo>/tools on sys.path and import by the globally unique package name.
_TOOLS = Path(__file__).resolve().parents[5] / "tools"
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, ports  # noqa: E402

BASE = {
    "serverUrl": "wss://example.invalid/ws-mux/",
    "serverPassword": "FAKE-PW-BLIND1-1111",
    "roomId": "blind-room",
}


def make_vault(tmp_path: Path, name: str, settings: dict) -> Path:
    vault = tmp_path / name
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(
        json.dumps(settings, indent=4).encode("utf-8")
    )
    return vault


def live_settings(vault: Path) -> dict:
    return json.loads((vault / constants.PLUGIN_DATA_REL).read_bytes().decode("utf-8"))


@pytest.mark.parametrize(
    ("label", "stale"),
    [
        ("stale_headless_port", 39421),
        ("stale_string_port", "39422"),
        ("wrong_type", True),
        ("null", None),
    ],
)
def test_a_stale_port_key_is_replaced_not_duplicated(
    tmp_path: Path, label: str, stale: object
) -> None:
    vault = make_vault(tmp_path, f"v-{label}", {**BASE, constants.SETTINGS_PORT_KEY: stale})

    record = ports.provision_port(vault, constants.ROLE_B)

    settings = live_settings(vault)
    assert int(settings[constants.SETTINGS_PORT_KEY]) == constants.REAL_CONTROL_PORT_B
    assert record.port == constants.REAL_CONTROL_PORT_B
    # exactly one port-shaped key
    port_keys = [k for k in settings if "port" in k.lower()]
    assert port_keys == [constants.SETTINGS_PORT_KEY]
    # and the stale value is gone from the live file
    assert settings[constants.SETTINGS_PORT_KEY] != stale

    ports.restore_port(vault)
    assert live_settings(vault)[constants.SETTINGS_PORT_KEY] == stale


def test_the_two_roles_stay_independent_when_both_vaults_start_identical(
    tmp_path: Path,
) -> None:
    # Same starting bytes in both vaults: whatever distinguishes the two ports can
    # only be the per-vault file, since nothing else about them differs.
    vault_a = make_vault(tmp_path, "Vault Eins", BASE)
    vault_b = make_vault(tmp_path, "Vault Eins - Kopie", BASE)

    ports.provision_port(vault_a, constants.ROLE_A)
    ports.provision_port(vault_b, constants.ROLE_B)

    a = int(live_settings(vault_a)[constants.SETTINGS_PORT_KEY])
    b = int(live_settings(vault_b)[constants.SETTINGS_PORT_KEY])
    assert (a, b) == (constants.REAL_CONTROL_PORT_A, constants.REAL_CONTROL_PORT_B)
    assert a != b

    # Restoring one vault does not disturb the other.
    ports.restore_port(vault_a)
    assert constants.SETTINGS_PORT_KEY not in live_settings(vault_a)
    assert int(live_settings(vault_b)[constants.SETTINGS_PORT_KEY]) == b


def test_an_explicit_port_is_honoured_for_either_role(tmp_path: Path) -> None:
    for role, port in ((constants.ROLE_A, 45001), (constants.ROLE_B, 45002)):
        vault = make_vault(tmp_path, f"v-explicit-{role}", BASE)
        record = ports.provision_port(vault, role, port=port)
        assert record.port == port
        assert int(live_settings(vault)[constants.SETTINGS_PORT_KEY]) == port
        assert record.role == role
