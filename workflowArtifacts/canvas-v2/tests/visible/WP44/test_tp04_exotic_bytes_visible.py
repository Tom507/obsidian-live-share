# WP44 / AC2 — byte-exact means byte-exact: formatting that a JSON round-trip
# destroys must survive untouched.
#
# This is the test that decides whether the implementation is honest. A naive
# `json.load()` + `json.dump()` restore reproduces the *values* and silently
# rewrites indentation, line endings, key order, number formatting, escape style
# and the trailing newline. Every fixture below is deliberately chosen so that a
# JSON round-trip changes the bytes — the suite asserts that too, so a fixture can
# never quietly stop being adversarial.
#
#   ├── T1 each adversarial fixture is provisioned and restored byte-for-byte.
#   ├── T2 each fixture really is destroyed by a JSON round-trip (fixture audit).
#   └── T3 restore is exact for a file that is not pretty-printed at all.
#
# Data safety: fixture vaults under tmp_path; fake credential values only. The
# assertions compare hashes and lengths, never content.

from __future__ import annotations

import hashlib
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

# --- adversarial originals -------------------------------------------------
# Each is raw bytes on purpose: the shape of the file IS the test data.

TAB_INDENTED_LF = (
    b'{\n'
    b'\t"serverUrl": "wss://example.invalid/ws-mux/",\n'
    b'\t"serverPassword": "FAKE-PASSWORD-NOT-REAL-0000",\n'
    b'\t"roomId": "fixture-room"\n'
    b'}\n'
)

CRLF_NO_TRAILING_NEWLINE = (
    b'{\r\n'
    b'  "roomId": "fixture-room",\r\n'
    b'  "serverPassword": "FAKE-PASSWORD-NOT-REAL-0000",\r\n'
    b'  "clientId": "fixture-client"\r\n'
    b'}'
)

UNUSUAL_KEY_ORDER_AND_SPACING = (
    b'{\n'
    b'    "zLastKey": true,\n'
    b'    "aFirstKey": 1,\n'
    b'        "deeplyIndented": "still valid JSON",\n'
    b'    "serverPassword" : "FAKE-PASSWORD-NOT-REAL-0000"\n'
    b'}\n'
)

NON_ASCII_RAW_UTF8 = (
    '{\n'
    '  "vaultLabel": "Ordnerübersicht — ünïcødé ✓",\n'
    '  "serverPassword": "FAKE-PASSWORD-NOT-REAL-0000",\n'
    '  "note": "日本語のメモ"\n'
    '}\n'
).encode("utf-8")

NON_ASCII_ESCAPED = (
    b'{\n'
    b'  "vaultLabel": "Ordner\\u00fcbersicht \\u2014 \\u00fcn\\u00efc\\u00f8d\\u00e9",\n'
    b'  "serverPassword": "FAKE-PASSWORD-NOT-REAL-0000"\n'
    b'}\n'
)

NUMBER_FORMATS = (
    b'{\n'
    b'  "reconnectDelay": 1e3,\n'
    b'  "ratio": 1.50,\n'
    b'  "zeroish": 0.0,\n'
    b'  "big": 1000000,\n'
    b'  "serverPassword": "FAKE-PASSWORD-NOT-REAL-0000"\n'
    b'}\n'
)

MINIFIED_NO_NEWLINE = (
    b'{"roomId":"fixture-room","serverPassword":"FAKE-PASSWORD-NOT-REAL-0000",'
    b'"nested":{"a":[1,2,3],"b":null}}'
)

TRAILING_BLANK_LINES = (
    b'{\n'
    b'  "roomId": "fixture-room",\n'
    b'  "serverPassword": "FAKE-PASSWORD-NOT-REAL-0000"\n'
    b'}\n'
    b'\n'
    b'\n'
)

FIXTURES = {
    "tab_indented_lf": TAB_INDENTED_LF,
    "crlf_no_trailing_newline": CRLF_NO_TRAILING_NEWLINE,
    "unusual_key_order_and_spacing": UNUSUAL_KEY_ORDER_AND_SPACING,
    "non_ascii_raw_utf8": NON_ASCII_RAW_UTF8,
    "non_ascii_escaped": NON_ASCII_ESCAPED,
    "number_formats": NUMBER_FORMATS,
    "minified_no_newline": MINIFIED_NO_NEWLINE,
    "trailing_blank_lines": TRAILING_BLANK_LINES,
}


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def make_vault(tmp_path: Path, name: str, original: bytes) -> Path:
    vault = tmp_path / name
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(original)
    return vault


@pytest.mark.parametrize("label", sorted(FIXTURES))
def test_adversarial_settings_files_survive_a_full_cycle_byte_for_byte(
    tmp_path: Path, label: str
) -> None:
    original = FIXTURES[label]
    vault = make_vault(tmp_path, f"vault-{label}", original)
    settings_path = vault / constants.PLUGIN_DATA_REL
    digest = sha256_bytes(original)

    ports.provision_port(vault, constants.ROLE_A)
    # The port really is readable in the provisioned state...
    provisioned = json.loads(settings_path.read_bytes().decode("utf-8-sig"))
    assert int(provisioned[constants.SETTINGS_PORT_KEY]) == constants.REAL_CONTROL_PORT_A

    ports.restore_port(vault)

    restored = settings_path.read_bytes()
    assert len(restored) == len(original), f"{label}: restored length differs"
    assert sha256_bytes(restored) == digest, f"{label}: restored sha256 differs"
    assert restored == original, f"{label}: restored bytes differ"


@pytest.mark.parametrize("label", sorted(FIXTURES))
def test_fixture_audit_a_json_round_trip_really_does_destroy_each_fixture(
    label: str,
) -> None:
    # If this ever fails, the fixture stopped being adversarial and the byte-exact
    # assertion above would be satisfiable by a naive parse-and-rewrite restore.
    original = FIXTURES[label]
    parsed = json.loads(original.decode("utf-8"))
    for kwargs in ({"indent": 2}, {}, {"indent": 2, "ensure_ascii": False}):
        assert json.dumps(parsed, **kwargs).encode("utf-8") != original, (
            f"{label}: a json round-trip reproduces these bytes — pick harder data"
        )


def test_a_second_full_cycle_still_returns_the_same_bytes(tmp_path: Path) -> None:
    # Borrowing the setting twice in a row must not accumulate drift.
    original = TAB_INDENTED_LF
    vault = make_vault(tmp_path, "vault-repeat", original)
    settings_path = vault / constants.PLUGIN_DATA_REL

    for _ in range(3):
        ports.provision_port(vault, constants.ROLE_B)
        ports.restore_port(vault)
        assert settings_path.read_bytes() == original
