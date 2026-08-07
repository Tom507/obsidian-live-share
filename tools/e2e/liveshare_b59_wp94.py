"""B59 / W4 — ARM 1. WP94's live arm: a real deletion on a CLOSED board.

THE BASELINE TO BEAT (S84, measured by B56 at `1e057e9`, pre-WP94, on this very
board): at deltas 0.3 / 1.0 / 2.0 s, EVERY DELETE was uncaptured at 45 s, while
ADD was captured in 0.0-0.2 s at every delta on the SAME board. The ADD column
is the control: if ADD stops being captured, the rig is broken and no statement
about DELETE is admissible.

THREE PHASES, and phase 2 is the one that makes phase 1 mean anything.

  PHASE 1  THE S84 LADDER, RE-RUN VERBATIM on `wp79-035734-one.canvas` from the
           HOST. Same board, same deltas, same oracle (the WRITER'S OWN doc via
           `canvas.state` — B50's rule, because the peer conflates "never
           captured" with "captured, never delivered"). Directly comparable to
           the pre-fix number.

  PHASE 2  THE RECEIPT DISCRIMINATOR, and the instrument proof. WP94's criterion
           is `Delete(X) ⇔ Receipt(X,surface) ∧ Complete ∧ Present ∧ ¬Seen`, and
           `recordSurfaceObservation` REPLACES a path's receipt set on every
           complete save. So on a path this session has never saved, the FIRST
           save's absences hold no licence and must be WITHHELD; the SECOND
           save's do, because the first save issued them.

           Two rungs, identical gesture, identical board, identical node class —
           the only difference is whether a prior save of the same surface had
           been observed:
             P  delete node X on the FIRST local save of this path  -> WITHHELD
             Q  delete node Y on the SECOND                          -> CAPTURED

           P is also the POSITIVE CONTROL FOR `DELETE WITHHELD:`. That signature
           has zero history on a freshly-installed bundle, so until something
           makes it fire, its silence is UNINFORMATIVE and no absence claim over
           it is admissible (rule 15). Phase 2 makes it fire before phase 1's
           silence is read.

  PHASE 3  THE GUEST DIRECTION. Same ladder driven from the GUEST on a board the
           guest is actually subscribed to (`second-011125.canvas`; the survey
           measured guest `hasWriter=True, doc_nodes=1` there and `doc_nodes=0`
           on the wp79 boards, which is S96 and is why the direction cannot be
           run on the S84 board at all).

S45: `canvas.open` is never called. S85: every settle is a state wait.
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
    log_path,
    read_canvas,
    rule15,
    say,
    snapshot_shared,
    waiter,
    write_canvas_raw,
)

LADDER = f"{SHARED}/wp79-035734-one.canvas"
GUEST_BOARD = f"{SHARED}/second-011125.canvas"
NEEDED = ("session.info", "canvas.state", "canvas.file", "sync.waitQuiescent",
          "canvas.editingSignal")
PREFIX = f"b59-{RUN}"
WITHHELD_SIG = "DELETE WITHHELD:"


def board_regime(role: str, rel: str) -> dict:
    sig = cmd(role, "canvas.editingSignal", path=rel).get("result") or {}
    return {"hasAdapter": sig.get("hasAdapter"), "hasWriter": sig.get("hasWriter"),
            "adapterAvailable": sig.get("adapterAvailable")}


def window_lines(role: str, since: float, needles: tuple[str, ...]) -> list[str]:
    p = log_path(role)
    if not p.exists():
        return []
    out = []
    for ln in p.read_text(encoding="utf-8", errors="replace").splitlines():
        if not any(n in ln for n in needles):
            continue
        try:
            ts = time.mktime(time.strptime(ln[:19], "%Y-%m-%dT%H:%M:%S")) - time.timezone
        except Exception:  # noqa: BLE001
            continue
        if ts >= since - 5:
            out.append(ln.strip()[:260])
    return out


# =========================================================================== #
def ladder(writer: str, peer: str, board: str, label: str) -> dict:
    """S84's exact shape. Every DELETE rung seeds its own node first, so every
    node this phase deletes is one this phase added — nothing pre-existing is at
    stake and the teardown is total by construction."""
    say("")
    say("=" * 78)
    say(f"  {label} — the S84 ladder on {writer} ({ls_b59.ROLES[writer]}), board {board}")
    say("=" * 78)
    reg = board_regime(writer, board)
    say(f"  regime on {writer}: {reg}")
    say("  (hasAdapter=True would mean a LEAF IS OPEN — the arm reports the regime")
    say("   it measured rather than assuming the board is closed.)")

    rows = []
    for delta in (0.3, 1.0, 2.0):
        for shape in ("ADD", "DELETE"):
            nid = f"{PREFIX}-{label}-{shape.lower()}-{str(delta).replace('.', '')}"
            doc = read_canvas(writer, board)
            if doc is None:
                say(f"  !! board missing on {writer} — phase aborted")
                return {"error": "board missing", "regime": reg, "rows": rows}

            if shape == "DELETE":
                doc.setdefault("nodes", []).append(card(nid, 1200, 1200))
                write_canvas_raw(writer, doc, board)
                seeded, t_seed = await_state(
                    f"{nid} is in {writer}'s OWN doc before it is deleted",
                    lambda n=nid: n in doc_ids(writer, board)[0], 60)
                if not seeded:
                    say(f"    delta={delta} {shape}: PRECONDITION FAILED "
                        f"({nid} never reached {writer}'s own doc) — INVALID, not scored")
                    rows.append({"delta": delta, "shape": shape, "valid": False,
                                 "why": "precondition: node never reached the writer's own doc"})
                    continue
                time.sleep(delta)          # the DELTA under test, not a settle
                t0 = time.time()
                doc = read_canvas(writer, board)
                doc["nodes"] = [n for n in doc.get("nodes", []) if n.get("id") != nid]
                write_canvas_raw(writer, doc, board)
                captured, t = await_state(
                    f"the DELETION of {nid} reaches {writer}'s OWN doc",
                    lambda n=nid: n not in doc_ids(writer, board)[0], 45)
            else:
                time.sleep(delta)
                t0 = time.time()
                doc.setdefault("nodes", []).append(card(nid, 1400, 1400))
                write_canvas_raw(writer, doc, board)
                captured, t = await_state(
                    f"the ADDITION of {nid} reaches {writer}'s OWN doc",
                    lambda n=nid: n in doc_ids(writer, board)[0], 45)

            on_peer = nid in doc_ids(peer, board)[0]
            wh = window_lines(writer, t0, (WITHHELD_SIG,))
            say(f"    delta={delta:<4} {shape:<7} captured_in_writer_doc={captured} "
                f"after={t:.1f}s  present_in_peer_doc={on_peer}  withheld_lines={len(wh)}")
            for ln in wh[:3]:
                say(f"        {ln}")
            rows.append({"delta": delta, "shape": shape, "valid": True,
                         "node": nid, "captured": bool(captured), "after_s": round(t, 1),
                         "present_in_peer_doc": on_peer,
                         "withheld_lines": wh[:4],
                         "on_writer_disk": nid in {n.get("id") for n in
                                                   (read_canvas(writer, board) or {})
                                                   .get("nodes", [])}})
    return {"regime": reg, "rows": rows}


# =========================================================================== #
def receipt_discriminator(writer: str, board: str) -> dict:
    """PHASE 2. Two nodes, two saves, one difference: whether a prior save of the
    same surface had been observed. Run on a board created FOR this phase, so no
    pre-existing record is ever a candidate.

    The board is created through `fileop.inject`'s real `create` — B56 measured
    that this rig does NOT notice an externally created file (S95), so a plain
    `Path.write_text` fixture would never be indexed and the phase would score
    an artefact of the rig instead of the product.
    """
    say("")
    say("=" * 78)
    say(f"  PHASE 2 — the receipt discriminator on {writer} ({ls_b59.ROLES[writer]})")
    say("=" * 78)
    x, y = f"{PREFIX}-rd-X", f"{PREFIX}-rd-Y"
    base = {"nodes": [card(x, 0, 0), card(y, 300, 0), card(f"{PREFIX}-rd-keep", 600, 0)],
            "edges": []}
    r = cmd(writer, "fileop.inject", timeout=90,
            op={"type": "create", "path": board, "content": json.dumps(base, indent=2)},
            settleMs=1500)
    say(f"    fixture create -> {json.dumps(r)[:200]}")
    if not ls_b59.vpath(writer, board).exists():
        say("    !! fixture not on disk — phase 2 UNMEASURABLE")
        return {"measurable": False, "why": "fixture create did not land on disk"}

    subscribed, t_sub = await_state(
        f"{writer}'s OWN doc holds the fixture's records",
        lambda: {x, y} <= doc_ids(writer, board)[0], 90)
    reg = board_regime(writer, board)
    say(f"    subscribed={subscribed} after {t_sub:.1f}s  regime={reg}")
    if not subscribed:
        say("    !! the writer's own doc never picked the fixture up — phase 2")
        say("       UNMEASURABLE. This is NOT a WP94 result; it is the S93/S95")
        say("       family showing up in the fixture, and it is reported as such.")
        return {"measurable": False, "regime": reg,
                "why": "writer never subscribed to its own freshly created board",
                "doc_ids": sorted(i for i in doc_ids(writer, board)[0] if i)}

    out: dict = {"measurable": True, "regime": reg, "rungs": []}
    for rung, nid in (("P (first local save on this path)", x),
                      ("Q (second local save on this path)", y)):
        t0 = time.time()
        doc = read_canvas(writer, board)
        doc["nodes"] = [n for n in doc.get("nodes", []) if n.get("id") != nid]
        write_canvas_raw(writer, doc, board)
        gone, t = await_state(f"{nid} leaves {writer}'s OWN doc",
                              lambda n=nid: n not in doc_ids(writer, board)[0], 30)
        wh = window_lines(writer, t0, (WITHHELD_SIG,))
        say(f"    {rung:<38} node={nid} deleted_from_doc={gone} after={t:.1f}s "
            f"withheld_lines={len(wh)}")
        for ln in wh[:4]:
            say(f"        {ln}")
        out["rungs"].append({"rung": rung, "node": nid, "captured": bool(gone),
                             "after_s": round(t, 1), "withheld_lines": wh[:4]})
    return out


# =========================================================================== #
def teardown(board: str, prefix: str) -> dict:
    say("")
    say(f"  ---- teardown of {board} ----")
    for _ in range(6):
        for role in VAULTS:
            d = read_canvas(role, board)
            if d is None:
                continue
            n0 = len(d.get("nodes", []))
            d["nodes"] = [n for n in d.get("nodes", [])
                          if not str(n.get("id", "")).startswith(prefix)]
            if len(d["nodes"]) != n0:
                write_canvas_raw(role, d, board)
            time.sleep(1.5)
        clean, _ = await_state(
            "both replicas free of every node this arm added",
            lambda: not any(str(i).startswith(prefix) for r in VAULTS
                            for i in doc_ids(r, board)[0] if i), 20)
        if clean:
            say("    both docs are free of this arm's nodes")
            break
    left = {r: sorted(i for i in doc_ids(r, board)[0] if i and str(i).startswith(prefix))
            for r in VAULTS}
    if any(left.values()):
        say(f"    teardown INCOMPLETE — {left}")
    return left


def main() -> int:
    if not gate("ARM 1 — WP94's live delete arm", NEEDED, probe_canvas=LADDER):
        say("\nREFUSING TO MEASURE — the gate did not pass.")
        return 2
    h, g = host_role(), guest_role()
    say(f"  HOST = {h}   GUEST = {g}   (asked, not assumed)")
    clamp_report()
    pre = snapshot_shared()
    w = waiter()
    mark = w.mark("arm1")

    out: dict = {"roles": dict(ls_b59.ROLES), "host": h, "guest": g,
                 "withheld_history_before": w.history_hits(WITHHELD_SIG)}
    say(f"  rule-15 control BEFORE the arm: history_hits({WITHHELD_SIG!r}) = "
        f"{out['withheld_history_before']}")
    say("  (zero means the instrument is UNPROVEN and its silence says nothing —")
    say("   phase 2 exists to make it fire before phase 1's silence is read.)")

    scratch = f"{SHARED}/b59-wp94-{RUN}.canvas"
    out["phase2_receipt_discriminator"] = receipt_discriminator(h, scratch)
    out["phase1_host_ladder"] = ladder(h, g, LADDER, "P1host")
    out["phase3_guest_ladder"] = ladder(g, h, GUEST_BOARD, "P3guest")

    out["leftovers"] = {
        LADDER: teardown(LADDER, PREFIX),
        GUEST_BOARD: teardown(GUEST_BOARD, PREFIX),
    }
    say("")
    say(f"  ---- removing the phase-2 scratch board {scratch} ----")
    for role in VAULTS:
        p = ls_b59.vpath(role, scratch)
        if p.exists():
            p.unlink()
            say(f"    removed {role}:{scratch}")
    ok, t = await_state("the scratch board is gone from BOTH vaults",
                        lambda: not any(ls_b59.vpath(r, scratch).exists() for r in VAULTS), 30)
    say(f"    gone from both after {t:.1f}s: {ok}")

    ev = w.collect(mark, ls_b59.RECEIPTS, timeout_s=60)
    say("")
    say(ev.summary())
    out["rule15"] = rule15(ev)

    post = snapshot_shared()
    say("")
    say("  ---- shared trees, before vs after ----")
    for r in VAULTS:
        added = sorted(set(post[r]) - set(pre[r]))
        removed = sorted(set(pre[r]) - set(post[r]))
        say(f"    {r}: added={added} removed={removed}")
        out.setdefault("tree_delta", {})[r] = {"added": added, "removed": removed}
    dump("arm1_wp94", out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
