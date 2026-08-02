# WP44 / AC2 · S4 (blind 2) — nothing about the settings content is inferable
# from what the rig leaves lying around.
#
# Angle: the previous sets search for the literal secret. A rig can leak without
# copying: a marker that records the file's size, a first line, a key list, or a
# "preview" is already more than a fingerprint. So this set compares the artefacts
# produced for two vaults whose settings differ ONLY in their secret values —
# everything the rig writes must be indistinguishable apart from the hash.

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

# T3_SharedContract import rule: `import tools.…` resolves to the WORKSPACE `tools`
# package (a regular package always beats a namespace portion), never to this repo's.
# Put <repo>/tools on sys.path and import by the globally unique package name.
_TOOLS = Path(__file__).resolve().parents[5] / "tools"
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, ports  # noqa: E402

SECRET_ONE = "FAKE-PW-BLIND2-AAAA-0000000000000000"
SECRET_TWO = "FAKE-PW-BLIND2-BBBB-1111111111111111"


def settings_blob(secret: str) -> bytes:
    return json.dumps(
        {"serverUrl": "wss://example.invalid/ws-mux/", "serverPassword": secret, "roomId": "r"},
        indent=2,
    ).encode("utf-8")


def make_vault(tmp_path: Path, name: str, secret: str) -> Path:
    vault = tmp_path / name
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(settings_blob(secret))
    return vault


def marker_of(vault: Path) -> dict:
    return json.loads((vault / constants.PROVISION_MARKER_REL).read_bytes().decode("utf-8"))


def test_two_vaults_differing_only_in_the_secret_produce_identical_markers(
    tmp_path: Path,
) -> None:
    vault_one = make_vault(tmp_path, "v-one", SECRET_ONE)
    vault_two = make_vault(tmp_path, "v-two", SECRET_TWO)
    assert len(settings_blob(SECRET_ONE)) == len(settings_blob(SECRET_TWO))

    ports.provision_port(vault_one, constants.ROLE_A, run_id="fixed-run-id")
    ports.provision_port(vault_two, constants.ROLE_A, run_id="fixed-run-id")

    one, two = marker_of(vault_one), marker_of(vault_two)
    assert set(one) == set(two)
    for key in set(one) - {"originalSha256", "createdAt"}:
        assert one[key] == two[key], f"marker field {key} differs between the two vaults"

    # the one field that may differ is the fingerprint, and it must BE the hash
    assert one["originalSha256"] == hashlib.sha256(settings_blob(SECRET_ONE)).hexdigest()
    assert two["originalSha256"] == hashlib.sha256(settings_blob(SECRET_TWO)).hexdigest()
    assert one["originalSha256"] != two["originalSha256"]


def test_the_marker_is_the_same_size_whatever_the_settings_are(tmp_path: Path) -> None:
    small = make_vault(tmp_path, "v-small", SECRET_ONE)
    big_vault = tmp_path / "v-big"
    (big_vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (big_vault / constants.PLUGIN_DATA_REL).write_bytes(
        json.dumps({"bulk": ["x" * 100] * 500, "serverPassword": SECRET_TWO}, indent=2).encode()
    )

    ports.provision_port(small, constants.ROLE_A, run_id="fixed-run-id")
    ports.provision_port(big_vault, constants.ROLE_A, run_id="fixed-run-id")

    small_marker = (small / constants.PROVISION_MARKER_REL).read_bytes()
    big_marker = (big_vault / constants.PROVISION_MARKER_REL).read_bytes()
    assert abs(len(small_marker) - len(big_marker)) <= 64, (
        "the marker grows with the settings file — it is carrying content"
    )


def test_no_artefact_outside_the_backup_contains_any_settings_substring(
    tmp_path: Path,
) -> None:
    vault = make_vault(tmp_path, "v-scan", SECRET_ONE)
    original = settings_blob(SECRET_ONE)

    ports.provision_port(vault, constants.ROLE_B)

    backup_path = (vault / constants.SETTINGS_BACKUP_REL).resolve()
    data_path = (vault / constants.PLUGIN_DATA_REL).resolve()
    # every 24-byte window of the original must be absent from every other file
    windows = [original[i : i + 24] for i in range(0, len(original) - 24, 8)]
    for path in tmp_path.rglob("*"):
        if not path.is_file() or path.resolve() in {backup_path, data_path}:
            continue
        blob = path.read_bytes()
        for window in windows:
            assert window not in blob, f"{path.name} contains a slice of the settings file"


def test_teardown_removes_every_trace(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "v-trace", SECRET_ONE)

    ports.provision_port(vault, constants.ROLE_A)
    ports.restore_port(vault)

    remaining = [p for p in vault.rglob("*") if p.is_file()]
    assert [p.name for p in remaining] == [Path(constants.PLUGIN_DATA_REL).name]
    assert (vault / constants.PLUGIN_DATA_REL).read_bytes() == settings_blob(SECRET_ONE)
