"""Import bootstrap for the WP44 (per-vault control-port provisioning) pytest suite.

`from tools.obsidian_e2e import ...` is BROKEN in this workspace and must never be
used (T3_SharedContract, "Import rule"): the AgenticWorkspace root holds a *regular*
`tools` package, and a regular package found anywhere on `sys.path` beats a namespace
portion found earlier — so `tools.*` always resolves to the workspace package, whatever
the path order.

The one sanctioned form is therefore: put the repo's own `tools/` directory on
`sys.path` and import the package by its globally unique name, `obsidian_e2e`.

This file carries no test logic and no fixtures — every test module builds its own
fixture vault under pytest's `tmp_path`. NOTHING here or in any WP44 test touches the
owner's live vaults or `%APPDATA%\\obsidian\\` (T3_SharedContract S1/S3/S5).
"""

from __future__ import annotations

import sys
from pathlib import Path


def _repo_root() -> Path:
    """The obsidian-live-share repo root: nearest ancestor holding both tools/ and plugin/.

    Resolved by walking up rather than by a fixed `parents[N]` index, so the suite keeps
    working if it is staged into another directory depth.
    """
    for parent in Path(__file__).resolve().parents:
        if (parent / "tools").is_dir() and (parent / "plugin").is_dir():
            return parent
    raise RuntimeError(
        "WP44 tests: could not locate the obsidian-live-share repo root "
        f"above {Path(__file__).resolve()}"
    )


REPO_ROOT = _repo_root()
TOOLS_DIR = REPO_ROOT / "tools"

if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))
