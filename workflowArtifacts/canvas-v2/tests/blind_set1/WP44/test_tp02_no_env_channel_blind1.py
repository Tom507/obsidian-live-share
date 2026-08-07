# WP44 / AC1 (blind 1) — no environment channel, checked on the failure paths too.
#
# Angle: the visible set proves the happy path leaves the environment alone. A
# rig that sets an env var and only cleans it up on success is just as broken, so
# here the environment is compared around a REFUSED provisioning and around a
# failed restore as well — and the D14 rationale is required to sit in the
# provisioning function itself, not merely somewhere in the file.

from __future__ import annotations

import inspect
import json
import os
import re
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

ORIGINAL = b'{\n  "serverPassword": "FAKE-PW-BLIND1-2222",\n  "roomId": "blind-room"\n}\n'


def make_vault(tmp_path: Path, name: str = "v") -> Path:
    vault = tmp_path / name
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(ORIGINAL)
    return vault


def env_snapshot() -> dict[str, str]:
    return dict(os.environ)


def test_a_refused_provisioning_leaves_the_environment_alone(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "v-conflict")
    # contradictory leftovers → the call must refuse
    (vault / constants.SETTINGS_BACKUP_REL).write_bytes(b'{"roomId": "something-else"}')
    before = env_snapshot()

    with pytest.raises(Exception):
        ports.provision_port(vault, constants.ROLE_A)

    assert env_snapshot() == before


def test_a_failed_restore_leaves_the_environment_alone(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "v-badrestore")
    ports.provision_port(vault, constants.ROLE_A)
    (vault / constants.SETTINGS_BACKUP_REL).write_bytes(b"corrupted")
    before = env_snapshot()

    with pytest.raises(Exception):
        ports.restore_port(vault)

    assert env_snapshot() == before


def test_env_flags_of_every_shape_are_left_untouched(tmp_path: Path, monkeypatch) -> None:
    for value in ("", "1", "yes", "39421"):
        monkeypatch.setenv("LIVESHARE_E2E", value)
        vault = make_vault(tmp_path, f"v-env-{value or 'empty'}")

        ports.provision_port(vault, constants.ROLE_A)
        assert os.environ["LIVESHARE_E2E"] == value

        settings = json.loads((vault / constants.PLUGIN_DATA_REL).read_bytes().decode())
        assert int(settings[constants.SETTINGS_PORT_KEY]) == constants.REAL_CONTROL_PORT_A

        ports.restore_port(vault)
        assert os.environ["LIVESHARE_E2E"] == value


def test_the_rationale_lives_in_the_provisioning_function_or_its_module_docstring() -> None:
    site = (ports.__doc__ or "") + inspect.getsource(ports.provision_port)
    lowered = site.lower()

    assert "d14" in lowered
    assert "env" in lowered
    assert any(
        token in lowered
        for token in ("one obsidian process", "one process", "single process", "same process")
    )

    # And the module must not carry a second, environment-based channel.
    source = inspect.getsource(ports)
    assert not re.search(r"os\.environ\s*\[[^\]]+\]\s*=", source)
    assert "putenv" not in source
