# WP44 / AC3 (blind 2) — the conflict must be raised BEFORE anything is borrowed.
#
# Angle: the previous sets assert that a refused provisioning leaves the files
# unchanged. This one asserts the ordering that makes that possible: the check
# happens first, so a conflict never produces a marker, never produces a backup,
# and — the case that matters — never leaves the live settings file carrying the
# rig's port with no record of how to undo it.

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

OWNER_FILE = b'{\n  "roomId": "owner",\n  "serverPassword": "FAKE-PW-BLIND2-1010"\n}\n'
SOMETHING_ELSE = b'{\n  "roomId": "somebody elses backup"\n}\n'


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def marker(**over) -> bytes:
    base = {
        "runId": "20260101T000000Z-11-aabbcc",
        "role": constants.ROLE_A,
        "port": constants.REAL_CONTROL_PORT_A,
        "hadOriginal": True,
        "originalSha256": sha(OWNER_FILE),
        "pid": 11,
        "createdAt": "2026-01-01T00:00:00+00:00",
    }
    base.update(over)
    return json.dumps(base, indent=2).encode("utf-8")


CONFLICTS = {
    "backup_is_someone_elses": dict(
        data=OWNER_FILE, backup=SOMETHING_ELSE, marker=marker()
    ),
    "marker_without_its_backup": dict(data=OWNER_FILE, marker=marker()),
    "backup_without_its_marker": dict(data=OWNER_FILE, backup=OWNER_FILE),
    "marker_denies_the_backup": dict(
        data=OWNER_FILE,
        backup=OWNER_FILE,
        marker=marker(hadOriginal=False, originalSha256=None),
    ),
    "marker_is_a_json_array": dict(data=OWNER_FILE, backup=OWNER_FILE, marker=b"[1, 2, 3]"),
    "marker_is_truncated_json": dict(
        data=OWNER_FILE, backup=OWNER_FILE, marker=marker()[: len(marker()) // 2]
    ),
    "no_live_file_but_a_backup": dict(backup=OWNER_FILE),
}


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


@pytest.mark.parametrize("label", sorted(CONFLICTS))
def test_the_refusal_happens_before_the_borrow(tmp_path: Path, label: str) -> None:
    spec = CONFLICTS[label]
    vault = build(tmp_path, f"v-{label}", **spec)
    files_before = {
        p.relative_to(vault).as_posix(): sha(p.read_bytes())
        for p in sorted(vault.rglob("*"))
        if p.is_file()
    }

    with pytest.raises(Exception) as excinfo:
        ports.provision_port(vault, constants.ROLE_B)

    assert getattr(excinfo.value, "reason", None) == constants.PROVISION_CONFLICT, label

    files_after = {
        p.relative_to(vault).as_posix(): sha(p.read_bytes())
        for p in sorted(vault.rglob("*"))
        if p.is_file()
    }
    assert files_after == files_before, label

    # specifically: the live file never gained the port
    live = vault / constants.PLUGIN_DATA_REL
    if live.is_file():
        assert constants.SETTINGS_PORT_KEY not in live.read_bytes().decode("utf-8")


@pytest.mark.parametrize("label", sorted(CONFLICTS))
def test_a_conflict_never_deletes_anything(tmp_path: Path, label: str) -> None:
    vault = build(tmp_path, f"v-del-{label}", **CONFLICTS[label])
    names_before = {p.relative_to(vault).as_posix() for p in vault.rglob("*") if p.is_file()}

    with pytest.raises(Exception):
        ports.provision_port(vault, constants.ROLE_A)

    names_after = {p.relative_to(vault).as_posix() for p in vault.rglob("*") if p.is_file()}
    assert names_after == names_before, label


def test_the_conflict_is_stable_and_does_not_degrade_on_retry(tmp_path: Path) -> None:
    vault = build(tmp_path, "v-retry", **CONFLICTS["backup_is_someone_elses"])

    reasons = []
    for _ in range(3):
        with pytest.raises(Exception) as excinfo:
            ports.provision_port(vault, constants.ROLE_A)
        reasons.append(getattr(excinfo.value, "reason", None))

    assert reasons == [constants.PROVISION_CONFLICT] * 3
    assert (vault / constants.PLUGIN_DATA_REL).read_bytes() == OWNER_FILE
    assert (vault / constants.SETTINGS_BACKUP_REL).read_bytes() == SOMETHING_ELSE
