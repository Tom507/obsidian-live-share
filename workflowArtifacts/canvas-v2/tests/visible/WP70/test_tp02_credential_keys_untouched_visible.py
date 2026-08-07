# WP70 / AC1 — "`encryptionPassphrase`, `encryptionSalt`, `jwt`, `serverPassword`
# neither read nor written" (and S4/pinned-decisions §8: no value out of `data.json`,
# and no minted room token, ever reaches a record, a marker, a log or an exception).
#
# "Not written" is provable from the bytes. "Not read" is provable from the fact that
# no sentinel value ever surfaces anywhere the rig can be observed. Both are asserted,
# and the sentinels are chosen so a single leaked byte-range is findable by substring.
#
#   ├── T1 the four credential members survive the provisioning byte-for-byte
#   ├── T2 the whole file is byte-identical again after restore
#   ├── T3 no sentinel appears in the record's repr, fields or the marker file
#   ├── T4 no sentinel appears on stdout/stderr or in the logging stream
#   └── T5 no sentinel appears in the message of a refusal raised on that vault
#
# DATA SAFETY: synthetic fixture vault under tmp_path, guarded against both owner
# vaults. Every credential value is a synthetic sentinel; no real secret is used.

from __future__ import annotations

import hashlib
import logging
import sys
from pathlib import Path

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

from obsidian_e2e import constants, ports, provisioning, relay  # noqa: E402


def silent_control_probe(port: int) -> bool:
    """No Obsidian instance is running in a unit test — and none may be started."""
    return False

OWNER_VAULTS = (
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga"),
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie"),
)

SENTINELS = {
    "encryptionPassphrase": "SENTINEL-PASSPHRASE-c0ffee-DO-NOT-LEAK",
    "encryptionSalt": "SENTINEL-SALT-c0ffee-DO-NOT-LEAK",
    "jwt": "SENTINEL-JWT-c0ffee-DO-NOT-LEAK",
    "serverPassword": "SENTINEL-SERVERPW-c0ffee-DO-NOT-LEAK",
}
SENTINEL_ROOM_TOKEN = "SENTINEL-ROOM-TOKEN-c0ffee-DO-NOT-LEAK"
ALL_SENTINELS = (*SENTINELS.values(), SENTINEL_ROOM_TOKEN)

ORIGINAL = (
    "{\n"
    '  "clientId": "fixture-client",\n'
    f'  "encryptionPassphrase": "{SENTINELS["encryptionPassphrase"]}",\n'
    f'  "encryptionSalt": "{SENTINELS["encryptionSalt"]}",\n'
    f'  "jwt": "{SENTINELS["jwt"]}",\n'
    f'  "serverPassword": "{SENTINELS["serverPassword"]}"\n'
    "}\n"
).encode("utf-8")


def assert_synthetic(path: Path) -> Path:
    resolved = Path(path).resolve()
    for owner in OWNER_VAULTS:
        owner_resolved = Path(owner).resolve()
        assert resolved != owner_resolved, f"ABORT: {resolved} is an owner vault"
        assert owner_resolved not in resolved.parents, f"ABORT: {resolved} is inside an owner vault"
        assert resolved not in owner_resolved.parents, f"ABORT: {resolved} contains an owner vault"
    return resolved


def make_vault(tmp_path: Path, name: str, data_json: bytes) -> Path:
    vault = assert_synthetic(tmp_path / name)
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(data_json)
    return vault


def make_room() -> relay.RelayRoom:
    return relay.RelayRoom(
        id="11111111-2222-3333-4444-555555555555",
        token=SENTINEL_ROOM_TOKEN,
        name=f"{constants.RELAY_ROOM_NAME_PREFIX}20260804T000000Z-1-a1b2c3",
        base_url=constants.RELAY_BASE_URL,
    )


def assert_no_sentinel(text: str, where: str) -> None:
    for sentinel in ALL_SENTINELS:
        assert sentinel not in text, f"a credential sentinel leaked into {where}"

def test_the_four_credential_members_survive_provisioning_byte_for_byte(
    tmp_path: Path,
) -> None:
    vault = make_vault(tmp_path, "vault-creds", ORIGINAL)
    provisioning.provision_gate_settings(vault, constants.ROLE_A, room=make_room(), control_probe=silent_control_probe)

    provisioned = (vault / constants.PLUGIN_DATA_REL).read_bytes()
    for key in constants.CREDENTIAL_SETTINGS_KEYS:
        member = f'"{key}": "{SENTINELS[key]}"'.encode("utf-8")
        assert member in provisioned, f"the {key} member was rewritten by the splice"


def test_the_whole_file_is_byte_identical_again_after_restore(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-roundtrip", ORIGINAL)
    settings = vault / constants.PLUGIN_DATA_REL
    digest = hashlib.sha256(ORIGINAL).hexdigest()

    provisioning.provision_gate_settings(vault, constants.ROLE_B, room=make_room(), control_probe=silent_control_probe)
    assert settings.read_bytes() != ORIGINAL, "the provisioning was a no-op"

    provisioning.restore_gate_settings(vault)
    restored = settings.read_bytes()
    assert len(restored) == len(ORIGINAL)
    assert hashlib.sha256(restored).hexdigest() == digest
    assert restored == ORIGINAL


def test_no_sentinel_reaches_the_record_or_the_marker(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-record", ORIGINAL)
    record = provisioning.provision_gate_settings(vault, constants.ROLE_A, room=make_room(), control_probe=silent_control_probe)

    assert_no_sentinel(repr(record), "repr(GateProvisionRecord)")
    assert_no_sentinel(str(record), "str(GateProvisionRecord)")
    for name in dir(record):
        if name.startswith("_"):
            continue
        assert_no_sentinel(repr(getattr(record, name)), f"GateProvisionRecord.{name}")

    marker = (vault / constants.PROVISION_MARKER_REL).read_bytes().decode("utf-8")
    assert_no_sentinel(marker, "the provisioning marker")


def test_no_sentinel_reaches_stdout_stderr_or_the_logging_stream(
    tmp_path: Path, capsys: pytest.CaptureFixture, caplog: pytest.LogCaptureFixture
) -> None:
    vault = make_vault(tmp_path, "vault-quiet", ORIGINAL)
    with caplog.at_level(logging.DEBUG):
        provisioning.provision_gate_settings(vault, constants.ROLE_A, room=make_room(), control_probe=silent_control_probe)
        provisioning.restore_gate_settings(vault)

    captured = capsys.readouterr()
    assert_no_sentinel(captured.out, "stdout")
    assert_no_sentinel(captured.err, "stderr")
    assert_no_sentinel(caplog.text, "the logging stream")


def test_no_sentinel_reaches_the_message_of_a_refusal(tmp_path: Path) -> None:
    # A refusal is the most likely leak site: it is the one place the rig is tempted
    # to quote the file it could not understand.
    vault = make_vault(tmp_path, "vault-refuse", ORIGINAL)
    provisioning.provision_gate_settings(vault, constants.ROLE_A, room=make_room(), control_probe=silent_control_probe)
    # Corrupt the saved original so the restore verification cannot pass.
    (vault / constants.SETTINGS_BACKUP_REL).write_bytes(ORIGINAL + b"\n")

    with pytest.raises(ports.ProvisionError) as excinfo:
        provisioning.restore_gate_settings(vault)

    assert_no_sentinel(str(excinfo.value), "a refusal message")
    assert_no_sentinel(repr(excinfo.value), "a refusal repr")
