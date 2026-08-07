"""WP43 / AC4 (blind 2) — nothing appears, disappears or gets mutated at the filesystem-call level.

Angle of attack differs from both the visible test and blind 1: the guard sits at the OS layer
(``os.open`` with any write flag) and on ``pathlib``'s mutating methods, and the witness is a
set-equality of relative paths before/after plus the descriptor objects' own surface. No hashing of
content is used as the oracle here, so this test fails for a different reason than the others.

Data safety: fixtures only, under pytest's ``tmp_path``.
"""

from __future__ import annotations

import inspect
import json
import os
import sys
from pathlib import Path

_TOOLS = Path(__file__).resolve().parents[5] / "tools"
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, vaults  # noqa: E402

_MAIN = getattr(constants, "PLUGIN_MAIN_REL", constants.PLUGIN_DIR_REL + "/main.js")

_WRITE_FLAGS = (
    getattr(os, "O_WRONLY", 0)
    | getattr(os, "O_RDWR", 0)
    | getattr(os, "O_CREAT", 0)
    | getattr(os, "O_APPEND", 0)
    | getattr(os, "O_TRUNC", 0)
)

_MUTATORS = (
    "write_text",
    "write_bytes",
    "mkdir",
    "touch",
    "unlink",
    "rmdir",
    "rename",
    "replace",
    "chmod",
    "symlink_to",
)


def _paths(root: Path) -> set:
    return {p.relative_to(root).as_posix() for p in root.rglob("*")}


def _vault(root: Path) -> Path:
    (root / "Journal").mkdir(parents=True, exist_ok=True)
    (root / "Journal" / "j.md").write_text("fixture\n", encoding="utf-8")
    (root / Path(_MAIN)).parent.mkdir(parents=True, exist_ok=True)
    (root / Path(_MAIN)).write_text(f"/*{constants.SETTINGS_PORT_KEY}*/", encoding="utf-8")
    (root / Path(constants.PLUGIN_DATA_REL)).write_text(json.dumps({"fixture": True}), encoding="utf-8")
    (root / Path(constants.COMMUNITY_PLUGINS_REL)).write_text(json.dumps([]), encoding="utf-8")
    return root


def test_no_write_syscall_and_no_path_set_change(tmp_path: Path, monkeypatch) -> None:
    vault_a = _vault(tmp_path / "vaults" / "SyscallA")
    vault_b = _vault(tmp_path / "vaults" / "Syscall B")

    registry = tmp_path / "cfg" / "obsidian.json"
    registry.parent.mkdir(parents=True, exist_ok=True)
    registry.write_text(
        json.dumps(
            {
                "vaults": {
                    "de00000000000001": {"path": str(vault_a)},
                    "de00000000000002": {"path": str(vault_b)},
                }
            }
        ),
        encoding="utf-8",
    )

    before_a = _paths(vault_a)
    before_b = _paths(vault_b)
    before_registry_stat = registry.stat().st_size

    real_os_open = os.open

    def _guarded_os_open(path, flags, *args, **kwargs):
        if flags & _WRITE_FLAGS:
            raise AssertionError(f"write-flagged os.open attempted on {path!r} (flags={flags})")
        return real_os_open(path, flags, *args, **kwargs)

    def _explode(*args, **kwargs):
        raise AssertionError("mutating pathlib call attempted")

    monkeypatch.setattr(os, "open", _guarded_os_open)
    for name in _MUTATORS:
        if hasattr(Path, name):
            monkeypatch.setattr(Path, name, _explode)

    result = vaults.discover_instances(
        vault_paths={constants.ROLE_A: str(vault_a), constants.ROLE_B: str(vault_b)},
        registry_path=registry,
        process_lister=lambda: [],
    )

    monkeypatch.undo()

    assert result.instances[constants.ROLE_A].registry_id == "de00000000000001"
    assert _paths(vault_a) == before_a
    assert _paths(vault_b) == before_b
    assert registry.stat().st_size == before_registry_stat


def test_returned_descriptors_expose_no_mutating_method(tmp_path: Path) -> None:
    vault = _vault(tmp_path / "vaults" / "SurfaceCheck")
    registry = tmp_path / "cfg" / "obsidian.json"
    registry.parent.mkdir(parents=True, exist_ok=True)
    registry.write_text(json.dumps({"vaults": {"de00000000000003": {"path": str(vault)}}}), encoding="utf-8")

    result = vaults.discover_instances(
        vault_paths={constants.ROLE_A: str(vault)},
        registry_path=registry,
        process_lister=lambda: [],
    )

    descriptor = result.instances[constants.ROLE_A]
    forbidden = ("write", "save", "apply", "provision", "launch", "delete", "commit", "persist")
    methods = [
        name
        for name in dir(descriptor)
        if not name.startswith("_")
        and inspect.isroutine(getattr(descriptor, name, None))
        and any(word in name.lower() for word in forbidden)
    ]
    assert methods == []
