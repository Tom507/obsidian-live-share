# WP70 / obsidian-git precondition — blind counterpart 2 for "after disabling, the
# enabled list no longer contains obsidian-git and still contains live-share, and no
# other entry moved".
#
# Different angle: what the rig may and may not TOUCH. The disabled id set is a pinned
# constant, not a parameter the caller may widen; `live-share` can never be in it,
# because disabling the plugin under test would make the whole gate vacuous; and the
# plugin directories on disk — including the owner's `*.bak` files — are untouched.
#
# DATA SAFETY: synthetic fixture vaults under tmp_path, guarded against both owner vaults.

from __future__ import annotations

import hashlib
import json
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

from obsidian_e2e import constants, provisioning  # noqa: E402

OWNER_VAULTS = (
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga"),
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie"),
)

RUN_ID = "20260803T045959Z-42-667788"
ENABLED = ["obsidian-git", "live-share", "lan-vault-sync"]
OWNER_FILES = {
    "main.js": b"var production = 1;\n",
    "main.js.bak": b"var older = 1;\n",
    "main.js.0.5.9.bak": b"var oldest = 1;\n",
    "manifest.json.bak": b'{"id":"live-share"}\n',
    "styles.css.bak": b".x{}\n",
}


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
    plugin_dir = vault / constants.PLUGIN_DIR_REL
    plugin_dir.mkdir(parents=True, exist_ok=True)
    for filename, raw in OWNER_FILES.items():
        (plugin_dir / filename).write_bytes(raw)
    (vault / constants.COMMUNITY_PLUGINS_REL).write_bytes(
        json.dumps(ENABLED, indent=2).encode("utf-8") + b"\n"
    )
    return vault


def enabled(vault: Path) -> list:
    return json.loads((vault / constants.COMMUNITY_PLUGINS_REL).read_bytes().decode("utf-8-sig"))


def test_the_disabled_set_is_pinned_and_never_contains_the_plugin_under_test() -> None:
    assert constants.DISABLED_PLUGIN_IDS == ("obsidian-git",)
    assert constants.PLUGIN_ID not in constants.DISABLED_PLUGIN_IDS
    assert isinstance(constants.DISABLED_PLUGIN_IDS, tuple)


def test_lan_vault_sync_is_not_disabled(tmp_path: Path) -> None:
    # It is installed but NOT enabled in the owner's real vaults and cannot run, so it
    # is not the rig's to touch. Recorded here so it is not rediscovered.
    vault = make_vault(tmp_path, "vault-lan")
    provisioning.disable_community_plugins(vault, constants.ROLE_A, run_id=RUN_ID)
    assert "lan-vault-sync" in enabled(vault)
    assert "lan-vault-sync" not in constants.DISABLED_PLUGIN_IDS


def test_the_plugin_directory_is_untouched(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-plugin-dir")
    plugin_dir = vault / constants.PLUGIN_DIR_REL
    before = {
        p.name: hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(plugin_dir.iterdir())
        if p.is_file()
    }

    provisioning.disable_community_plugins(vault, constants.ROLE_B, run_id=RUN_ID)
    during = {
        p.name: hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(plugin_dir.iterdir())
        if p.is_file()
    }
    assert during == before, "the community-plugins borrow reached into the plugin dir"

    provisioning.restore_community_plugins(vault)
    after = {
        p.name: hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(plugin_dir.iterdir())
        if p.is_file()
    }
    assert after == before


def test_the_owners_backup_files_are_never_used_as_a_restore_point(
    tmp_path: Path,
) -> None:
    vault = make_vault(tmp_path, "vault-baks")
    provisioning.disable_community_plugins(vault, constants.ROLE_A, run_id=RUN_ID)
    # The rig's own restore point is the only one it knows about.
    assert (vault / constants.COMMUNITY_PLUGINS_BACKUP_REL).is_file()
    for filename in ("main.js.bak", "main.js.0.5.9.bak", "manifest.json.bak", "styles.css.bak"):
        assert (vault / constants.PLUGIN_DIR_REL / filename).read_bytes() == OWNER_FILES[filename]


def test_the_borrow_writes_only_inside_dot_obsidian(tmp_path: Path) -> None:
    vault = make_vault(tmp_path, "vault-scope")
    (vault / "Notiz.md").write_bytes(b"# owner note\n")
    provisioning.disable_community_plugins(vault, constants.ROLE_A, run_id=RUN_ID)

    outside = [p for p in vault.rglob("*") if p.is_file() and ".obsidian" not in p.parts]
    assert [p.name for p in outside] == ["Notiz.md"]
    assert (vault / "Notiz.md").read_bytes() == b"# owner note\n"
