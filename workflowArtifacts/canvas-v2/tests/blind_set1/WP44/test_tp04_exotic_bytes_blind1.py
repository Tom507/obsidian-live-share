# WP44 / AC2 (blind 1) — the formatting matrix, generated rather than handpicked.
#
# Angle: the visible set uses a handful of curated adversarial files. Here the
# same JSON object is rendered in every combination of indent style, line ending
# and trailing-newline policy — 24 files — plus two shapes a curated list tends to
# miss: a file large enough that a partial write would go unnoticed, and one whose
# strings contain the escape sequences a re-serialiser loves to normalise.

from __future__ import annotations

import hashlib
import itertools
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

PAYLOAD = {
    "serverUrl": "wss://example.invalid/ws-mux/",
    "serverPassword": "FAKE-PW-BLIND1-4444",
    "roomId": "blind-room",
    "nested": {"a": [1, 2, 3], "b": None},
}

INDENTS = {"tab": "\t", "two": "  ", "four": "    ", "none": None}
NEWLINES = {"lf": b"\n", "crlf": b"\r\n"}
TRAILING = {"trailing": True, "no_trailing": False}


def render(indent: str | None, newline: bytes, trailing: bool) -> bytes:
    text = json.dumps(PAYLOAD, indent=indent) if indent else json.dumps(PAYLOAD)
    blob = text.encode("utf-8").replace(b"\n", newline)
    if trailing:
        blob += newline
    return blob


MATRIX = {
    f"{i}_{n}_{t}": render(INDENTS[i], NEWLINES[n], TRAILING[t])
    for i, n, t in itertools.product(INDENTS, NEWLINES, TRAILING)
}

ESCAPE_HEAVY = (
    b'{\n'
    b'  "note": "line1\\nline2\\ttabbed \\"quoted\\" back\\\\slash \\/slash",\n'
    b'  "unicode": "\\u00e4\\u00f6\\u00fc \\ud83d\\ude00",\n'
    b'  "serverPassword": "FAKE-PW-BLIND1-4444"\n'
    b'}\n'
)

LARGE = (
    b'{\n  "serverPassword": "FAKE-PW-BLIND1-4444",\n  "bulk": [\n'
    + b",\n".join(b'    "%s"' % (b"x" * 64) for _ in range(2000))
    + b'\n  ]\n}\n'
)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def cycle(tmp_path: Path, name: str, original: bytes) -> bytes:
    vault = tmp_path / name
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    settings_path = vault / constants.PLUGIN_DATA_REL
    settings_path.write_bytes(original)
    ports.provision_port(vault, constants.ROLE_A)
    ports.restore_port(vault)
    return settings_path.read_bytes()


@pytest.mark.parametrize("label", sorted(MATRIX))
def test_every_formatting_combination_returns_unchanged(tmp_path: Path, label: str) -> None:
    original = MATRIX[label]
    restored = cycle(tmp_path, f"v-{label}", original)
    assert len(restored) == len(original), label
    assert sha(restored) == sha(original), label
    assert restored == original, label


def test_escape_sequences_are_not_normalised(tmp_path: Path) -> None:
    restored = cycle(tmp_path, "v-escapes", ESCAPE_HEAVY)
    assert restored == ESCAPE_HEAVY
    # the raw escape text, not its decoded form, is what came back
    assert b"\\u00e4" in restored
    assert b"\\/slash" in restored


def test_a_large_file_returns_in_full(tmp_path: Path) -> None:
    restored = cycle(tmp_path, "v-large", LARGE)
    assert len(restored) == len(LARGE)
    assert sha(restored) == sha(LARGE)


def test_matrix_audit_every_generated_file_is_adversarial_for_at_least_one_dump() -> None:
    # At least the CRLF and the trailing-newline dimensions must be lost by any
    # plain json round-trip; assert it so the matrix cannot silently go soft.
    for label, blob in MATRIX.items():
        parts = label.split("_")
        indent_key, newline_key, trailing_key = parts[0], parts[1], "_".join(parts[2:])
        if trailing_key == "no_trailing" and (newline_key == "lf" or indent_key == "none"):
            # These ARE json.dumps' own output shape (a one-line dump has no line
            # ending to differ in) — kept in the matrix as the trivial cases,
            # excluded from the adversarial audit.
            continue
        parsed = json.loads(blob.decode("utf-8"))
        naive = {
            json.dumps(parsed, indent=indent).encode("utf-8") if indent else
            json.dumps(parsed).encode("utf-8")
            for indent in (None, "\t", "  ", "    ")
        }
        assert blob not in naive, f"{label} is reproducible by a naive round-trip"
