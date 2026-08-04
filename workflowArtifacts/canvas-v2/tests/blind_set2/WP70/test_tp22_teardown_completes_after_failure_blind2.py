# WP70 / AC4 — blind counterpart 2 for "teardown runs to completion even when a step in
# the middle fails".
#
# Different angle: teardown over REAL rig resources rather than over synthetic callables.
# A relay whose port never frees and two vault borrows are torn down together; the relay
# failure must not stop either restore, and both vaults must come back byte-exact.
#
# DATA SAFETY: synthetic fixture vaults under tmp_path, guarded against both owner
# vaults. No socket is opened and no process is started.

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

# --- repo bootstrap (T3_SharedContract §0.2) --------------------------------------
for _parent in Path(__file__).resolve().parents:
    if (_parent / "tools").is_dir() and (_parent / "plugin").is_dir():
        _TOOLS = _parent / "tools"
        break
else:  # pragma: no cover
    raise RuntimeError(f"obsidian-live-share repo root not found from {__file__}")
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, provisioning, relay  # noqa: E402

OWNER_VAULTS = (
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga"),
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie"),
)

RUN_ID = "20260803T095959Z-37-112233"
DATA_JSON = b'{\n\t"clientId": "fixture-teardown"\n}'
COMMUNITY = b'[\n\t"obsidian-git",\n\t"live-share"\n]'


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


def make_vault(tmp_path: Path, name: str) -> Path:
    vault = assert_synthetic(tmp_path / name)
    (vault / constants.PLUGIN_DIR_REL).mkdir(parents=True, exist_ok=True)
    (vault / constants.PLUGIN_DATA_REL).write_bytes(DATA_JSON)
    (vault / constants.COMMUNITY_PLUGINS_REL).write_bytes(COMMUNITY)
    return vault


def make_room() -> relay.RelayRoom:
    return relay.RelayRoom(
        id="11112222-3333-4444-5555-666677778888",
        token="SENTINEL-BLIND2-TOKEN",
        name=f"{constants.RELAY_ROOM_NAME_PREFIX}{RUN_ID}",
        base_url=constants.RELAY_BASE_URL,
    )


def stuck_relay(tmp_path: Path):
    console = relay.RelayPlanConsole()
    repo_root = tmp_path / "repo"
    (repo_root / constants.RELAY_ENTRY_REL).parent.mkdir(parents=True, exist_ok=True)
    (repo_root / constants.RELAY_ENTRY_REL).write_bytes(b"// built\n")
    world = {"listening": False}
    local = relay.LocalRelay(
        console=console,
        repo_root=repo_root,
        run_id=RUN_ID,
        store_root=tmp_path / "stores",
        port_probe=lambda host, port: bool(world["listening"]),
        health_probe=lambda url: {"ok": True, "documents": 0, "clients": 0},
        room_minter=lambda url, room: {"id": "r", "token": "SENTINEL-TOKEN"},
    )
    console.close_console = lambda cid: {"closed": True}  # returns, frees nothing
    local.start()
    world["listening"] = True
    return local


def test_a_stuck_relay_does_not_stop_either_vault_restore(tmp_path: Path) -> None:
    room = make_room()
    vault_a = make_vault(tmp_path, "vault-a")
    vault_b = make_vault(tmp_path, "vault-b - Kopie")
    local = stuck_relay(tmp_path)

    for vault, role in ((vault_a, constants.ROLE_A), (vault_b, constants.ROLE_B)):
        provisioning.disable_community_plugins(vault, role, run_id=RUN_ID)
        provisioning.provision_gate_settings(
            vault, role, room=room, run_id=RUN_ID, control_probe=silent_control_probe
        )

    report = provisioning.run_teardown(
        [
            ("release_relay", lambda: local.release(timeout_s=1.0)),
            ("restore_settings_a", lambda: provisioning.restore_gate_settings(vault_a)),
            ("restore_settings_b", lambda: provisioning.restore_gate_settings(vault_b)),
            ("restore_plugins_a", lambda: provisioning.restore_community_plugins(vault_a)),
            ("restore_plugins_b", lambda: provisioning.restore_community_plugins(vault_b)),
        ]
    )

    assert report.complete is True
    assert report.failed == ("release_relay",)
    assert report.reasons["release_relay"] == constants.RELAY_NOT_STOPPED
    for vault in (vault_a, vault_b):
        assert (vault / constants.PLUGIN_DATA_REL).read_bytes() == DATA_JSON
        assert (vault / constants.COMMUNITY_PLUGINS_REL).read_bytes() == COMMUNITY


def test_the_borrows_really_were_live_before_teardown(tmp_path: Path) -> None:
    # Without this, the byte-exact assertions would pass for a run that borrowed nothing.
    vault = make_vault(tmp_path, "vault-live")
    provisioning.disable_community_plugins(vault, constants.ROLE_A, run_id=RUN_ID)
    provisioning.provision_gate_settings(
        vault, constants.ROLE_A, room=make_room(), run_id=RUN_ID,
        control_probe=silent_control_probe,
    )
    assert (vault / constants.PLUGIN_DATA_REL).read_bytes() != DATA_JSON
    assert (vault / constants.COMMUNITY_PLUGINS_REL).read_bytes() != COMMUNITY

    provisioning.run_teardown(
        [
            ("restore_settings", lambda: provisioning.restore_gate_settings(vault)),
            ("restore_plugins", lambda: provisioning.restore_community_plugins(vault)),
        ]
    )
    assert hashlib.sha256((vault / constants.PLUGIN_DATA_REL).read_bytes()).hexdigest() == (
        hashlib.sha256(DATA_JSON).hexdigest()
    )
    assert (vault / constants.COMMUNITY_PLUGINS_REL).read_bytes() == COMMUNITY


def test_a_failure_in_the_first_restore_does_not_stop_the_second(tmp_path: Path) -> None:
    vault_a = make_vault(tmp_path, "fail-a")
    vault_b = make_vault(tmp_path, "fail-b")
    room = make_room()
    for vault, role in ((vault_a, constants.ROLE_A), (vault_b, constants.ROLE_B)):
        provisioning.provision_gate_settings(
            vault, role, room=room, run_id=RUN_ID, control_probe=silent_control_probe
        )
    # Corrupt vault A's backup so its restore cannot be byte-exact.
    (vault_a / constants.SETTINGS_BACKUP_REL).write_bytes(DATA_JSON + b"\n")

    report = provisioning.run_teardown(
        [
            ("restore_a", lambda: provisioning.restore_gate_settings(vault_a)),
            ("restore_b", lambda: provisioning.restore_gate_settings(vault_b)),
        ]
    )
    assert report.attempted == ("restore_a", "restore_b")
    assert report.failed == ("restore_a",)
    assert report.reasons["restore_a"] == constants.SETTINGS_RESTORE_MISMATCH
    assert (vault_b / constants.PLUGIN_DATA_REL).read_bytes() == DATA_JSON
