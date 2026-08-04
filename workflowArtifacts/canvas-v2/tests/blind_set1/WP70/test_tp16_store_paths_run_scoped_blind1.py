# WP70 / AC3 — blind counterpart 1 for "all three store paths land under the run-scoped
# directory, which is outside the repo and outside both vaults, and is removed at
# teardown".
#
# Different angle: the DEFAULT store root. When no root is injected the directory must be
# under the platform temp directory — never under the repository, never under a vault,
# never under the current working directory. That is checked by construction, without
# creating anything, so the real temp tree is not touched.
#
# DATA SAFETY: the only directories created are under tmp_path. The default-root case is
# asserted on the computed path only.

from __future__ import annotations

import os
import sys
import tempfile
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

from obsidian_e2e import constants, relay  # noqa: E402

OWNER_VAULTS = (
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga"),
    Path(r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie"),
)

RUN_IDS = (
    "20260803T215959Z-25-556677",
    "20260803T215959Z-25-556678",
    "19990101T000000Z-1-000000",
)


def build(tmp_path: Path, run_id: str, store_root=None):
    console = relay.RelayPlanConsole()
    repo_root = tmp_path / "repo"
    (repo_root / constants.RELAY_ENTRY_REL).parent.mkdir(parents=True, exist_ok=True)
    (repo_root / constants.RELAY_ENTRY_REL).write_bytes(b"// built\n")
    return relay.LocalRelay(
        console=console,
        repo_root=repo_root,
        run_id=run_id,
        store_root=store_root,
        port_probe=lambda host, port: False,
        health_probe=lambda url: {"ok": True, "documents": 0, "clients": 0},
        room_minter=lambda url, room: {"id": "r", "token": "SENTINEL-TOKEN"},
    )


def test_the_default_store_root_is_the_platform_temp_directory(tmp_path: Path) -> None:
    local = build(tmp_path, RUN_IDS[0])
    store_dir = Path(local.store_dir)
    assert Path(tempfile.gettempdir()).resolve() in store_dir.resolve().parents
    assert store_dir.parent.name == constants.RELAY_STORE_ROOT_NAME
    assert store_dir.name == RUN_IDS[0]
    assert not store_dir.exists(), "constructing a relay created a directory"


def test_the_default_store_root_is_outside_the_repo_the_cwd_and_both_vaults(
    tmp_path: Path,
) -> None:
    local = build(tmp_path, RUN_IDS[0])
    store_dir = Path(local.store_dir).resolve()
    forbidden = [Path(_REPO).resolve(), Path(os.getcwd()).resolve(), *[Path(v) for v in OWNER_VAULTS]]
    for root in forbidden:
        resolved = Path(root).resolve()
        assert store_dir != resolved
        assert resolved not in store_dir.parents


@pytest.mark.parametrize("run_id", RUN_IDS)
def test_each_run_id_gets_its_own_directory(tmp_path: Path, run_id: str) -> None:
    local = build(tmp_path, run_id, store_root=tmp_path / "stores")
    store_dir = Path(local.prepare_store()).resolve()
    assert store_dir.name == run_id
    for other in RUN_IDS:
        if other != run_id:
            assert not (store_dir.parent / other).exists()


def test_the_three_subdirectories_are_created_and_are_empty(tmp_path: Path) -> None:
    local = build(tmp_path, RUN_IDS[1], store_root=tmp_path / "stores")
    local.prepare_store()
    for rel, path in local.store_paths().items():
        directory = Path(path)
        assert directory.is_dir(), rel
        assert list(directory.iterdir()) == [], f"{rel} inherited content"


def test_release_removes_a_populated_store_directory(tmp_path: Path) -> None:
    local = build(tmp_path, RUN_IDS[2], store_root=tmp_path / "stores")
    local.start()
    store_dir = Path(local.store_dir)
    for rel in constants.RELAY_STORE_SUBDIRS:
        (store_dir / rel / "000001.log").write_bytes(b"leveldb")
    (store_dir / "LOCK").write_bytes(b"")

    result = local.release()
    assert result.store_removed is True
    assert not store_dir.exists()
    assert store_dir.parent.exists(), "release removed the shared store ROOT as well"
