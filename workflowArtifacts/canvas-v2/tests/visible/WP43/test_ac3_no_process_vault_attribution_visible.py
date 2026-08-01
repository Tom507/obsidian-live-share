"""WP43 / AC3 (visible) — Obsidian liveness is reported at host level, and no returned structure
attributes a process to a vault.

The injected process listing is deliberately tempting: each fake process quotes one of the two
vault paths on its command line. The module must still report only "Obsidian is running on this
host" and must not hand any pid or process record to a per-vault descriptor.

Data safety: fixtures only, under pytest's ``tmp_path``; the process listing is injected, so no
real process table is read and nothing is started.
"""

from __future__ import annotations

import dataclasses
import json
import re
import sys
from pathlib import Path

_TOOLS = Path(__file__).resolve().parents[5] / "tools"
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, vaults  # noqa: E402

PLUGIN_MAIN_REL = getattr(constants, "PLUGIN_MAIN_REL", constants.PLUGIN_DIR_REL + "/main.js")
OBSIDIAN_EXE = (
    getattr(constants, "OBSIDIAN_EXE_PATH", None)
    or getattr(constants, "OBSIDIAN_EXE", None)
    or getattr(constants, "OBSIDIAN_EXECUTABLE", None)
)


def _fields(obj) -> dict:
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        return dataclasses.asdict(obj)
    if hasattr(obj, "_asdict"):
        return dict(obj._asdict())
    if isinstance(obj, dict):
        return dict(obj)
    own = getattr(obj, "__dict__", None)
    if own:
        return {k: v for k, v in own.items() if not k.startswith("_")}
    return {
        name: getattr(obj, name)
        for name in dir(obj)
        if not name.startswith("_") and not callable(getattr(obj, name))
    }


def _vault(root: Path) -> Path:
    (root / "Notes").mkdir(parents=True, exist_ok=True)
    (root / "Notes" / "n.md").write_text("# fixture\n", encoding="utf-8")
    main_js = root / Path(PLUGIN_MAIN_REL)
    main_js.parent.mkdir(parents=True, exist_ok=True)
    main_js.write_text(f"/* {constants.SETTINGS_PORT_KEY} */\n", encoding="utf-8")
    community = root / Path(constants.COMMUNITY_PLUGINS_REL)
    community.parent.mkdir(parents=True, exist_ok=True)
    community.write_text(json.dumps([constants.PLUGIN_ID]), encoding="utf-8")
    return root


def test_running_is_host_level_and_no_pid_reaches_a_vault_descriptor(tmp_path: Path) -> None:
    assert OBSIDIAN_EXE, "constants.py must pin the Obsidian executable path"
    exe_name = Path(str(OBSIDIAN_EXE)).name

    vault_a = _vault(tmp_path / "vaults" / "HostVaultA")
    vault_b = _vault(tmp_path / "vaults" / "Host Vault B")

    registry = tmp_path / "appdata" / "obsidian.json"
    registry.parent.mkdir(parents=True, exist_ok=True)
    registry.write_text(
        json.dumps(
            {
                "vaults": {
                    "aabb000000000001": {"path": str(vault_a)},
                    "aabb000000000002": {"path": str(vault_b)},
                }
            }
        ),
        encoding="utf-8",
    )

    fake_processes = [
        {"pid": 424242, "name": exe_name, "cmdline": f'"{OBSIDIAN_EXE}" "{vault_a}"'},
        {"pid": 434343, "name": exe_name, "cmdline": f'"{OBSIDIAN_EXE}" "{vault_b}"'},
    ]

    result = vaults.discover_instances(
        vault_paths={constants.ROLE_A: str(vault_a), constants.ROLE_B: str(vault_b)},
        registry_path=registry,
        process_lister=lambda: list(fake_processes),
    )

    assert result.obsidian_running is True
    assert isinstance(result.obsidian_running, bool)

    for role in (constants.ROLE_A, constants.ROLE_B):
        blob = _fields(result.instances[role])
        rendered = json.dumps(blob, default=str)
        assert "424242" not in rendered
        assert "434343" not in rendered
        assert not [key for key in blob if re.search(r"pid|process", str(key), re.IGNORECASE)]
