"""WP43 / AC4 (blind 1) — the module starts no process and copies nothing.

Angle of attack differs from the visible test: instead of guarding ``open``, every process-starting
and file-shuffling entry point of the standard library is armed to explode. Discovery is then run
with an injected process lister; if the module shells out (``tasklist``, ``wmic``, ``powershell``)
or copies anything, the test fails. The vault fingerprint is checked as a second, independent
witness — hashes only, never content.

Data safety: fixtures only, under pytest's ``tmp_path``.
"""

from __future__ import annotations

import hashlib
import inspect
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

_TOOLS = Path(__file__).resolve().parents[5] / "tools"
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, vaults  # noqa: E402

_MAIN_REL = getattr(constants, "PLUGIN_MAIN_REL", constants.PLUGIN_DIR_REL + "/main.js")


def _hash_tree(root: Path) -> dict:
    out: dict[str, tuple] = {}
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root).as_posix()
        out[rel] = ("dir",) if path.is_dir() else ("file", hashlib.sha256(path.read_bytes()).hexdigest())
    return out


def _vault(root: Path) -> Path:
    (root / "Kanban").mkdir(parents=True, exist_ok=True)
    (root / "Kanban" / "board.canvas").write_text('{"nodes":[],"edges":[]}', encoding="utf-8")
    (root / Path(_MAIN_REL)).parent.mkdir(parents=True, exist_ok=True)
    (root / Path(_MAIN_REL)).write_text(f"//{constants.SETTINGS_PORT_KEY}\n", encoding="utf-8")
    (root / Path(constants.PLUGIN_DATA_REL)).write_text(json.dumps({"fixture": 1}), encoding="utf-8")
    (root / Path(constants.COMMUNITY_PLUGINS_REL)).write_text(
        json.dumps([constants.PLUGIN_ID]), encoding="utf-8"
    )
    return root


def test_discovery_starts_no_process_and_copies_nothing(tmp_path: Path, monkeypatch) -> None:
    vault_a = _vault(tmp_path / "v" / "NoSpawnA")
    vault_b = _vault(tmp_path / "v" / "No Spawn B")

    registry = tmp_path / "appdata" / "obsidian.json"
    registry.parent.mkdir(parents=True, exist_ok=True)
    registry.write_text(
        json.dumps(
            {
                "vaults": {
                    "ab00000000000001": {"path": str(vault_a)},
                    "ab00000000000002": {"path": str(vault_b)},
                }
            }
        ),
        encoding="utf-8",
    )

    before = {"a": _hash_tree(vault_a), "b": _hash_tree(vault_b)}

    def _explode(*args, **kwargs):
        raise AssertionError(f"forbidden side effect invoked: args={args!r}")

    for attr in ("Popen", "run", "call", "check_call", "check_output", "getoutput"):
        if hasattr(subprocess, attr):
            monkeypatch.setattr(subprocess, attr, _explode)
    for attr in ("system", "popen", "startfile", "execv", "spawnv"):
        if hasattr(os, attr):
            monkeypatch.setattr(os, attr, _explode)
    for attr in ("copy", "copy2", "copyfile", "copytree", "move", "rmtree"):
        if hasattr(shutil, attr):
            monkeypatch.setattr(shutil, attr, _explode)

    result = vaults.discover_instances(
        vault_paths={constants.ROLE_A: str(vault_a), constants.ROLE_B: str(vault_b)},
        registry_path=registry,
        process_lister=lambda: [],
    )

    monkeypatch.undo()

    assert result.obsidian_running is False
    assert result.instances[constants.ROLE_B].registry_id == "ab00000000000002"
    assert _hash_tree(vault_a) == before["a"]
    assert _hash_tree(vault_b) == before["b"]


def test_module_exposes_no_open_file_handle() -> None:
    leaked = []
    for name in dir(vaults):
        if name.startswith("_"):
            continue
        member = getattr(vaults, name)
        if inspect.ismodule(member) or inspect.isclass(member):
            continue
        if hasattr(member, "write") and hasattr(member, "close"):
            leaked.append(name)
    assert leaked == []
