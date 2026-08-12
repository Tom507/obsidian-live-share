"""B75 · P4 — INTEGRATION (live rig, existing `canvas.diag` surface)

SURFACE: the pixels, against the model, on every peer, right now.

This is the most literal reading of the report there is. The owner says cards
sit somewhere other than where they belong and that the problem is RENDERING,
not synchronisation. `canvas.diag op=census` already answers exactly that
question per node: `paint` de-transforms each card's `getBoundingClientRect()`
back into canvas coordinates and compares it with `canvas.nodes[id].x/y`.

WHAT IS AND IS NOT A DIVERGENCE (taken from the instrument, not re-derived):
  * `detached`  — Obsidian's `virtualize()` has the card off screen. Nothing is
                  painted, so nothing can be in the wrong place. NOT scored.
  * `unpainted` — attached with no transform. Reported separately and FAILED on,
                  because a card that was never painted is a visible defect.
  * `unreadable`— the element could not be measured. Never scored as agreement;
                  it makes the peer INCOMPLETE.

REFUSAL: a peer that cannot produce a readable paint plane does not contribute a
zero. It makes the probe FAIL with its reason, because a probe that cannot see
the board must not report the board as fine.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lib_peers import (  # noqa: E402
    add_common_args, census, paint_plane, peers_from_args, result_of, save, unusable, verdict,
)


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="B75 P4 — painted geometry vs model geometry")
    add_common_args(ap)
    args = ap.parse_args(argv)
    peers = peers_from_args(args)

    lines: list[str] = []
    ok = True
    raw: dict = {}

    for name, port in peers.items():
        resp = census(port, args.path)
        raw[name] = {"port": port, "resp": resp}
        why = unusable(resp)
        if why:
            ok = False
            lines.append(f"{name}:{port} INCOMPLETE — {why}")
            continue
        result = result_of(resp) or {}
        plane = paint_plane(result)
        if plane.get("available") is not True:
            ok = False
            lines.append(f"{name}:{port} PAINT PLANE UNAVAILABLE — {plane.get('reason')}")
            continue
        label = plane.get("label") or {}
        detail = label.get("nodesDetail") or {}
        divergent = sorted(label.get("divergentNodes") or [])
        unpainted = sorted(label.get("unpaintedNodes") or [])
        detached = label.get("detachedNodes") or []
        unreadable = sorted(k for k, d in detail.items() if d.get("verdict") == "unreadable")

        lines.append(
            f"{name}:{port} nodes={plane.get('count')} divergent={len(divergent)} "
            f"unpainted={len(unpainted)} detached(off-screen, not scored)={len(detached)} "
            f"unreadable={len(unreadable)} viewport={label.get('viewport')}"
        )
        for node in divergent:
            d = detail.get(node) or {}
            off = d.get("offset") or {}
            lines.append(
                f"    DIVERGENT {node[:20]:<21} model={d.get('model')} rect={d.get('rect')} "
                f"style={d.get('styleTransform')} offset=({off.get('dx')},{off.get('dy')}) "
                f"[style={d.get('styleVerdict')} rect={d.get('rectVerdict')}]"
            )
        for node in unpainted:
            lines.append(f"    NEVER PAINTED {node[:20]}")
        for node in unreadable:
            lines.append(f"    UNREADABLE {node[:20]} — {(detail.get(node) or {}).get('reason')}")

        if divergent or unpainted or unreadable:
            ok = False

    out = save("P4-paint-vs-model", raw)
    lines.append(f"raw responses: {out}")
    return verdict("P4", ok, lines)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
