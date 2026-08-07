# WP70 / AC3 — "All three of the relay's cwd-relative LevelDB stores (`BLOB_STORE_PATH`,
# room persistence, audit log) are pointed at a run-scoped directory outside the
# repository and outside both vaults, and that directory is removed at teardown, so no
# run writes a store into the tree and no run inherits a previous run's rooms."
#
# Only ONE of the three is reachable by an environment variable (`BLOB_STORE_PATH`); the
# other two are parameter defaults with no env hook, and adding one would be a `server/`
# edit, which is an abort criterion. The mechanism is therefore the launch **cwd**, and
# that is what these tests assert: the cwd handed to the console IS the run-scoped store
# directory, so all three cwd-relative defaults land inside it.
#
#   ├── T1 the three pinned subdirectories all resolve under the run-scoped directory
#   ├── T2 the run-scoped directory is outside the repository and outside both vaults
#   ├── T3 the launch payload's cwd is the store directory — not `server/`, not the repo
#   ├── T4 BLOB_STORE_PATH is additionally set, absolutely, into the same directory
#   ├── T5 two runs get two directories — no run inherits a previous run's rooms
#   └── T6 release() removes the directory, and is safe to call twice
#
# DATA SAFETY: no socket is opened and no process is started. The store root is
# redirected to tmp_path so the real temp directory is untouched.

from __future__ import annotations

import sys
from pathlib import Path

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

RUN_ID = "20260804T000000Z-1-a1b2c3"
LAUNCH_TOOLS = {"run_command", "run_python"}


def make_relay(tmp_path: Path, run_id: str = RUN_ID):
    console = relay.RelayPlanConsole()
    repo_root = tmp_path / "repo"
    entry = repo_root / constants.RELAY_ENTRY_REL
    entry.parent.mkdir(parents=True, exist_ok=True)
    entry.write_bytes(b"// built relay entry\n")
    local = relay.LocalRelay(
        console=console,
        repo_root=repo_root,
        run_id=run_id,
        store_root=tmp_path / "store-root",
        port_probe=lambda host, port: False,
        health_probe=lambda base_url: {"ok": True, "documents": 0, "clients": 0},
        room_minter=lambda base_url, name: {"id": "room-1", "token": "SENTINEL-TOKEN"},
    )
    return local, console, repo_root


def launch_payload(console) -> dict:
    launches = [r for r in console.requests if r.get("mcp", {}).get("tool_name") in LAUNCH_TOOLS]
    assert len(launches) == 1, f"expected exactly one launch, got {len(launches)}"
    return launches[0]["mcp"]["arguments"]


def test_the_three_pinned_subdirectories_resolve_under_the_run_scoped_directory(
    tmp_path: Path,
) -> None:
    local, _console, _repo = make_relay(tmp_path)
    store_dir = Path(local.prepare_store()).resolve()

    assert constants.RELAY_STORE_SUBDIRS == ("data/frames", "data/yjs-docs", "data/audit")
    paths = local.store_paths()
    assert set(paths) == set(constants.RELAY_STORE_SUBDIRS)
    for rel, path in paths.items():
        resolved = Path(path).resolve()
        assert resolved.is_dir(), f"{rel} was not created"
        assert store_dir in resolved.parents or resolved == store_dir
        assert resolved.as_posix().endswith(rel)


def test_the_run_scoped_directory_is_outside_the_repository_and_both_vaults(
    tmp_path: Path,
) -> None:
    local, _console, repo_root = make_relay(tmp_path)
    store_dir = Path(local.prepare_store()).resolve()

    repo = Path(repo_root).resolve()
    assert repo != store_dir and repo not in store_dir.parents, "a store landed in the repo tree"
    real_repo = Path(_REPO).resolve()
    assert real_repo != store_dir and real_repo not in store_dir.parents
    for owner in OWNER_VAULTS:
        owner_resolved = Path(owner).resolve()
        assert store_dir != owner_resolved
        assert owner_resolved not in store_dir.parents
    assert store_dir.name == RUN_ID
    assert store_dir.parent.name == constants.RELAY_STORE_ROOT_NAME


def test_the_launch_cwd_is_the_store_directory(tmp_path: Path) -> None:
    local, console, repo_root = make_relay(tmp_path)
    local.start()
    args = launch_payload(console)

    assert Path(args["cwd"]).resolve() == Path(local.store_dir).resolve()
    # Charter §5's "run from server/" would put all three stores inside the repository,
    # which the same AC forbids; the AC wins over the gloss.
    assert Path(args["cwd"]).resolve() != (Path(repo_root) / constants.RELAY_SERVER_DIR_REL).resolve()
    assert Path(args["cwd"]).resolve() != Path(repo_root).resolve()
    # The entry path is absolute, so node's isMain branch still fires.
    assert Path(args["argv"][1]).is_absolute()
    assert args["argv"][1].endswith("index.js")


def test_blob_store_path_is_additionally_set_absolutely(tmp_path: Path) -> None:
    local, console, _repo = make_relay(tmp_path)
    local.start()
    env = launch_payload(console)["env"]

    assert env["PORT"] == str(constants.RELAY_PORT)
    blob = Path(env["BLOB_STORE_PATH"])
    assert blob.is_absolute()
    assert blob.resolve() == Path(local.store_paths()["data/frames"]).resolve()


def test_two_runs_get_two_directories(tmp_path: Path) -> None:
    first, _c1, _r1 = make_relay(tmp_path, run_id="20260804T000000Z-1-aaaaaa")
    second, _c2, _r2 = make_relay(tmp_path, run_id="20260804T000001Z-1-bbbbbb")
    a = Path(first.prepare_store()).resolve()
    b = Path(second.prepare_store()).resolve()
    assert a != b, "two runs would share a store and inherit each other's rooms"
    assert a.parent == b.parent


def test_release_removes_the_store_directory_and_is_safe_twice(tmp_path: Path) -> None:
    local, _console, _repo = make_relay(tmp_path)
    local.start()
    store_dir = Path(local.store_dir)
    (store_dir / "data" / "frames" / "0001.ldb").write_bytes(b"frame")
    assert store_dir.is_dir()

    result = local.release()
    assert result.store_removed is True
    assert not store_dir.exists(), "the run-scoped store survived teardown"

    again = local.release()
    assert not store_dir.exists()
    assert again.stopped is True
