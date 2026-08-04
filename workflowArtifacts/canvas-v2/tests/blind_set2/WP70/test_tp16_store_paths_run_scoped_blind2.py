# WP70 / AC3 — blind counterpart 2 for "all three store paths land under the run-scoped
# directory, which is outside the repo and outside both vaults, and is removed at
# teardown".
#
# Different angle: the MECHANISM. Only `BLOB_STORE_PATH` is reachable by an environment
# variable; room persistence and the audit log are parameter defaults with no env hook,
# and adding one would be a `server/` edit — an abort criterion. So the launch payload
# must carry a cwd that IS the store directory, and the three cwd-relative defaults are
# checked as the paths they would resolve to from that cwd.
#
# DATA SAFETY: no socket is opened and no process is started. Only tmp_path is written.

from __future__ import annotations

import posixpath
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

RUN_ID = "20260803T205959Z-26-667788"
LAUNCH_TOOLS = {"run_command", "run_python"}

# The server's own cwd-relative defaults, from `server/src/*.ts`. They are not
# configurable, which is why the rig controls them through the working directory.
CWD_RELATIVE_DEFAULTS = ("./data/frames", "./data/yjs-docs", "./data/audit")


def build(tmp_path: Path):
    console = relay.RelayPlanConsole()
    repo_root = tmp_path / "repo"
    (repo_root / constants.RELAY_ENTRY_REL).parent.mkdir(parents=True, exist_ok=True)
    (repo_root / constants.RELAY_ENTRY_REL).write_bytes(b"// built\n")
    local = relay.LocalRelay(
        console=console,
        repo_root=repo_root,
        run_id=RUN_ID,
        store_root=tmp_path / "stores",
        port_probe=lambda host, port: False,
        health_probe=lambda url: {"ok": True, "documents": 0, "clients": 0},
        room_minter=lambda url, room: {"id": "r", "token": "SENTINEL-TOKEN"},
    )
    return local, console, repo_root


def payload(console) -> dict:
    launches = [r for r in console.requests if r["mcp"]["tool_name"] in LAUNCH_TOOLS]
    assert len(launches) == 1
    return launches[0]["mcp"]["arguments"]


def test_the_three_cwd_relative_defaults_resolve_inside_the_store_directory(
    tmp_path: Path,
) -> None:
    local, console, _repo = build(tmp_path)
    local.start()
    cwd = Path(payload(console)["cwd"]).resolve()

    for default in CWD_RELATIVE_DEFAULTS:
        resolved = (cwd / posixpath.normpath(default)).resolve()
        assert cwd in resolved.parents, f"{default} would land outside the store directory"
    assert cwd == Path(local.store_dir).resolve()


def test_the_cwd_is_neither_the_repo_root_nor_the_server_directory(tmp_path: Path) -> None:
    local, console, repo_root = build(tmp_path)
    local.start()
    cwd = Path(payload(console)["cwd"]).resolve()

    assert cwd != Path(repo_root).resolve()
    assert cwd != (Path(repo_root) / constants.RELAY_SERVER_DIR_REL).resolve()
    assert Path(repo_root).resolve() not in cwd.parents
    assert Path(_REPO).resolve() not in cwd.parents


def test_the_env_carries_only_what_the_relay_actually_reads(tmp_path: Path) -> None:
    local, console, _repo = build(tmp_path)
    local.start()
    env = payload(console)["env"]

    assert set(env) == {"PORT", "BLOB_STORE_PATH"}
    assert env["PORT"] == str(constants.RELAY_PORT)
    # No secret is ever handed to a console tool.
    assert "SERVER_PASSWORD" not in env
    assert "REQUIRE_GITHUB_AUTH" not in env


def test_the_entry_is_absolute_so_node_still_finds_node_modules(tmp_path: Path) -> None:
    local, console, repo_root = build(tmp_path)
    local.start()
    argv = payload(console)["argv"]

    assert argv[0] == "node"
    entry = Path(argv[1])
    assert entry.is_absolute()
    assert entry.resolve() == (Path(repo_root) / constants.RELAY_ENTRY_REL).resolve()


def test_the_store_directory_is_gone_after_release_and_the_cwd_with_it(
    tmp_path: Path,
) -> None:
    local, console, _repo = build(tmp_path)
    local.start()
    cwd = Path(payload(console)["cwd"])
    assert cwd.is_dir()
    local.release()
    assert not cwd.exists()
