# WP70 / AC1 — blind counterpart 2 for "port-only provisioning is byte-identical to the
# pre-change `_with_port` implementation".
#
# Different data: every shape of the whitespace that follows the opening brace — the
# exact text `_with_port` reuses when inserting — plus replace-in-place and a 200-key file.
#
# The comparand is the same FROZEN copy of the pre-change `ports._with_port` (verbatim at
# batch baseline `fd7de1f`) — comparing the new code against itself would pass for any
# implementation at all.
#
# DATA SAFETY: synthetic fixture vaults under tmp_path, guarded against both owner vaults.

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Optional

import pytest

# --- repo bootstrap (T3_SharedContract 0.2) --------------------------------------
for _parent in Path(__file__).resolve().parents:
    if (_parent / "tools").is_dir() and (_parent / "plugin").is_dir():
        _TOOLS = _parent / "tools"
        break
else:  # pragma: no cover
    raise RuntimeError("obsidian-live-share repo root not found from " + __file__)
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, ports  # noqa: E402

OWNER_VAULTS = (
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga"),
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie"),
)


# ---------------------------------------------------------------------------
# FROZEN COMPARAND — the pre-change `ports._with_port` and its three helpers, copied
# verbatim at batch baseline `fd7de1f`. Do not "fix" or refactor this: its whole value
# is that it is a snapshot of the behaviour AC1 promises not to change.
# ---------------------------------------------------------------------------

_FROZEN_JSON_WS = " \t\r\n\ufeff"


class _FrozenMalformed(Exception):
    pass


def _frozen_read_json_string(text: str, start: int) -> tuple:
    index = start + 1
    length = len(text)
    while index < length:
        char = text[index]
        if char == "\\":
            index += 2
            continue
        if char == '"':
            return text[start : index + 1], index + 1
        index += 1
    raise _FrozenMalformed("unterminated string")


def _frozen_skip_value(text: str, start: int) -> int:
    char = text[start]
    if char == '"':
        _, end = _frozen_read_json_string(text, start)
        return end
    if char in "{[":
        depth = 0
        index = start
        length = len(text)
        while index < length:
            current = text[index]
            if current == '"':
                _, index = _frozen_read_json_string(text, index)
                continue
            if current in "{[":
                depth += 1
            elif current in "}]":
                depth -= 1
                if depth == 0:
                    return index + 1
            index += 1
        raise _FrozenMalformed("unterminated container")
    index = start
    length = len(text)
    while index < length and text[index] not in ",}] \t\r\n":
        index += 1
    if index == start:
        raise _FrozenMalformed("empty value")
    return index


def _frozen_top_level_members(text: str, open_index: int) -> tuple:
    members = []
    index = open_index + 1
    length = len(text)
    while index < length:
        char = text[index]
        if char in _FROZEN_JSON_WS:
            index += 1
            continue
        if char == "}":
            return members, index
        if char == ",":
            index += 1
            continue
        if char != '"':
            raise _FrozenMalformed("unexpected token in object")
        raw_key, index = _frozen_read_json_string(text, index)
        while index < length and text[index] in _FROZEN_JSON_WS:
            index += 1
        if index >= length or text[index] != ":":
            raise _FrozenMalformed("missing ':' after key")
        index += 1
        while index < length and text[index] in _FROZEN_JSON_WS:
            index += 1
        if index >= length:
            raise _FrozenMalformed("missing value")
        value_start = index
        value_end = _frozen_skip_value(text, value_start)
        try:
            key = json.loads(raw_key)
        except ValueError as err:
            raise _FrozenMalformed("undecodable key") from err
        members.append((key, value_start, value_end))
        index = value_end
    raise _FrozenMalformed("unterminated object")


def frozen_with_port(original: Optional[bytes], port: int) -> bytes:
    """The pre-change `ports._with_port`, verbatim."""
    key = constants.SETTINGS_PORT_KEY
    if original is None:
        return json.dumps({key: port}, indent=2).encode("utf-8") + b"\n"

    try:
        text = original.decode("utf-8")
    except UnicodeDecodeError as err:
        raise _FrozenMalformed("settings file is not valid UTF-8") from err

    index = 0
    while index < len(text) and text[index] in _FROZEN_JSON_WS:
        index += 1
    if index >= len(text) or text[index] != "{":
        raise _FrozenMalformed("settings file is not a JSON object")
    open_index = index

    members, _close_index = _frozen_top_level_members(text, open_index)
    literal = str(int(port))

    for member_key, value_start, value_end in members:
        if member_key == key:
            spliced = text[:value_start] + literal + text[value_end:]
            break
    else:
        lead_start = open_index + 1
        lead_end = lead_start
        while lead_end < len(text) and text[lead_end] in _FROZEN_JSON_WS:
            lead_end += 1
        lead_ws = text[lead_start:lead_end]
        separator = ": " if lead_ws else ":"
        member = f'{lead_ws}"{key}"{separator}{literal}'
        if members:
            member += ","
        spliced = text[:lead_start] + member + text[lead_start:]

    return spliced.encode("utf-8")



# The INSERTION WHITESPACE is the variable here: `_with_port` reuses whatever whitespace
# already follows the opening brace, so every shape of that whitespace is a distinct path.
CORPUS = {
    "no_whitespace_after_brace": b'{"a":1,"b":2}',
    "single_space_after_brace": b'{ "a": 1 }',
    "many_newlines_after_brace": b'{\n\n\n  "a": 1\n}\n',
    "tab_then_spaces_after_brace": b'{\t  "a": 1\n}\n',
    "crlf_after_brace": b'{\r\n\t"a": 1\r\n}',
    "whitespace_only_object": b'{\n   \n}\n',
    "whitespace_only_object_tabs": b'{\t\t}',
    "port_key_last_member": b'{\n  "a": 1,\n  "e2eControlPort": 65535\n}\n',
    "port_key_only_member": b'{"e2eControlPort":0}',
    "large_document": b'{\n'
    + b"".join(b'  "k%03d": "value %03d",\n' % (i, i) for i in range(200))
    + b'  "last": true\n}\n',
}


def assert_synthetic(path: Path) -> Path:
    resolved = Path(path).resolve()
    for owner in OWNER_VAULTS:
        owner_resolved = Path(owner).resolve()
        assert resolved != owner_resolved, "ABORT: fixture vault is an owner vault"
        assert owner_resolved not in resolved.parents, "ABORT: fixture vault is inside an owner vault"
        assert resolved not in owner_resolved.parents, "ABORT: fixture vault contains an owner vault"
    return resolved


def make_vault(tmp_path: Path, name: str, data_json: Optional[bytes]) -> Path:
    vault = assert_synthetic(tmp_path / name)
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    if data_json is not None:
        (vault / constants.PLUGIN_DATA_REL).write_bytes(data_json)
    return vault


@pytest.mark.parametrize("label", sorted(CORPUS))
def test_every_insertion_whitespace_shape_matches_the_frozen_implementation(
    tmp_path: Path, label: str
) -> None:
    original = CORPUS[label]
    vault = make_vault(tmp_path, "vault-" + label, original)
    ports.provision_port(vault, constants.ROLE_A)
    produced = (vault / constants.PLUGIN_DATA_REL).read_bytes()
    assert produced == frozen_with_port(original, constants.REAL_CONTROL_PORT_A)


@pytest.mark.parametrize("label", ["port_key_last_member", "port_key_only_member"])
def test_replacing_an_existing_port_value_matches_the_frozen_implementation(
    tmp_path: Path, label: str
) -> None:
    original = CORPUS[label]
    vault = make_vault(tmp_path, "replace-" + label, original)
    ports.provision_port(vault, constants.ROLE_B)
    produced = (vault / constants.PLUGIN_DATA_REL).read_bytes()
    assert produced == frozen_with_port(original, constants.REAL_CONTROL_PORT_B)
    assert produced.count(b'"e2eControlPort"') == 1


def test_an_absent_settings_file_matches_the_frozen_fresh_document(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-absent", None)
    ports.provision_port(vault, constants.ROLE_A)
    produced = (vault / constants.PLUGIN_DATA_REL).read_bytes()
    assert produced == frozen_with_port(None, constants.REAL_CONTROL_PORT_A)


@pytest.mark.parametrize("label", sorted(CORPUS))
def test_the_frozen_comparand_actually_transforms_each_entry(label: str) -> None:
    original = CORPUS[label]
    assert frozen_with_port(original, constants.REAL_CONTROL_PORT_A) != original
