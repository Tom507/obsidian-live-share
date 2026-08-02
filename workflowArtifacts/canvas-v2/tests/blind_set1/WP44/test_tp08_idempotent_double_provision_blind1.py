# WP44 / AC3 (blind 1) — idempotence under repetition and under a changing port.
#
# Angle: the visible set provisions the same port twice. Here the same vault is
# provisioned five times with alternating ports and roles — the shape a retried
# or re-entered rig actually produces. However often it runs, there is exactly one
# saved original, it is the file the owner had before the first run, and one
# teardown puts it back.

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

# T3_SharedContract import rule: `import tools.…` resolves to the WORKSPACE `tools`
# package (a regular package always beats a namespace portion), never to this repo's.
# Put <repo>/tools on sys.path and import by the globally unique package name.
_TOOLS = Path(__file__).resolve().parents[5] / "tools"
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, ports  # noqa: E402

ORIGINAL = (
    '{\r\n  "serverPassword": "FAKE-PW-BLIND1-8888",\r\n  "roomId": "blind-room"\r\n}\r\n'
).encode("utf-8")
ORIGINAL_SHA = hashlib.sha256(ORIGINAL).hexdigest()


def make_vault(tmp_path: Path) -> Path:
    vault = tmp_path / "v-idem"
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(ORIGINAL)
    return vault


def marker_of(vault: Path) -> dict:
    return json.loads((vault / constants.PROVISION_MARKER_REL).read_bytes().decode("utf-8"))


def test_five_provisionings_keep_exactly_one_original(tmp_path: Path) -> None:
    vault = make_vault(tmp_path)
    plugin_dir = vault / constants.PLUGIN_DIR_REL

    sequence = [
        (constants.ROLE_A, None),
        (constants.ROLE_A, None),
        (constants.ROLE_B, None),
        (constants.ROLE_A, 45111),
        (constants.ROLE_A, None),
    ]
    for role, port in sequence:
        ports.provision_port(vault, role, port=port)

        # exactly three files, always the same three
        assert sorted(p.name for p in plugin_dir.iterdir()) == sorted(
            Path(rel).name
            for rel in (
                constants.PLUGIN_DATA_REL,
                constants.SETTINGS_BACKUP_REL,
                constants.PROVISION_MARKER_REL,
            )
        )
        assert (vault / constants.SETTINGS_BACKUP_REL).read_bytes() == ORIGINAL
        assert marker_of(vault)["originalSha256"] == ORIGINAL_SHA
        assert marker_of(vault)["hadOriginal"] is True

    result = ports.restore_port(vault)
    assert result.restored is True
    assert (vault / constants.PLUGIN_DATA_REL).read_bytes() == ORIGINAL


def test_the_live_setting_follows_the_last_provisioning(tmp_path: Path) -> None:
    vault = make_vault(tmp_path)

    ports.provision_port(vault, constants.ROLE_A)
    ports.provision_port(vault, constants.ROLE_B)

    live = json.loads((vault / constants.PLUGIN_DATA_REL).read_bytes().decode("utf-8"))
    assert int(live[constants.SETTINGS_PORT_KEY]) == constants.REAL_CONTROL_PORT_B
    assert marker_of(vault)["port"] == constants.REAL_CONTROL_PORT_B
    assert marker_of(vault)["role"] == constants.ROLE_B


def test_repeating_the_same_provisioning_is_byte_stable(tmp_path: Path) -> None:
    vault = make_vault(tmp_path)
    settings_path = vault / constants.PLUGIN_DATA_REL

    ports.provision_port(vault, constants.ROLE_A)
    snapshots = {settings_path.read_bytes()}
    for _ in range(4):
        ports.provision_port(vault, constants.ROLE_A)
        snapshots.add(settings_path.read_bytes())

    assert len(snapshots) == 1, "repeated provisioning must converge on one file state"


def test_a_full_cycle_can_be_repeated_from_scratch(tmp_path: Path) -> None:
    vault = make_vault(tmp_path)
    settings_path = vault / constants.PLUGIN_DATA_REL

    for _ in range(3):
        ports.provision_port(vault, constants.ROLE_A)
        ports.provision_port(vault, constants.ROLE_A)
        ports.restore_port(vault)
        assert settings_path.read_bytes() == ORIGINAL
        assert not (vault / constants.SETTINGS_BACKUP_REL).exists()
        assert not (vault / constants.PROVISION_MARKER_REL).exists()
