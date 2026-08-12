"""B75 · P5 — INTEGRATION (live rig)

SURFACE: the same board, painted on three different screens.

P4 asks "does this peer's paint match this peer's model". That question has a
blind spot the whole B70 reading fell into: if a peer's model is ALSO wrong, its
paint and its model agree with each other and the peer reports a clean board
while the owner is looking at a disjointed one. Three readings of one model
agree by construction; this is the reading that does not.

So: take every peer's PAINTED position (the card's own element, de-transformed
back into canvas units by the instrument's production inverse) and require the
peers to agree with each other, node by node.

Deliberately excluded from scoring, with the instrument's own categories:
  * a node that is detached (`virtualize()`) or never painted on EITHER peer —
    there is no painted position to compare;
  * a node that only one peer has (a board mid-sync is not a disjoint board).

Tolerance is the instrument's own `rectToleranceCanvasUnits` — one device pixel
divided by that peer's live scale — taking the LARGER of the two peers', because
a peer zoomed further out has a coarser pixel.
"""
from __future__ import annotations

import argparse
import itertools
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lib_peers import (  # noqa: E402
    add_common_args, census, paint_plane, peers_from_args, result_of, save, unusable, verdict,
)


def painted_positions(plane: dict) -> tuple[dict[str, tuple[float, float]], float, set[str]]:
    """node -> painted (x, y) in canvas units, the tolerance, and the unscorable ids."""
    label = plane.get("label") or {}
    detail = label.get("nodesDetail") or {}
    skip = set(label.get("detachedNodes") or []) | set(label.get("unpaintedNodes") or [])
    tol = label.get("rectToleranceCanvasUnits")
    positions: dict[str, tuple[float, float]] = {}
    for node, d in detail.items():
        rect = d.get("rect")
        if not isinstance(rect, dict):
            skip.add(node)
            continue
        x, y = rect.get("x"), rect.get("y")
        if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
            skip.add(node)
            continue
        positions[node] = (float(x), float(y))
    return positions, float(tol) if isinstance(tol, (int, float)) else 1.0, skip


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="B75 P5 — cross-peer painted geometry agreement")
    add_common_args(ap)
    args = ap.parse_args(argv)
    peers = peers_from_args(args)

    lines: list[str] = []
    ok = True
    raw: dict = {}
    readings: dict[str, tuple[dict, float, set]] = {}

    for name, port in peers.items():
        resp = census(port, args.path)
        raw[name] = {"port": port, "resp": resp}
        why = unusable(resp)
        if why:
            ok = False
            lines.append(f"{name}:{port} INCOMPLETE — {why}")
            continue
        plane = paint_plane(result_of(resp) or {})
        if plane.get("available") is not True:
            ok = False
            lines.append(f"{name}:{port} PAINT PLANE UNAVAILABLE — {plane.get('reason')}")
            continue
        pos, tol, skip = painted_positions(plane)
        readings[name] = (pos, tol, skip)
        lines.append(f"{name}:{port} painted={len(pos)} unscorable={len(skip)} tol={tol:.3f} canvas units")

    if len(readings) < 2:
        ok = False
        lines.append("fewer than two peers produced a readable paint plane — nothing to compare")
        out = save("P5-cross-peer-paint", raw)
        lines.append(f"raw responses: {out}")
        return verdict("P5", ok, lines)

    compared = 0
    for a, b in itertools.combinations(sorted(readings), 2):
        pa, tola, ska = readings[a]
        pb, tolb, skb = readings[b]
        tol = max(tola, tolb)
        shared = (set(pa) & set(pb)) - ska - skb
        lines.append(f"{a} vs {b}: {len(shared)} comparable cards, tolerance {tol:.3f}")
        for node in sorted(shared):
            compared += 1
            dx = pa[node][0] - pb[node][0]
            dy = pa[node][1] - pb[node][1]
            if abs(dx) > tol or abs(dy) > tol:
                ok = False
                lines.append(
                    f"    DISAGREE {node[:20]:<21} {a}={pa[node]} {b}={pb[node]} "
                    f"delta=({dx:+.2f},{dy:+.2f})"
                )

    if compared == 0:
        ok = False
        lines.append("no card was comparable on two peers — this probe measured nothing")

    out = save("P5-cross-peer-paint", raw)
    lines.append(f"raw responses: {out}")
    return verdict("P5", ok, lines)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
