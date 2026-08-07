# WP44 / AC2 · S4 (blind 1) — the fingerprint is a fingerprint on every path.
#
# Angle: the visible set inspects the marker after a successful provisioning.
# Here the search area is the whole temporary tree (a rig that writes a "safety
# copy" outside the vault is exactly the failure S4 forbids), and the paths under
# inspection are the ones people forget: the refusal paths, and the record
# returned to the caller after a crash-recovery provisioning.

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

SECRETS = (
    "FAKE-PW-BLIND1-7777-aaaaaaaaaaaa",
    "FAKE-TOKEN-BLIND1-7777-bbbbbbbb",
    "FAKE-JWT-BLIND1-7777-cccccccccc",
)
ORIGINAL = json.dumps(
    {
        "serverUrl": "wss://example.invalid/ws-mux/",
        "serverPassword": SECRETS[0],
        "token": SECRETS[1],
        "jwt": SECRETS[2],
    },
    indent=2,
).encode("utf-8")


def make_vault(tmp_path: Path, name: str = "v") -> Path:
    vault = tmp_path / name
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(ORIGINAL)
    return vault


def files_holding_a_secret(root: Path) -> list[str]:
    hits = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        blob = path.read_bytes()
        if any(secret.encode("utf-8") in blob for secret in SECRETS):
            hits.append(path.relative_to(root).as_posix())
    return hits


def test_only_data_json_and_its_backup_ever_hold_the_values(tmp_path: Path) -> None:
    vault = make_vault(tmp_path)

    ports.provision_port(vault, constants.ROLE_A)

    assert sorted(files_holding_a_secret(tmp_path)) == sorted(
        [
            f"{vault.name}/{constants.PLUGIN_DATA_REL}",
            f"{vault.name}/{constants.SETTINGS_BACKUP_REL}",
        ]
    )


def test_after_teardown_only_the_owners_own_file_holds_them(tmp_path: Path) -> None:
    vault = make_vault(tmp_path)

    ports.provision_port(vault, constants.ROLE_A)
    ports.restore_port(vault)

    assert files_holding_a_secret(tmp_path) == [f"{vault.name}/{constants.PLUGIN_DATA_REL}"]


def test_the_marker_is_a_fingerprint_sized_file(tmp_path: Path) -> None:
    vault = make_vault(tmp_path)

    ports.provision_port(vault, constants.ROLE_B)

    marker_bytes = (vault / constants.PROVISION_MARKER_REL).read_bytes()
    marker = json.loads(marker_bytes.decode("utf-8"))
    assert set(marker) == {
        "runId",
        "role",
        "port",
        "hadOriginal",
        "originalSha256",
        "pid",
        "createdAt",
    }
    assert marker["originalSha256"] == hashlib.sha256(ORIGINAL).hexdigest()
    assert len(marker_bytes) < 1024, "a marker this large is carrying something it should not"


def test_the_refusal_paths_carry_no_values_either(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "v-refuse")
    (vault / constants.SETTINGS_BACKUP_REL).write_bytes(ORIGINAL)  # backup, no marker

    with pytest.raises(Exception) as excinfo:
        ports.provision_port(vault, constants.ROLE_A)
    assert getattr(excinfo.value, "reason", None) == constants.PROVISION_CONFLICT
    for secret in SECRETS:
        assert secret not in f"{excinfo.value!r} {excinfo.value}"

    vault2 = make_vault(tmp_path, "v-refuse-2")
    record = ports.provision_port(vault2, constants.ROLE_A)
    for secret in SECRETS:
        assert secret not in f"{record!r} {record}"
    (vault2 / constants.SETTINGS_BACKUP_REL).write_bytes(b"damaged")
    with pytest.raises(Exception) as excinfo2:
        ports.restore_port(vault2)
    for secret in SECRETS:
        assert secret not in f"{excinfo2.value!r} {excinfo2.value}"
