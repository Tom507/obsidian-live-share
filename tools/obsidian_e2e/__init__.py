"""``obsidian_e2e`` — support package for the real-Obsidian E2E rig (PHASE T3).

This is a **regular** package on purpose. ``T3_SharedContract.md`` §0.2 pins the one
sanctioned import form for every Python module and test in this batch::

    import sys, pathlib
    _TOOLS = pathlib.Path(__file__).resolve().parents[N] / "tools"   # <repo>/tools
    sys.path.insert(0, str(_TOOLS))
    from obsidian_e2e import constants, vaults        # top-level, NOT tools.obsidian_e2e

``import tools.obsidian_e2e`` is broken in this workspace: the workspace-level
``tools`` directory is a regular package and shadows the repo's namespace portion.
Never add an ``__init__.py`` to ``obsidian-live-share/tools/`` itself.

Members:

- :mod:`obsidian_e2e.constants` — every value shared by WP43–WP49, pinned once (WP43 owns it).
- :mod:`obsidian_e2e.vaults`    — WP43's **read-only** vault registry / instance probe.
"""

from __future__ import annotations

__all__ = ["constants", "vaults"]
