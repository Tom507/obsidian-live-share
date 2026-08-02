# WP44 / AC2 (blind 2) — restore is a byte pipe, not a JSON pipe.
#
# Angle: the previous sets plant exotic content as the LIVE settings file, which
# the provisioning step has to parse. Here the exotic bytes are planted as the
# saved original of a crashed run, so the restore path meets them alone. That
# isolates the claim: whatever a previous run captured comes back exactly, even
# when it is something no JSON writer would emit — a byte-order mark, a lone CR,
# a file that is not valid JSON at all, or a zero-length file.

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

PROVISIONED_LIVE = json.dumps(
    {"roomId": "blind-room", constants.SETTINGS_PORT_KEY: constants.REAL_CONTROL_PORT_A},
    indent=2,
).encode("utf-8")

ORIGINALS = {
    "utf8_bom": b"\xef\xbb\xbf" + b'{\n  "roomId": "mit BOM"\n}\n',
    "lone_cr": b'{\r  "roomId": "old mac line endings"\r}\r',
    "mixed_line_endings": b'{\n  "a": 1,\r\n  "b": 2\r}\n',
    "not_json_at_all": b"this file was corrupt before the rig ever saw it\n",
    "empty_file": b"",
    "single_newline": b"\n",
    "trailing_nulls_free_binaryish": bytes(range(0x20, 0x7F)) * 3,
    "very_long_line": b'{"k":"' + b"z" * 50_000 + b'"}',
}


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def crashed_vault(tmp_path: Path, name: str, original: bytes) -> Path:
    """A vault a previous run left mid-borrow, with `original` as the saved file."""
    vault = tmp_path / name
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(PROVISIONED_LIVE)
    (vault / constants.SETTINGS_BACKUP_REL).write_bytes(original)
    (vault / constants.PROVISION_MARKER_REL).write_bytes(
        json.dumps(
            {
                "runId": "20260101T000000Z-777-abc123",
                "role": constants.ROLE_A,
                "port": constants.REAL_CONTROL_PORT_A,
                "hadOriginal": True,
                "originalSha256": sha(original),
                "pid": 777,
                "createdAt": "2026-01-01T00:00:00+00:00",
            },
            indent=2,
        ).encode("utf-8")
    )
    return vault


@pytest.mark.parametrize("label", sorted(ORIGINALS))
def test_whatever_was_captured_comes_back_exactly(tmp_path: Path, label: str) -> None:
    original = ORIGINALS[label]
    vault = crashed_vault(tmp_path, f"v-{label}", original)
    settings_path = vault / constants.PLUGIN_DATA_REL

    result = ports.restore_port(vault)

    restored = settings_path.read_bytes()
    assert result.restored is True
    assert len(restored) == len(original), label
    assert sha(restored) == sha(original), label
    assert restored == original, label
    assert not (vault / constants.SETTINGS_BACKUP_REL).exists()
    assert not (vault / constants.PROVISION_MARKER_REL).exists()


@pytest.mark.parametrize("label", ["utf8_bom", "lone_cr", "mixed_line_endings"])
def test_a_recovery_provisioning_before_the_restore_changes_nothing(
    tmp_path: Path, label: str
) -> None:
    # The next run provisions first and tears down afterwards; the saved original
    # must pass through both steps untouched.
    original = ORIGINALS[label]
    vault = crashed_vault(tmp_path, f"v-recover-{label}", original)

    ports.provision_port(vault, constants.ROLE_B)
    assert (vault / constants.SETTINGS_BACKUP_REL).read_bytes() == original

    ports.restore_port(vault)
    assert (vault / constants.PLUGIN_DATA_REL).read_bytes() == original


def test_the_corpus_is_genuinely_not_json_writer_output() -> None:
    # Audit: none of these could be produced by dumping and re-serialising.
    for label, blob in ORIGINALS.items():
        try:
            parsed = json.loads(blob.decode("utf-8"))
        except Exception:
            continue  # not parseable at all — trivially unreachable by a round-trip
        for kwargs in ({}, {"indent": 2}, {"indent": "\t"}):
            assert json.dumps(parsed, **kwargs).encode("utf-8") != blob, label
