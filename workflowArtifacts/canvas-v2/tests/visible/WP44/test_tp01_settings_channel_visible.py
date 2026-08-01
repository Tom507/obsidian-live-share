# WP44 / AC1 — the control port is provisioned through the per-vault settings file.
#
# D14: both vault windows can live inside ONE Obsidian process, so `process.env`
# cannot differ between them. `data.json` lives inside the vault, so the hidden
# `e2eControlPort` setting is the only channel that can carry two different values.
#
#   ├── T1 the provisioned port lands in <vault>/.obsidian/plugins/live-share/data.json
#   │      under the pinned key, in a form `resolvePort()` accepts.
#   ├── T2 two vaults provisioned for the two roles carry DIFFERENT ports, and both
#   │      are disjoint from the existing headless-rig pair (D13).
#   ├── T3 provisioning changes that one key and nothing else — every other setting
#   │      keeps its exact value and no key is dropped or added.
#   └── T4 the returned record describes what was actually written.
#
# Data safety: every vault here is built under pytest `tmp_path`. The fixture
# settings contain obviously-fake credentials; nothing reads the owner's vaults.

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from obsidian_e2e import constants, ports

# The existing headless mock rig's pair (T3_SharedContract §3, owned by
# tools/launch_liveshare_e2e.py, NOT by constants.py). Named here only to assert
# disjointness — the real rig must never be confusable with the mock rig (D13).
HEADLESS_RIG_PORTS = (39421, 39422)

FAKE_SETTINGS = {
    "serverUrl": "wss://example.invalid/ws-mux/",
    "serverPassword": "FAKE-PASSWORD-NOT-REAL-0000",
    "token": "FAKE-TOKEN-0000",
    "jwt": "FAKE-JWT-0000",
    "roomId": "fixture-room",
    "clientId": "fixture-client",
    "role": "host",
    "debug": False,
}


def make_vault(tmp_path: Path, name: str, settings: dict | None) -> Path:
    vault = tmp_path / name
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    if settings is not None:
        (vault / constants.PLUGIN_DATA_REL).write_bytes(
            json.dumps(settings, indent=2).encode("utf-8")
        )
    return vault


def read_settings(vault: Path) -> dict:
    return json.loads((vault / constants.PLUGIN_DATA_REL).read_bytes().decode("utf-8"))


def test_port_is_written_into_the_per_vault_settings_file(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-a", FAKE_SETTINGS)

    record = ports.provision_port(vault, constants.ROLE_A)

    settings_path = vault / constants.PLUGIN_DATA_REL
    assert settings_path.is_file(), "the per-vault settings file must exist after provisioning"

    written = read_settings(vault)
    assert constants.SETTINGS_PORT_KEY in written
    value = written[constants.SETTINGS_PORT_KEY]
    # resolvePort() accepts a positive number or a numeric string; both are legal
    # here, but the value must round-trip to the provisioned port.
    assert int(value) == record.port
    assert record.port == constants.REAL_CONTROL_PORT_A


def test_two_roles_carry_two_different_ports_disjoint_from_the_headless_rig(
    tmp_path: Path,
) -> None:
    # Vault B's real counterpart is "ObsidianOrga - Kopie" — a path containing a
    # space is the normal case here, not an edge case.
    vault_a = make_vault(tmp_path, "vault-a", FAKE_SETTINGS)
    vault_b = make_vault(tmp_path, "vault-b - Kopie", FAKE_SETTINGS)

    rec_a = ports.provision_port(vault_a, constants.ROLE_A)
    rec_b = ports.provision_port(vault_b, constants.ROLE_B)

    port_a = int(read_settings(vault_a)[constants.SETTINGS_PORT_KEY])
    port_b = int(read_settings(vault_b)[constants.SETTINGS_PORT_KEY])

    assert port_a == rec_a.port == constants.REAL_CONTROL_PORT_A
    assert port_b == rec_b.port == constants.REAL_CONTROL_PORT_B
    assert port_a != port_b, "two instances in one process must be independently addressable"

    for port in (port_a, port_b):
        assert port not in HEADLESS_RIG_PORTS, (
            "the real rig must not reuse the headless mock rig's ports (D13) — "
            "a stale mock process must never satisfy a real-rig readiness check"
        )

    assert ports.default_port_for_role(constants.ROLE_A) == constants.REAL_CONTROL_PORT_A
    assert ports.default_port_for_role(constants.ROLE_B) == constants.REAL_CONTROL_PORT_B


def test_no_other_setting_is_touched(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-a", FAKE_SETTINGS)

    ports.provision_port(vault, constants.ROLE_A)

    written = read_settings(vault)
    # Exactly one key added, none removed.
    assert set(written) == set(FAKE_SETTINGS) | {constants.SETTINGS_PORT_KEY}
    for key, value in FAKE_SETTINGS.items():
        assert written[key] == value, f"provisioning changed the unrelated setting {key!r}"


def test_an_explicit_port_overrides_the_role_default(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-a", FAKE_SETTINGS)

    record = ports.provision_port(vault, constants.ROLE_A, port=45999)

    assert record.port == 45999
    assert int(read_settings(vault)[constants.SETTINGS_PORT_KEY]) == 45999
    assert record.role == constants.ROLE_A
    assert record.had_original is True
    assert record.original_sha256 == hashlib.sha256(
        json.dumps(FAKE_SETTINGS, indent=2).encode("utf-8")
    ).hexdigest()


def test_an_unknown_role_is_rejected(tmp_path: Path) -> None:
    with pytest.raises(Exception):
        ports.default_port_for_role("c")
