# WP44 / AC1 (blind 2) — two vaults, one process: the D14 claim made behaviourally.
#
# Angle: the previous sets check that the environment is not written. This one
# checks the property the environment could not have delivered in the first
# place — two provisionings from ONE python process (one environment, one pid)
# producing two files that disagree about the port. If provisioning had any
# process-global component, the second call would disturb the first.

from __future__ import annotations

import inspect
import json
import os
import sys
from pathlib import Path

# T3_SharedContract import rule: `import tools.…` resolves to the WORKSPACE `tools`
# package (a regular package always beats a namespace portion), never to this repo's.
# Put <repo>/tools on sys.path and import by the globally unique package name.
_TOOLS = Path(__file__).resolve().parents[5] / "tools"
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, ports  # noqa: E402

BASE = b'{\n  "serverPassword": "FAKE-PW-BLIND2-2222",\n  "roomId": "blind-room"\n}\n'


def make_vault(tmp_path: Path, name: str) -> Path:
    vault = tmp_path / name
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(BASE)
    return vault


def port_in(vault: Path) -> int:
    settings = json.loads((vault / constants.PLUGIN_DATA_REL).read_bytes().decode("utf-8"))
    return int(settings[constants.SETTINGS_PORT_KEY])


def test_one_process_provisions_two_vaults_with_two_different_ports(
    tmp_path: Path,
) -> None:
    vault_a = make_vault(tmp_path, "vault-a")
    vault_b = make_vault(tmp_path, "vault-b - Kopie")

    ports.provision_port(vault_a, constants.ROLE_A)
    first_reading = port_in(vault_a)

    ports.provision_port(vault_b, constants.ROLE_B)

    assert port_in(vault_a) == first_reading, (
        "provisioning vault B changed what vault A sees — the port is not per-vault"
    )
    # Both calls ran in this one process, under this one environment: a
    # process-scoped channel could not have produced two different answers.
    assert port_in(vault_b) != port_in(vault_a)
    assert "LIVESHARE_E2E" not in os.environ


def test_the_order_of_provisioning_does_not_matter(tmp_path: Path) -> None:
    vault_a = make_vault(tmp_path, "a2")
    vault_b = make_vault(tmp_path, "b2")

    ports.provision_port(vault_b, constants.ROLE_B)
    ports.provision_port(vault_a, constants.ROLE_A)

    assert port_in(vault_a) == constants.REAL_CONTROL_PORT_A
    assert port_in(vault_b) == constants.REAL_CONTROL_PORT_B


def test_tearing_one_vault_down_leaves_the_other_provisioned(tmp_path: Path) -> None:
    vault_a = make_vault(tmp_path, "a3")
    vault_b = make_vault(tmp_path, "b3")
    ports.provision_port(vault_a, constants.ROLE_A)
    ports.provision_port(vault_b, constants.ROLE_B)

    ports.restore_port(vault_a)

    assert (vault_a / constants.PLUGIN_DATA_REL).read_bytes() == BASE
    assert port_in(vault_b) == constants.REAL_CONTROL_PORT_B
    assert (vault_b / constants.PROVISION_MARKER_REL).is_file()


def test_the_environment_is_identical_before_and_after_the_whole_sequence(
    tmp_path: Path,
) -> None:
    before = dict(os.environ)
    vault_a = make_vault(tmp_path, "a4")
    vault_b = make_vault(tmp_path, "b4")

    ports.provision_port(vault_a, constants.ROLE_A)
    ports.provision_port(vault_b, constants.ROLE_B)
    ports.restore_port(vault_a)
    ports.restore_port(vault_b)

    assert dict(os.environ) == before


def test_the_reason_is_recorded_where_the_provisioning_happens() -> None:
    site = (ports.__doc__ or "") + inspect.getsource(ports.provision_port)
    assert "D14" in site.upper()
    lowered = site.lower()
    assert "env" in lowered
    assert any(
        token in lowered
        for token in ("one obsidian process", "one process", "single process", "same process")
    )
