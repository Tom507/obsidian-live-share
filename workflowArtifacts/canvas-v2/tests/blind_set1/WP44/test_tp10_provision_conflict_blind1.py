# WP44 / AC3 (blind 1) — the conflict boundary: what is a conflict and what is not.
#
# Angle: the visible set enumerates broken states. A test suite that only ever
# says "refuse" would also pass for an implementation that refuses everything, so
# this file pairs each refusal with the neighbouring state that must NOT be
# refused. The discriminator under test is "the marker and the backup agree",
# nothing else.

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

ORIGINAL = b'{\n  "serverPassword": "FAKE-PW-BLIND1-1010",\n  "roomId": "blind-room"\n}\n'
DIFFERENT = b'{\n  "roomId": "not-the-original"\n}\n'


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def marker_bytes(**over) -> bytes:
    base = {
        "runId": "20260101T000000Z-9999-c0ffee",
        "role": constants.ROLE_B,
        "port": constants.REAL_CONTROL_PORT_B,
        "hadOriginal": True,
        "originalSha256": sha(ORIGINAL),
        "pid": 9999,
        "createdAt": "2026-01-01T00:00:00+00:00",
    }
    base.update(over)
    return json.dumps(base, indent=2).encode("utf-8")


def build(tmp_path: Path, name: str, *, data=None, backup=None, marker=None) -> Path:
    vault = tmp_path / name
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    for rel, blob in (
        (constants.PLUGIN_DATA_REL, data),
        (constants.SETTINGS_BACKUP_REL, backup),
        (constants.PROVISION_MARKER_REL, marker),
    ):
        if blob is not None:
            (vault / rel).write_bytes(blob)
    return vault


def tree(vault: Path) -> dict[str, str]:
    return {
        p.relative_to(vault).as_posix(): sha(p.read_bytes())
        for p in sorted(vault.rglob("*"))
        if p.is_file()
    }


REFUSED = {
    "backup_is_not_the_recorded_original": dict(
        data=ORIGINAL, backup=DIFFERENT, marker=marker_bytes()
    ),
    "marker_promises_a_backup_that_is_gone": dict(data=ORIGINAL, marker=marker_bytes()),
    "marker_denies_an_original_that_exists": dict(
        data=ORIGINAL,
        backup=ORIGINAL,
        marker=marker_bytes(hadOriginal=False, originalSha256=None),
    ),
    "marker_is_not_json": dict(data=ORIGINAL, backup=ORIGINAL, marker=b"<<<broken>>>"),
    "marker_is_empty": dict(data=ORIGINAL, backup=ORIGINAL, marker=b""),
    "backup_with_no_marker_at_all": dict(data=ORIGINAL, backup=DIFFERENT),
}

ACCEPTED = {
    # consistent crashed state, original present
    "crashed_with_original": dict(data=DIFFERENT, backup=ORIGINAL, marker=marker_bytes()),
    # consistent crashed state, there never was an original
    "crashed_without_original": dict(
        data=DIFFERENT, marker=marker_bytes(hadOriginal=False, originalSha256=None)
    ),
    # a clean vault
    "clean_vault": dict(data=ORIGINAL),
    # a clean vault that has never had settings
    "clean_empty_vault": dict(),
}


@pytest.mark.parametrize("label", sorted(REFUSED))
def test_contradictory_leftovers_are_refused_without_a_single_write(
    tmp_path: Path, label: str
) -> None:
    vault = build(tmp_path, f"v-{label}", **REFUSED[label])
    before = tree(vault)

    with pytest.raises(Exception) as excinfo:
        ports.provision_port(vault, constants.ROLE_A)

    assert getattr(excinfo.value, "reason", None) == constants.PROVISION_CONFLICT, label
    assert tree(vault) == before, f"{label}: the refusal wrote something"


@pytest.mark.parametrize("label", sorted(ACCEPTED))
def test_consistent_states_are_not_refused(tmp_path: Path, label: str) -> None:
    vault = build(tmp_path, f"v-ok-{label}", **ACCEPTED[label])

    record = ports.provision_port(vault, constants.ROLE_A)

    assert record.port == constants.REAL_CONTROL_PORT_A
    live = json.loads((vault / constants.PLUGIN_DATA_REL).read_bytes().decode("utf-8"))
    assert int(live[constants.SETTINGS_PORT_KEY]) == constants.REAL_CONTROL_PORT_A


def test_a_refused_vault_can_still_be_repaired_by_hand(tmp_path: Path) -> None:
    vault = build(tmp_path, "v-repair", **REFUSED["backup_is_not_the_recorded_original"])
    with pytest.raises(Exception):
        ports.provision_port(vault, constants.ROLE_A)

    # the operator decides the backup is the truth and fixes the fingerprint
    marker_path = vault / constants.PROVISION_MARKER_REL
    marker_path.write_bytes(marker_bytes(originalSha256=sha(DIFFERENT)))

    record = ports.provision_port(vault, constants.ROLE_A)
    assert record.had_original is True
    ports.restore_port(vault)
    assert (vault / constants.PLUGIN_DATA_REL).read_bytes() == DIFFERENT
