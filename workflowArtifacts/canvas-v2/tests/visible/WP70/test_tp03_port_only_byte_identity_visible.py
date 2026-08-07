# WP70 / AC1 — "Provisioning the port alone still produces byte-identical output to the
# pre-change implementation."
#
# This is the sharpest assertion in the work package, so the comparand is built the only
# way that can actually fail: a FROZEN COPY of the pre-change `_with_port` splice is
# embedded below, verbatim from `ports.py` at batch baseline `fd7de1f`. Calling the new
# code twice and comparing it to itself would pass for any implementation, including a
# broken one; this compares the new generalised member-set splice against the exact text
# transformation the old one performed.
#
#   ├── T1 for every exotic input, port-only provisioning == frozen `_with_port` output
#   ├── T2 the frozen comparand is genuinely exercised (it differs from the input)
#   ├── T3 the corpus is genuinely adversarial: a json round-trip destroys each fixture
#   ├── T4 the "no settings file at all" case matches the frozen fresh-document form
#   └── T5 the member-set path with a one-member set is the same splice as the port path
#
# DATA SAFETY: fixture vaults under tmp_path, guarded against both owner vaults. All
# credential values are synthetic sentinels.

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Optional

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


# ---------------------------------------------------------------------------
# The exotic corpus. Every entry is raw bytes: the SHAPE of the file is the test data.
# ---------------------------------------------------------------------------

CORPUS = {
    "tabs_lf": (
        b"{\n"
        b'\t"serverUrl": "http://localhost:3000",\n'
        b'\t"serverPassword": "SENTINEL-SERVERPW-c0ffee-DO-NOT-LEAK"\n'
        b"}\n"
    ),
    "crlf_no_trailing_newline": (
        b"{\r\n"
        b'  "roomId": "",\r\n'
        b'  "clientId": "fixture-client"\r\n'
        b"}"
    ),
    "bom_utf8": b"\xef\xbb\xbf" + b'{\n  "clientId": "fixture-client"\n}\n',
    "unicode_escapes": (
        b"{\n"
        b'  "vaultLabel": "Ordner\\u00fcbersicht \\u2014 \\u00fcn\\u00efc\\u00f8d\\u00e9",\n'
        b'  "note": "\\ud83d\\ude00"\n'
        b"}\n"
    ),
    "raw_non_ascii": '{\n  "vaultLabel": "Ordnerübersicht — 日本語"\n}\n'.encode("utf-8"),
    "key_already_present": b'{\n  "e2eControlPort": 1,\n  "clientId": "fixture-client"\n}\n',
    "key_already_present_string": b'{\n  "e2eControlPort": "1",\n  "other": true\n}\n',
    "empty_object": b"{}",
    "empty_object_padded": b"  {   }  \n",
    "minified_nested": b'{"a":[1,2,{"b":null}],"c":{"d":[true,false]}}',
    "leading_blank_lines": b"\n\n{\n  \"x\": 1\n}\n",
    "number_formats": b'{\n  "reconnectDelay": 1e3,\n  "ratio": 1.50,\n  "zeroish": 0.0\n}\n',
    "trailing_blank_lines": b'{\n  "x": 1\n}\n\n\n',
}

NO_FILE = "__no_settings_file_at_all__"


def assert_synthetic(path: Path) -> Path:
    resolved = Path(path).resolve()
    for owner in OWNER_VAULTS:
        owner_resolved = Path(owner).resolve()
        assert resolved != owner_resolved, f"ABORT: {resolved} is an owner vault"
        assert owner_resolved not in resolved.parents, f"ABORT: {resolved} is inside an owner vault"
        assert resolved not in owner_resolved.parents, f"ABORT: {resolved} contains an owner vault"
    return resolved


def make_vault(tmp_path: Path, name: str, data_json: Optional[bytes]) -> Path:
    vault = assert_synthetic(tmp_path / name)
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    if data_json is not None:
        (vault / constants.PLUGIN_DATA_REL).write_bytes(data_json)
    return vault


@pytest.mark.parametrize("label", sorted(CORPUS))
def test_port_only_provisioning_is_byte_identical_to_the_frozen_implementation(
    tmp_path: Path, label: str
) -> None:
    original = CORPUS[label]
    vault = make_vault(tmp_path, f"vault-{label}", original)

    ports.provision_port(vault, constants.ROLE_A)

    produced = (vault / constants.PLUGIN_DATA_REL).read_bytes()
    expected = frozen_with_port(original, constants.REAL_CONTROL_PORT_A)
    assert produced == expected, f"{label}: the generalised splice changed the port-only bytes"


def test_the_no_settings_file_case_matches_the_frozen_fresh_document(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-absent", None)
    assert not (vault / constants.PLUGIN_DATA_REL).exists()

    ports.provision_port(vault, constants.ROLE_B)

    produced = (vault / constants.PLUGIN_DATA_REL).read_bytes()
    assert produced == frozen_with_port(None, constants.REAL_CONTROL_PORT_B)


@pytest.mark.parametrize("label", sorted(CORPUS))
def test_the_frozen_comparand_is_genuinely_exercised(label: str) -> None:
    # Guards against a comparand that silently returns its input: if the frozen splice
    # ever became an identity function, T1 would pass for a do-nothing implementation.
    original = CORPUS[label]
    spliced = frozen_with_port(original, constants.REAL_CONTROL_PORT_A)
    assert spliced != original
    assert constants.SETTINGS_PORT_KEY.encode("utf-8") in spliced


# `{}` is the ONE corpus entry a naive parse-and-rewrite reproduces exactly
# (`json.dumps({}) == "{}"`), so it cannot carry the adversarial property this audit
# measures. It is named here rather than silently dropped, and it stays in CORPUS: the
# byte-identity requirement of T1 applies to it like every other entry, and
# `empty_object_padded` (`b"  {   }  \n"`) covers the same shape adversarially.
_ROUND_TRIP_DEGENERATE = {"empty_object"}


@pytest.mark.parametrize("label", sorted(set(CORPUS) - _ROUND_TRIP_DEGENERATE))
def test_fixture_audit_a_json_round_trip_destroys_each_corpus_entry(label: str) -> None:
    # If a fixture stops being adversarial, T1 becomes satisfiable by a naive
    # parse-and-rewrite splice, which is exactly what AC1 forbids.
    original = CORPUS[label]
    parsed = json.loads(original.decode("utf-8-sig"))
    reproduced = [
        json.dumps(parsed, **kwargs).encode("utf-8")
        for kwargs in ({"indent": 2}, {}, {"indent": 2, "ensure_ascii": False})
    ]
    assert original not in reproduced, f"{label}: a json round-trip reproduces these bytes"


def test_the_member_set_path_with_a_single_member_is_the_same_splice(tmp_path: Path) -> None:
    # The generalisation is "one added keyword argument". Passing the port as a
    # one-member set must therefore land the identical bytes as passing no set at all.
    original = CORPUS["tabs_lf"]
    a = make_vault(tmp_path, "vault-implicit", original)
    b = make_vault(tmp_path, "vault-explicit", original)

    ports.provision_port(a, constants.ROLE_A)
    ports.provision_port(
        b,
        constants.ROLE_A,
        members={constants.SETTINGS_PORT_KEY: constants.REAL_CONTROL_PORT_A},
    )

    produced_a = (a / constants.PLUGIN_DATA_REL).read_bytes()
    produced_b = (b / constants.PLUGIN_DATA_REL).read_bytes()
    assert produced_a == produced_b
    assert produced_a == frozen_with_port(original, constants.REAL_CONTROL_PORT_A)
