"""B75 · P7 — INTEGRATION (live rig)

SURFACE: "…just to get disjointed again after the NEXT ACTION."

The report names an action as the trigger. Panning and dragging cannot be driven
through the existing control surface (see HARNESS.md, "surfaces not probed"), but
one real user action can: re-opening the board — the thing that happens every
time the owner switches back to that tab. It runs the same view-mount and
structural-repaint path a tab switch does.

The probe: read every card's PAINTED position, re-open the board on each peer,
read them again, and require that no card moved. Nothing else is touched. The
model is not written, no text is typed, no file is edited.

REFUSALS, so this cannot go green for the wrong reason:
  * a peer whose paint plane is unreadable before OR after is INCOMPLETE, never
    a pass;
  * if no card was comparable across the two readings, the probe FAILS as
    "measured nothing" rather than reporting stability it never observed.
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lib_peers import (  # noqa: E402
    add_common_args, census, paint_plane, peers_from_args, post, result_of, save, unusable, verdict,
)


def snapshot(port: int, path: str) -> tuple[dict | None, str | None, float, dict]:
    resp = census(port, path)
    why = unusable(resp)
    if why:
        return None, why, 1.0, resp
    plane = paint_plane(result_of(resp) or {})
    if plane.get("available") is not True:
        return None, f"paint plane unavailable — {plane.get('reason')}", 1.0, resp
    label = plane.get("label") or {}
    detail = label.get("nodesDetail") or {}
    skip = set(label.get("detachedNodes") or []) | set(label.get("unpaintedNodes") or [])
    tol = label.get("rectToleranceCanvasUnits")
    out: dict[str, tuple[float, float]] = {}
    for node, d in detail.items():
        if node in skip:
            continue
        rect = d.get("rect")
        if isinstance(rect, dict) and isinstance(rect.get("x"), (int, float)):
            out[node] = (float(rect["x"]), float(rect["y"]))
    return out, None, float(tol) if isinstance(tol, (int, float)) else 1.0, resp


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="B75 P7 — painted geometry across a board re-open")
    add_common_args(ap)
    ap.add_argument("--settle", type=float, default=3.0,
                    help="seconds to let the re-opened view settle before re-reading (default 3)")
    args = ap.parse_args(argv)
    peers = peers_from_args(args)

    lines: list[str] = []
    ok = True
    raw: dict = {}
    before: dict[str, tuple[dict, float]] = {}

    for name, port in peers.items():
        pos, why, tol, resp = snapshot(port, args.path)
        raw[f"{name}-before"] = {"port": port, "resp": resp}
        if why:
            ok = False
            lines.append(f"{name}:{port} INCOMPLETE (before) — {why}")
            continue
        before[name] = (pos, tol)
        lines.append(f"{name}:{port} before: {len(pos)} painted cards, tol={tol:.3f}")

    for name, port in peers.items():
        r = post(port, "canvas.open", {"path": args.path})
        raw[f"{name}-open"] = {"port": port, "resp": r}
        why = unusable(r)
        if why:
            ok = False
            lines.append(f"{name}:{port} canvas.open REFUSED — {why}")
        else:
            lines.append(f"{name}:{port} canvas.open -> {result_of(r)}")

    lines.append(f"letting the re-opened views settle for {args.settle:.1f}s")
    time.sleep(args.settle)

    compared = 0
    for name, port in peers.items():
        pos, why, tol, resp = snapshot(port, args.path)
        raw[f"{name}-after"] = {"port": port, "resp": resp}
        if why:
            ok = False
            lines.append(f"{name}:{port} INCOMPLETE (after) — {why}")
            continue
        if name not in before:
            continue
        prev, prev_tol = before[name]
        tolerance = max(tol, prev_tol)
        shared = set(prev) & set(pos)
        lines.append(f"{name}:{port} after: {len(pos)} painted cards, {len(shared)} comparable")
        for node in sorted(shared):
            compared += 1
            dx = pos[node][0] - prev[node][0]
            dy = pos[node][1] - prev[node][1]
            if abs(dx) > tolerance or abs(dy) > tolerance:
                ok = False
                lines.append(
                    f"    MOVED {node[:20]:<21} {prev[node]} -> {pos[node]} "
                    f"delta=({dx:+.2f},{dy:+.2f})  [re-opening the board moved a card]"
                )

    if compared == 0:
        ok = False
        lines.append("no card was comparable across the re-open — this probe measured nothing")

    out = save("P7-reopen-stability", raw)
    lines.append(f"raw responses: {out}")
    return verdict("P7", ok, lines)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
