# WP44 / AC1 (blind 2) — the channel proven by what a reader of the file sees.
#
# Angle: neither previous set asks whether the value the rig wrote is a value
# `resolvePort()` would actually accept. The TS side accepts a positive number or
# a string of digits, and nothing else — a float, a padded string or a JSON
# string like " 39431 " silently means "no port", which on a real run looks like
# a dead vault. So the assertion here is on the *acceptability* of the written
# value, checked with resolvePort's own rule, across a set of odd starting files.

from __future__ import annotations

import json
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

# resolvePort()'s acceptance rule, mirrored from plugin/src/testing/e2e-control.ts:
#   typeof setting === "number" && setting > 0   →  that port
#   typeof setting === "string" && /^\d+$/       →  Number(setting)
DIGITS = re.compile(r"^\d+$")


def resolvable_port(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value > 0:
        return value
    if isinstance(value, float):
        return None
    if isinstance(value, str) and DIGITS.match(value):
        return int(value)
    return None


STARTING_FILES = {
    "empty_object": b"{}",
    "empty_object_pretty": b"{\n}\n",
    "unrelated_keys_only": b'{\n  "theme": "obsidian",\n  "zoom": 1.25\n}\n',
    "deeply_nested": (
        b'{\n  "a": {"b": {"c": {"d": [1, 2, {"e": null}]}}},\n'
        b'  "serverPassword": "FAKE-PW-BLIND2-1111"\n}\n'
    ),
    "array_valued_settings": b'{\n  "ignoredPaths": ["a", "b"],\n  "roomId": "r"\n}\n',
}


def make_vault(tmp_path: Path, name: str, blob: bytes) -> Path:
    vault = tmp_path / name
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(blob)
    return vault


@pytest.mark.parametrize("label", sorted(STARTING_FILES))
def test_the_written_value_is_one_resolveport_accepts(tmp_path: Path, label: str) -> None:
    vault = make_vault(tmp_path, f"v-{label}", STARTING_FILES[label])

    record = ports.provision_port(vault, constants.ROLE_A)

    settings = json.loads((vault / constants.PLUGIN_DATA_REL).read_bytes().decode("utf-8"))
    written = settings[constants.SETTINGS_PORT_KEY]
    assert resolvable_port(written) == record.port, (
        f"{label}: resolvePort would read {resolvable_port(written)!r} from {written!r}"
    )
    assert record.port == constants.REAL_CONTROL_PORT_A


def test_both_roles_are_resolvable_and_different(tmp_path: Path) -> None:
    vault_a = make_vault(tmp_path, "Notizen ü", STARTING_FILES["empty_object"])
    vault_b = make_vault(tmp_path, "Notizen ü - Kopie", STARTING_FILES["empty_object"])

    ports.provision_port(vault_a, constants.ROLE_A)
    ports.provision_port(vault_b, constants.ROLE_B)

    read = {}
    for role, vault in ((constants.ROLE_A, vault_a), (constants.ROLE_B, vault_b)):
        settings = json.loads((vault / constants.PLUGIN_DATA_REL).read_bytes().decode("utf-8"))
        read[role] = resolvable_port(settings[constants.SETTINGS_PORT_KEY])

    assert read[constants.ROLE_A] == constants.REAL_CONTROL_PORT_A
    assert read[constants.ROLE_B] == constants.REAL_CONTROL_PORT_B
    assert read[constants.ROLE_A] != read[constants.ROLE_B]
    assert None not in read.values()


def test_the_settings_file_stays_valid_json_the_plugin_can_load(tmp_path: Path) -> None:
    # Obsidian reads data.json with JSON.parse; a provisioned file that no longer
    # parses would disable the plugin's settings entirely.
    for label, blob in STARTING_FILES.items():
        vault = make_vault(tmp_path, f"v-parse-{label}", blob)
        ports.provision_port(vault, constants.ROLE_B)
        parsed = json.loads((vault / constants.PLUGIN_DATA_REL).read_bytes().decode("utf-8"))
        assert isinstance(parsed, dict), label
        # ... and every pre-existing key is still there with its value
        before = json.loads(blob.decode("utf-8"))
        for key, value in before.items():
            assert parsed[key] == value, f"{label}: {key} changed"
