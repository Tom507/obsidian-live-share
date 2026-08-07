"""B59 / W4 — ARM 5 FOLLOW-UP. The confound my own arm 5 did not control for.

ARM 5 MEASURED A `.md`, AND S95 WAS MEASURED ON A `.canvas`.

Arm 5 found an externally created `.md` reaching the peer in 0.2 s — the exact
opposite of S95's "0 receipts in 90 s". Before that is reported as "S95 does not
reproduce", the one difference between the two measurements has to be removed,
and it is the file EXTENSION. It is not a nuisance variable: `.canvas` is
DELIBERATELY skipped by both manifest-driven consumers (`background-sync.ts`,
`manifest.ts`) — `canvas-mirror-decision.ts`'s own header says so and says why
(a bare-path `Y.Text` over a path `CanvasSync` owns "whose character-level merge
destroys edge endpoints"). So the honest hypothesis is not "create is dropped"
but "a CANVAS create is dropped, and a text create is not".

FOUR ROWS, one variable at a time:

    ext=.md      created EXTERNALLY   (arm 5's row, repeated for this run)
    ext=.canvas  created EXTERNALLY   (S95's row)
    ext=.md      created via INBOUND  (the plugin's own path)
    ext=.canvas  created via INBOUND  (the plugin's own path)

The two INBOUND rows are the control: if a `.canvas` does not propagate by
EITHER route then the extension is not the variable, it is canvas propagation
generally, and the external/inbound comparison says nothing about noticing.

It also clears the one leftover arms 4/5/6 could not remove.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ls_b59  # noqa: E402
from ls_b59 import (  # noqa: E402
    RUN,
    SHARED,
    VAULTS,
    await_state,
    card,
    clamp_report,
    cmd,
    doc_ids,
    dump,
    gate,
    guest_role,
    host_role,
    read_canvas,
    say,
    vpath,
    write_canvas_raw,
)

NEEDED = ("session.info", "fileop.inject", "canvas.state")
PREFIX = f"b59c-{RUN}"
BUDGET = 90.0
LEFTOVER_BOARD = f"{SHARED}/second-011125.canvas"


def clear_leftovers() -> dict:
    """Arms 4/5/6 left one node behind. Remove it from both replicas before
    anything else, and say whether it worked."""
    say("")
    say("  ---- clearing the leftover node from arms 4/5/6 ----")
    stale = [i for x in VAULTS for i in doc_ids(x, LEFTOVER_BOARD)[0]
             if i and str(i).startswith("b59-")]
    stale += [n.get("id") for x in VAULTS
              for n in (read_canvas(x, LEFTOVER_BOARD) or {}).get("nodes", [])
              if str(n.get("id", "")).startswith("b59-")]
    stale = sorted(set(stale))
    say(f"    stale ids found: {stale}")
    for _ in range(6):
        if not stale:
            break
        for x in VAULTS:
            d = read_canvas(x, LEFTOVER_BOARD)
            if d is None:
                continue
            k = len(d.get("nodes", []))
            d["nodes"] = [n for n in d.get("nodes", [])
                          if not str(n.get("id", "")).startswith("b59-")]
            if len(d["nodes"]) != k:
                write_canvas_raw(x, d, LEFTOVER_BOARD)
        time.sleep(2.0)
        left_doc = [i for x in VAULTS for i in doc_ids(x, LEFTOVER_BOARD)[0]
                    if i and str(i).startswith("b59-")]
        left_disk = [n.get("id") for x in VAULTS
                     for n in (read_canvas(x, LEFTOVER_BOARD) or {}).get("nodes", [])
                     if str(n.get("id", "")).startswith("b59-")]
        if not left_doc and not left_disk:
            say("    cleared from both docs and both disks")
            return {"cleared": True, "stale_found": stale}
    left = {x: {"doc": sorted(i for i in doc_ids(x, LEFTOVER_BOARD)[0]
                              if i and str(i).startswith("b59-")),
                "disk": sorted(str(n.get("id")) for n in
                               (read_canvas(x, LEFTOVER_BOARD) or {}).get("nodes", [])
                               if str(n.get("id", "")).startswith("b59-"))}
            for x in VAULTS}
    say(f"    NOT fully cleared: {json.dumps(left)}")
    return {"cleared": False, "stale_found": stale, "left": left}


def row(label: str, h: str, g: str, rel: str, external: bool, is_canvas: bool) -> dict:
    body = (json.dumps({"nodes": [card(f"{PREFIX}-n", 0, 0)], "edges": []}, indent=2)
            if is_canvas else f"b59 {label}\n")
    say("")
    say(f"  ---- {label}: {rel} ----")
    if external:
        p = vpath(h, rel)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(body, encoding="utf-8")
        say("    written STRAIGHT TO DISK by this process (no plugin call at all)")
    else:
        r = cmd(h, "fileop.inject", timeout=90,
                op={"type": "create", "path": rel, "content": body}, settleMs=1500)
        say(f"    created through fileop.inject: "
            f"mutated={(r.get('result') or {}).get('mutated')}")
    got, t = await_state(f"the peer {g} holds {rel} on disk",
                         lambda: vpath(g, rel).exists(), BUDGET)
    say(f"    peer holds it on disk: {got} after {t:.1f}s")
    docn = {x: len(doc_ids(x, rel)[0]) for x in VAULTS} if is_canvas else None
    if docn is not None:
        say(f"    doc node counts: {docn}")
    return {"row": label, "path": rel, "external": external, "canvas": is_canvas,
            "peer_received": bool(got), "after_s": round(t, 1),
            "host_has": vpath(h, rel).exists(), "doc_nodes": docn}


def main() -> int:
    if not gate("ARM 5 FOLLOW-UP — is the dropped create a CANVAS create?", NEEDED):
        say("\nREFUSING TO MEASURE — the gate did not pass.")
        return 2
    h, g = host_role(), guest_role()
    say(f"  HOST = {h}   GUEST = {g}   (asked, not assumed)")
    clamp_report()

    out: dict = {"roles": dict(ls_b59.ROLES), "host": h, "guest": g}
    out["leftover_cleanup"] = clear_leftovers()

    rows = []
    rows.append(row("EXTERNAL create, .md", h, g, f"{SHARED}/{PREFIX}-ext.md", True, False))
    rows.append(row("EXTERNAL create, .canvas", h, g,
                    f"{SHARED}/{PREFIX}-ext.canvas", True, True))
    rows.append(row("INBOUND create, .md", h, g, f"{SHARED}/{PREFIX}-in.md", False, False))
    rows.append(row("INBOUND create, .canvas", h, g,
                    f"{SHARED}/{PREFIX}-in.canvas", False, True))
    out["rows"] = rows

    say("")
    say("  ---- the 2x2 ----")
    say(f"    {'':<22}{'EXTERNAL':<14}{'INBOUND':<14}")
    for ext, canvas in ((".md", False), (".canvas", True)):
        e = next(r for r in rows if r["canvas"] is canvas and r["external"])
        i = next(r for r in rows if r["canvas"] is canvas and not r["external"])
        say(f"    {ext:<22}{str(e['peer_received']) + ' @' + str(e['after_s']) + 's':<14}"
            f"{str(i['peer_received']) + ' @' + str(i['after_s']) + 's':<14}")

    say("")
    say("  ---- teardown ----")
    left = []
    for r in rows:
        cmd(h, "fileop.inject", timeout=45,
            op={"type": "delete", "path": r["path"]}, settleMs=300)
    time.sleep(2)
    for r in rows:
        for x in VAULTS:
            p = vpath(x, r["path"])
            if p.exists():
                try:
                    p.unlink()
                    say(f"    removed {x}:{r['path']}")
                except OSError as e:
                    left.append(f"{x}:{r['path']} ({e})")
    out["leftovers"] = left
    say(f"    leftovers: {left}")
    dump("arm5_canvas_followup", out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
