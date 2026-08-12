"""B75 · P6 — INTEGRATION (live rig)

SURFACE: the plugin's own restoring force, on a board nobody is touching.

The plugin runs a periodic repaint sweep that writes cards' transforms back from
the model, and it keeps a counter, `repaired`, of every repaint that landed on a
card whose element was demonstrably in the WRONG PLACE before it ran.

The owner's words: "Cards sometimes reseat themselves now, just to get
disjointed again after the next action." A card reseating itself with nobody
touching the board is what a non-zero `repaired` on a quiescent board IS. So
this probe holds still and watches the counter:

    read repaired -> wait --settle seconds, touching nothing -> read repaired

  * `repaired` increases while nobody acts  -> FAIL. Something is putting cards
    in the wrong place continuously, and the sweep is chasing it. The board may
    LOOK fine at any given instant precisely because the sweep is winning.
  * `ticks == 0`                            -> FAIL. The sweep exists but has
    never run on that peer, so its zero repairs measure nothing (this is the
    `S186`-class false green the diag driver already warns about).
  * counters absent (pre-WP125 bundle)      -> FAIL with that reason, never a
    zero.

It is the only probe here that measures the plugin ACTING on the canvas rather
than the canvas's state, and it needs no gesture from anyone.

KNOWN CONFOUND, stated because it changes how a red is read: Electron throttles
background windows. When this probe runs from a console that has taken focus,
all three Obsidian windows are backgrounded and the sweep's timer may not fire
at all — which shows up here as `ticks=+0`, i.e. "measured nothing", NOT as
"the sweep is broken". The two are distinguished by the `+0` line: `ticks=+0`
is inconclusive, `ticks=+N with repaired=+M` is the real reading. To get the
real reading, put an Obsidian window in the foreground and run this probe alone.
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lib_peers import (  # noqa: E402
    add_common_args, census, peers_from_args, repaint_report, result_of, save, unusable, verdict,
)


def read_counters(port: int, path: str) -> tuple[dict | None, str | None, dict]:
    resp = census(port, path)
    why = unusable(resp)
    if why:
        return None, why, resp
    rep = repaint_report(result_of(resp) or {})
    if not rep:
        return None, "no repaint report on this peer (pre-WP125 bundle) — this is NOT a zero", resp
    if rep.get("available") is not True:
        return None, f"repaint report unavailable — {rep.get('reason')}", resp
    counters = rep.get("counters")
    if not isinstance(counters, dict):
        return None, "repaint report carries no counters object", resp
    return counters, None, resp


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="B75 P6 — repaint sweep on a quiescent board")
    add_common_args(ap)
    ap.add_argument("--settle", type=float, default=8.0,
                    help="seconds to hold still between the two readings (default 8)")
    args = ap.parse_args(argv)
    peers = peers_from_args(args)

    lines: list[str] = []
    ok = True
    raw: dict = {}

    first: dict[str, dict] = {}
    for name, port in peers.items():
        counters, why, resp = read_counters(port, args.path)
        raw[f"{name}-before"] = {"port": port, "resp": resp}
        if why:
            ok = False
            lines.append(f"{name}:{port} INCOMPLETE — {why}")
            continue
        first[name] = counters
        lines.append(
            f"{name}:{port} before  repaired={counters.get('repaired')} "
            f"repainted={counters.get('repainted')} ticks={counters.get('ticks')} "
            f"visited={counters.get('visited')} interacting={counters.get('interacting')}"
        )

    lines.append(f"holding still for {args.settle:.1f}s — no command is sent to any peer")
    time.sleep(args.settle)

    for name, port in peers.items():
        counters, why, resp = read_counters(port, args.path)
        raw[f"{name}-after"] = {"port": port, "resp": resp}
        if why:
            ok = False
            lines.append(f"{name}:{port} INCOMPLETE (second reading) — {why}")
            continue
        if name not in first:
            continue
        before, after = first[name], counters
        d_repaired = (after.get("repaired") or 0) - (before.get("repaired") or 0)
        d_ticks = (after.get("ticks") or 0) - (before.get("ticks") or 0)
        d_repainted = (after.get("repainted") or 0) - (before.get("repainted") or 0)
        sources = after.get("sources") if isinstance(after.get("sources"), dict) else {}
        lines.append(
            f"{name}:{port} after   repaired={after.get('repaired')} (+{d_repaired}) "
            f"repainted={after.get('repainted')} (+{d_repainted}) ticks=+{d_ticks} "
            f"sources={sources}"
        )
        if (after.get("ticks") or 0) == 0:
            ok = False
            lines.append(f"    {name}: ticks=0 — the sweep has NEVER RUN here; its zero repairs measure nothing")
        elif d_ticks == 0:
            ok = False
            lines.append(f"    {name}: the sweep did not tick during the settle window — nothing was measured")
        if d_repaired > 0:
            ok = False
            lines.append(
                f"    {name}: the sweep REPAIRED {d_repaired} card(s) while nobody touched the board — "
                f"cards were in the wrong place and were moved back"
            )

    out = save("P6-quiescent-repaint", raw)
    lines.append(f"raw responses: {out}")
    return verdict("P6", ok, lines)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
