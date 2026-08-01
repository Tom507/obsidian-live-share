"""WP43 / AC4 (visible) — read-only is structural, not incidental.

Three structural angles:
  1. the module's public surface exposes no write operation (name-level check on callables);
  2. a full discovery run against a fixture vault leaves a recursive before/after fingerprint
     byte-identical (hashes only — no file content is ever compared, printed or stored);
  3. while the run is in flight, any attempt to open a file in a write mode fails the test.

Data safety: fixtures only, under pytest's ``tmp_path``. A ``data.json`` is present in the fixture
so it participates in the fingerprint, but only its sha256 is ever looked at.
"""

from __future__ import annotations

import builtins
import hashlib
import inspect
import io
import json
import sys
from pathlib import Path

_TOOLS = Path(__file__).resolve().parents[5] / "tools"
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, vaults  # noqa: E402

PLUGIN_MAIN_REL = getattr(constants, "PLUGIN_MAIN_REL", constants.PLUGIN_DIR_REL + "/main.js")

WRITE_WORDS = (
    "write",
    "save",
    "create",
    "delete",
    "remove",
    "unlink",
    "mkdir",
    "rmdir",
    "rename",
    "move",
    "copy",
    "touch",
    "provision",
    "install",
    "launch",
    "spawn",
    "kill",
    "terminate",
    "truncate",
    "chmod",
    "dump",
)


def _fingerprint(root: Path) -> dict:
    entries: dict[str, tuple] = {}
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root).as_posix()
        if path.is_dir():
            entries[rel] = ("dir",)
        else:
            data = path.read_bytes()
            entries[rel] = ("file", len(data), hashlib.sha256(data).hexdigest())
    return entries


def _vault(root: Path) -> Path:
    (root / "Notes").mkdir(parents=True, exist_ok=True)
    (root / "Notes" / "n.md").write_text("# fixture\n", encoding="utf-8")
    plugin_dir = root / Path(constants.PLUGIN_DIR_REL)
    plugin_dir.mkdir(parents=True, exist_ok=True)
    (root / Path(PLUGIN_MAIN_REL)).write_text(f"/* {constants.SETTINGS_PORT_KEY} */\n", encoding="utf-8")
    (root / Path(constants.PLUGIN_DATA_REL)).write_text(
        json.dumps({"fixtureOnly": True}), encoding="utf-8"
    )
    (root / Path(constants.COMMUNITY_PLUGINS_REL)).write_text(
        json.dumps([constants.PLUGIN_ID]), encoding="utf-8"
    )
    return root


def test_public_surface_exposes_no_write_operation() -> None:
    offenders = []
    for name in dir(vaults):
        if name.startswith("_"):
            continue
        member = getattr(vaults, name)
        if inspect.ismodule(member):
            continue
        if callable(member) and any(word in name.lower() for word in WRITE_WORDS):
            offenders.append(name)
        if inspect.isclass(member) and getattr(member, "__module__", "") == vaults.__name__:
            for attr in dir(member):
                if attr.startswith("_"):
                    continue
                if callable(getattr(member, attr, None)) and any(
                    word in attr.lower() for word in WRITE_WORDS
                ):
                    offenders.append(f"{name}.{attr}")
    assert offenders == []


def test_discovery_leaves_the_fixture_vault_byte_identical(tmp_path: Path, monkeypatch) -> None:
    vault_a = _vault(tmp_path / "vaults" / "ReadOnlyA")
    vault_b = _vault(tmp_path / "vaults" / "Read Only B")

    registry = tmp_path / "appdata" / "obsidian.json"
    registry.parent.mkdir(parents=True, exist_ok=True)
    registry.write_text(
        json.dumps(
            {
                "vaults": {
                    "f100000000000001": {"path": str(vault_a)},
                    "f100000000000002": {"path": str(vault_b)},
                }
            }
        ),
        encoding="utf-8",
    )

    before_a = _fingerprint(vault_a)
    before_b = _fingerprint(vault_b)
    before_registry = hashlib.sha256(registry.read_bytes()).hexdigest()

    real_open = builtins.open
    real_io_open = io.open

    def _guarded(file, mode="r", *args, **kwargs):
        effective = kwargs.get("mode", mode)
        if any(flag in str(effective) for flag in ("w", "a", "x", "+")):
            raise AssertionError(f"write-mode open attempted: {effective!r} on {file!r}")
        return real_open(file, mode, *args, **kwargs)

    monkeypatch.setattr(builtins, "open", _guarded)
    monkeypatch.setattr(io, "open", _guarded)
    try:
        result = vaults.discover_instances(
            vault_paths={constants.ROLE_A: str(vault_a), constants.ROLE_B: str(vault_b)},
            registry_path=registry,
            process_lister=lambda: [],
        )
    finally:
        monkeypatch.setattr(builtins, "open", real_open)
        monkeypatch.setattr(io, "open", real_io_open)

    assert result.instances[constants.ROLE_A].registry_id == "f100000000000001"
    assert _fingerprint(vault_a) == before_a
    assert _fingerprint(vault_b) == before_b
    assert hashlib.sha256(registry.read_bytes()).hexdigest() == before_registry
