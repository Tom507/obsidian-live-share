"""Regenerate the Obsidian-bundle fixtures used by probe P3.

The RUNNING Obsidian is auto-updating, so a fixture goes stale silently. This
script is how it is refreshed, and the version it records is the version the
probe reports it measured.

    python extract_obsidian_fixture.py <bundle-dir> <version>

`<bundle-dir>` is a directory holding `app.css` and `app.js` extracted read-only
from the running installation's asar, e.g.

    C:/Users/<user>/AppData/Roaming/obsidian/obsidian-<version>.asar

Writes, beside this file:
  obsidian-canvas.css       every top-level rule whose selector mentions `.canvas`
  obsidian-symbols.json     presence/absence of every private member the plugin reaches for
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

# The private Canvas API members `plugin/src/canvas/canvas-adapter.ts` reaches
# for. A minifier keeps these because they are read off host objects by name.
SYMBOLS = [
    "wrapperEl", "canvasEl", "nodeEl", "markMoved", "requestSave",
    "getData", "setData", "startEditing", "isEditing", "virtualize",
    "zoomToSelection", "selectOnly", "posFromEvt", "requestFrame",
    "zoomBreakpoint", "canvas-node", "canvas-node-container", "canvas-wrapper",
]


def extract_css(app_css: str) -> str:
    out: list[str] = []
    # Top-level rule blocks only. Good enough for a flat stylesheet: Obsidian's
    # canvas rules are not nested inside @media except for a handful of hover
    # blocks, and those do not carry layout properties.
    for m in re.finditer(r"(^|\})\s*([^{}@]+?)\{([^{}]*)\}", app_css, re.M):
        selector = m.group(2).strip()
        body = m.group(3).strip()
        if ".canvas" not in selector:
            continue
        out.append(f"{selector} {{\n  {body}\n}}")
    return "\n".join(out)


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__)
        return 2
    bundle = Path(argv[0])
    version = argv[1]
    app_css = (bundle / "app.css").read_text(encoding="utf-8", errors="replace")
    app_js = (bundle / "app.js").read_text(encoding="utf-8", errors="replace")

    css = f"/* Obsidian {version} — extracted by extract_obsidian_fixture.py. DO NOT EDIT. */\n"
    css += extract_css(app_css)
    (HERE / "obsidian-canvas.css").write_text(css, encoding="utf-8")

    symbols = {name: app_js.count(name) for name in SYMBOLS}
    (HERE / "obsidian-symbols.json").write_text(
        json.dumps({"obsidianVersion": version, "bundleDir": str(bundle),
                    "symbolOccurrences": symbols}, indent=2),
        encoding="utf-8",
    )
    print(f"wrote obsidian-canvas.css ({len(css)} bytes) and obsidian-symbols.json for {version}")
    for k, v in symbols.items():
        print(f"  {k:<24} {v}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
