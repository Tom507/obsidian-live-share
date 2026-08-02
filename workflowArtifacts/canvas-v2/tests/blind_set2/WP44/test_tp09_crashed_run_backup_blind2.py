# WP44 / AC3 (blind 2) — crash recovery where the crashed state is itself exotic.
#
# Angle: the previous sets recover a crashed run whose original was ordinary JSON.
# The interesting failure is the combination: a crashed run PLUS an original whose
# formatting a re-serialiser would destroy. An implementation that recovers by
# "re-deriving" the original from the live file — dropping the port key and
# writing the rest back — passes an ordinary recovery test and destroys this one.

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

ORIGINALS = {
    "tabs_crlf": b'{\r\n\t"roomId": "krise",\r\n\t"serverPassword": "FAKE-PW-BLIND2-9999"\r\n}\r\n',
    "no_trailing_newline": b'{"roomId":"krise","serverPassword":"FAKE-PW-BLIND2-9999"}',
    "unicode_raw": '{\n  "label": "Übersicht — 日本語",\n  "serverPassword": "FAKE-PW-BLIND2-9999"\n}\n'.encode(
        "utf-8"
    ),
    "escaped_unicode": b'{\n  "label": "\\u00dcbersicht",\n  "serverPassword": "FAKE-PW-BLIND2-9999"\n}\n',
}


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def crashed(tmp_path: Path, name: str, original: bytes) -> Path:
    """A vault mid-borrow: live file provisioned, backup + marker from run 1."""
    vault = tmp_path / name
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    live = json.loads(original.decode("utf-8"))
    live[constants.SETTINGS_PORT_KEY] = constants.REAL_CONTROL_PORT_A
    (vault / constants.PLUGIN_DATA_REL).write_bytes(
        json.dumps(live, indent=2).encode("utf-8")
    )
    (vault / constants.SETTINGS_BACKUP_REL).write_bytes(original)
    (vault / constants.PROVISION_MARKER_REL).write_bytes(
        json.dumps(
            {
                "runId": "20260101T000000Z-808-dead99",
                "role": constants.ROLE_A,
                "port": constants.REAL_CONTROL_PORT_A,
                "hadOriginal": True,
                "originalSha256": sha(original),
                "pid": 808,
                "createdAt": "2026-01-01T00:00:00+00:00",
            },
            indent=2,
        ).encode("utf-8")
    )
    return vault


@pytest.mark.parametrize("label", sorted(ORIGINALS))
def test_recovery_restores_the_exotic_original_not_a_re_derived_one(
    tmp_path: Path, label: str
) -> None:
    original = ORIGINALS[label]
    vault = crashed(tmp_path, f"v-{label}", original)
    settings_path = vault / constants.PLUGIN_DATA_REL
    live_before = settings_path.read_bytes()

    ports.provision_port(vault, constants.ROLE_B)
    ports.restore_port(vault)

    restored = settings_path.read_bytes()
    assert restored == original, label
    assert sha(restored) == sha(original), label
    # the give-away for a re-derived restore: it would look like the live file
    # minus the port key, i.e. share the live file's formatting
    assert restored != live_before.replace(
        f'  "{constants.SETTINGS_PORT_KEY}": {constants.REAL_CONTROL_PORT_A}\n'.encode(), b""
    )


@pytest.mark.parametrize("label", sorted(ORIGINALS))
def test_the_recovery_run_leaves_the_saved_original_alone(
    tmp_path: Path, label: str
) -> None:
    original = ORIGINALS[label]
    vault = crashed(tmp_path, f"v-keep-{label}", original)

    record = ports.provision_port(vault, constants.ROLE_B)

    assert (vault / constants.SETTINGS_BACKUP_REL).read_bytes() == original
    assert record.original_sha256 == sha(original)
    assert record.had_original is True
    marker = json.loads((vault / constants.PROVISION_MARKER_REL).read_bytes().decode("utf-8"))
    assert marker["originalSha256"] == sha(original)


def test_two_crashes_in_a_row_still_recover_the_first_original(tmp_path: Path) -> None:
    original = ORIGINALS["tabs_crlf"]
    vault = crashed(tmp_path, "v-twice", original)

    ports.provision_port(vault, constants.ROLE_B)  # run 2, crashes too
    ports.provision_port(vault, constants.ROLE_A)  # run 3
    ports.restore_port(vault)

    assert (vault / constants.PLUGIN_DATA_REL).read_bytes() == original
    assert not (vault / constants.SETTINGS_BACKUP_REL).exists()
    assert not (vault / constants.PROVISION_MARKER_REL).exists()
