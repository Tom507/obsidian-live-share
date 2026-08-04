# WP70 / AC1 — blind counterpart 1 for "a borrow that cannot be established provisions
# nothing (vault byte-identical after the refusal)".
#
# Different data: settings files that are syntactically JSON but not a splice target —
# an array, a bare number, a bare string, an empty file, a BOM with nothing after it, and
# a file that is not valid UTF-8 at all. Each must refuse and leave the vault untouched.
#
# DATA SAFETY: synthetic fixture vaults under tmp_path, guarded against both owner vaults.

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

import pytest

# --- repo bootstrap (T3_SharedContract §0.2) --------------------------------------
for _parent in Path(__file__).resolve().parents:
    if (_parent / "tools").is_dir() and (_parent / "plugin").is_dir():
        _TOOLS = _parent / "tools"
        break
else:  # pragma: no cover
    raise RuntimeError(f"obsidian-live-share repo root not found from {__file__}")
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, ports, provisioning, relay  # noqa: E402

OWNER_VAULTS = (
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga"),
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie"),
)

BAD_SETTINGS = {
    "array": b'["not", "an", "object"]\n',
    "bare_number": b"42\n",
    "bare_string": b'"just a string"\n',
    "empty_file": b"",
    "bom_only": b"\xef\xbb\xbf",
    "not_utf8": b"{\xff\xfe\x00bad}",
    "unterminated_object": b'{\n  "a": 1\n',
    "unterminated_string": b'{\n  "a": "no closing quote\n}\n',
}


def silent_control_probe(port: int) -> bool:
    return False


def assert_synthetic(path: Path) -> Path:
    resolved = Path(path).resolve()
    for owner in OWNER_VAULTS:
        owner_resolved = Path(owner).resolve()
        assert resolved != owner_resolved, f"ABORT: {resolved} is an owner vault"
        assert owner_resolved not in resolved.parents, f"ABORT: {resolved} is inside an owner vault"
        assert resolved not in owner_resolved.parents, f"ABORT: {resolved} contains an owner vault"
    return resolved


def make_room() -> relay.RelayRoom:
    return relay.RelayRoom(
        id="7e7e7e7e-8f8f-9090-a1a1-b2b2c3c3d4d4",
        token="SENTINEL-BLIND1-TOKEN",
        name=f"{constants.RELAY_ROOM_NAME_PREFIX}20260804T191919Z-11-334455",
        base_url=constants.RELAY_BASE_URL,
    )


def fingerprint(vault: Path) -> dict:
    return {
        p.relative_to(vault).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(vault.rglob("*"))
        if p.is_file()
    }


@pytest.mark.parametrize("label", sorted(BAD_SETTINGS))
def test_an_unspliceable_settings_file_refuses_and_provisions_nothing(
    tmp_path: Path, label: str
) -> None:
    raw = BAD_SETTINGS[label]
    vault = assert_synthetic(tmp_path / f"vault-{label}")
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(raw)
    before = fingerprint(vault)

    with pytest.raises(ports.ProvisionError) as excinfo:
        provisioning.provision_gate_settings(
            vault, constants.ROLE_A, room=make_room(), control_probe=silent_control_probe
        )

    assert fingerprint(vault) == before, f"{label}: the refusal wrote something"
    assert excinfo.value.reason in constants.FAILURE_REASONS
    assert (vault / constants.PLUGIN_DATA_REL).read_bytes() == raw


@pytest.mark.parametrize("label", sorted(BAD_SETTINGS))
def test_the_refusal_leaves_no_backup_marker_or_temporary(
    tmp_path: Path, label: str
) -> None:
    vault = assert_synthetic(tmp_path / f"clean-{label}")
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(BAD_SETTINGS[label])

    with pytest.raises(ports.ProvisionError):
        provisioning.provision_gate_settings(
            vault, constants.ROLE_B, room=make_room(), control_probe=silent_control_probe
        )

    names = sorted(p.name for p in (vault / constants.PLUGIN_DIR_REL).iterdir())
    assert names == ["data.json"], f"{label}: leftovers {names}"


def test_the_refusal_never_quotes_the_unreadable_content(tmp_path: Path) -> None:
    vault = assert_synthetic(tmp_path / "vault-quiet")
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(b'"SENTINEL-LEAKED-SECRET-c0ffee"\n')

    with pytest.raises(ports.ProvisionError) as excinfo:
        provisioning.provision_gate_settings(
            vault, constants.ROLE_A, room=make_room(), control_probe=silent_control_probe
        )
    assert "SENTINEL-LEAKED-SECRET-c0ffee" not in f"{excinfo.value}{excinfo.value!r}"
