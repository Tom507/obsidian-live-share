# WP44 / AC3 (blind 2) — idempotence across complete cycles, where the "original"
# legitimately changes between them.
#
# Angle: the previous sets repeat the provisioning step. Here the whole borrow is
# repeated — provision, restore, provision again — after the owner edited their
# settings in between. Each cycle must capture the file that was there when THAT
# cycle started; an implementation that caches, or that keeps the first capture
# alive across cycles, restores the owner's file to a version they replaced.

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

VERSIONS = [
    b'{\n  "roomId": "v1",\n  "serverPassword": "FAKE-PW-BLIND2-8888"\n}\n',
    b'{\r\n  "roomId": "v2",\r\n  "serverPassword": "FAKE-PW-BLIND2-8888"\r\n}',
    b'{\t"roomId": "v3", "serverPassword": "FAKE-PW-BLIND2-8888"\t}\n\n',
]


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def make_vault(tmp_path: Path) -> Path:
    vault = tmp_path / "v-cycles"
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    return vault


def test_each_cycle_captures_the_file_that_cycle_started_with(tmp_path: Path) -> None:
    vault = make_vault(tmp_path)
    settings_path = vault / constants.PLUGIN_DATA_REL

    for version in VERSIONS:
        settings_path.write_bytes(version)  # the owner edited their settings

        ports.provision_port(vault, constants.ROLE_A)
        marker = json.loads(
            (vault / constants.PROVISION_MARKER_REL).read_bytes().decode("utf-8")
        )
        assert marker["originalSha256"] == sha(version)

        ports.provision_port(vault, constants.ROLE_A)  # idempotent repeat
        assert (vault / constants.SETTINGS_BACKUP_REL).read_bytes() == version

        ports.restore_port(vault)
        assert settings_path.read_bytes() == version


def test_the_backup_never_survives_a_cycle(tmp_path: Path) -> None:
    vault = make_vault(tmp_path)
    settings_path = vault / constants.PLUGIN_DATA_REL
    plugin_dir = vault / constants.PLUGIN_DIR_REL

    for version in VERSIONS:
        settings_path.write_bytes(version)
        ports.provision_port(vault, constants.ROLE_B)
        ports.restore_port(vault)
        assert sorted(p.name for p in plugin_dir.iterdir()) == [
            Path(constants.PLUGIN_DATA_REL).name
        ]


def test_a_cycle_that_starts_with_no_file_and_one_that_does_not_interfere(
    tmp_path: Path,
) -> None:
    vault = make_vault(tmp_path)
    settings_path = vault / constants.PLUGIN_DATA_REL

    # cycle 1: no file at all
    ports.provision_port(vault, constants.ROLE_A)
    ports.provision_port(vault, constants.ROLE_A)
    ports.restore_port(vault)
    assert not settings_path.exists()

    # cycle 2: the owner has since created one
    settings_path.write_bytes(VERSIONS[0])
    record = ports.provision_port(vault, constants.ROLE_A)
    assert record.had_original is True
    assert record.original_sha256 == sha(VERSIONS[0])
    ports.restore_port(vault)
    assert settings_path.read_bytes() == VERSIONS[0]

    # cycle 3: the owner deleted it again
    settings_path.unlink()
    record = ports.provision_port(vault, constants.ROLE_A)
    assert record.had_original is False
    ports.restore_port(vault)
    assert not settings_path.exists()


def test_repeated_provisioning_converges_on_one_state(tmp_path: Path) -> None:
    vault = make_vault(tmp_path)
    settings_path = vault / constants.PLUGIN_DATA_REL
    settings_path.write_bytes(VERSIONS[1])

    seen = set()
    for _ in range(6):
        ports.provision_port(vault, constants.ROLE_B)
        seen.add(sha(settings_path.read_bytes()))

    assert len(seen) == 1
    ports.restore_port(vault)
    assert settings_path.read_bytes() == VERSIONS[1]
