# WP44 / AC2 (blind 2) — the mismatch that is one byte wide.
#
# Angle: the previous sets damage the backup or the fingerprint conspicuously.
# A verification built on lengths, prefixes or "looks like the same JSON" passes
# all of those and still fails here: each damaged backup differs from the captured
# original in exactly one byte, or only in whitespace, or only in key order —
# same length, same values, same everything a lazy check would compare.

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

ORIGINAL = b'{\n  "roomId": "blind-room",\n  "serverPassword": "FAKE-PW-BLIND2-6666"\n}\n'


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def one_byte_changed(blob: bytes, index: int) -> bytes:
    out = bytearray(blob)
    out[index] = out[index] ^ 0x01
    return bytes(out)


DAMAGE = {
    "first_byte": one_byte_changed(ORIGINAL, 0),
    "middle_byte": one_byte_changed(ORIGINAL, len(ORIGINAL) // 2),
    "last_byte": one_byte_changed(ORIGINAL, len(ORIGINAL) - 1),
    "whitespace_only": ORIGINAL.replace(b"\n  ", b"\n   "),
    "key_order_only": b'{\n  "serverPassword": "FAKE-PW-BLIND2-6666",\n  "roomId": "blind-room"\n}\n',
    "trailing_newline_dropped": ORIGINAL.rstrip(b"\n"),
}


def crashed_vault(tmp_path: Path, name: str, backup: bytes) -> Path:
    vault = tmp_path / name
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(
        json.dumps({constants.SETTINGS_PORT_KEY: constants.REAL_CONTROL_PORT_A}, indent=2).encode()
    )
    (vault / constants.SETTINGS_BACKUP_REL).write_bytes(backup)
    (vault / constants.PROVISION_MARKER_REL).write_bytes(
        json.dumps(
            {
                "runId": "20260101T000000Z-55-ffee00",
                "role": constants.ROLE_A,
                "port": constants.REAL_CONTROL_PORT_A,
                "hadOriginal": True,
                "originalSha256": sha(ORIGINAL),
                "pid": 55,
                "createdAt": "2026-01-01T00:00:00+00:00",
            },
            indent=2,
        ).encode("utf-8")
    )
    return vault


@pytest.mark.parametrize("label", sorted(DAMAGE))
def test_a_backup_that_differs_at_all_is_refused(tmp_path: Path, label: str) -> None:
    damaged = DAMAGE[label]
    assert damaged != ORIGINAL, label
    vault = crashed_vault(tmp_path, f"v-{label}", damaged)
    live_before = (vault / constants.PLUGIN_DATA_REL).read_bytes()

    with pytest.raises(Exception) as excinfo:
        ports.restore_port(vault)

    assert getattr(excinfo.value, "reason", None) == constants.SETTINGS_RESTORE_MISMATCH, label
    assert (vault / constants.PLUGIN_DATA_REL).read_bytes() == live_before, label
    assert (vault / constants.SETTINGS_BACKUP_REL).read_bytes() == damaged, label


def test_the_undamaged_backup_of_the_same_shape_restores(tmp_path: Path) -> None:
    vault = crashed_vault(tmp_path, "v-clean", ORIGINAL)

    result = ports.restore_port(vault)

    assert result.restored is True
    assert (vault / constants.PLUGIN_DATA_REL).read_bytes() == ORIGINAL


def test_same_length_damage_is_not_excused(tmp_path: Path) -> None:
    # Explicitly: the byte counts are equal, so only a content hash can tell.
    for label in ("first_byte", "middle_byte", "last_byte", "key_order_only"):
        assert len(DAMAGE[label]) == len(ORIGINAL), label
        vault = crashed_vault(tmp_path, f"v-len-{label}", DAMAGE[label])
        with pytest.raises(Exception) as excinfo:
            ports.restore_port(vault)
        assert getattr(excinfo.value, "reason", None) == constants.SETTINGS_RESTORE_MISMATCH
