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
- :mod:`obsidian_e2e.ports`     — WP44's per-vault control-port provisioning with byte-exact
  capture and restore of the plugin settings file.
- :mod:`obsidian_e2e.lifecycle` — WP45's attach-vs-launch lifecycle for the real rig.
- :mod:`obsidian_e2e.readiness` — WP46's readiness / instance-identity handshake, and its
  inverted teardown form.
- :mod:`obsidian_e2e.scratch`   — WP47's per-run scratch canvas, the single sanctioned
  vault-write funnel, and the before/after vault fingerprint that is the run's
  data-safety verdict.
- :mod:`obsidian_e2e.teardown`  — WP48's ordered teardown, bounded waits, mid-run endpoint
  liveness and the start-up reclaim of a previous crashed run's artefacts.
"""

from __future__ import annotations

__all__ = [
    "constants",
    "lifecycle",
    "ports",
    "readiness",
    "scratch",
    "teardown",
    "vaults",
]
