"""B59 / W4 — ARMS 4, 5 and 6. Three characterisations on one rig setup.

ARM 4 / S93 — WHAT PROTECTS AN EXISTING FILE WHEN NO LEAF IS OPEN?
    B56 measured 150 s of host-with-no-leaf producing NOTHING, and one open leaf
    producing a seed-refusal store entry in 2 s, and widened S80 from "needs an
    attached persistence" to "the protection is a function of whether a tab is
    open". The hypothesis this arm tests is the uncomfortable reading of that:
    that with no leaf there is no PROTECTION at all, only an ABSENCE OF A
    WRITER — and that the seed decision, the only thing that can actually refuse,
    is not consulted until a leaf attaches one. Two states, one board, and the
    leaf is the only variable.

ARM 5 / S95 — AN EXTERNALLY CREATED FILE IS NEVER NOTICED.
    0 receipts in 90 s for a create; an external MODIFY lands in 2.0 s. Same
    watcher, same folder, same process. The control is the modify, run on the
    same instance minutes apart, and it is what turns "create is not seen" from
    "the rig is not watching" into a statement about the product. Where it is
    dropped is then asked of the HOST'S MANIFEST rather than inferred: the
    create handler's host branch calls `manifestManager.updateFile`, so if the
    path is absent from `manifest.info` after a create and present after a
    modify, the drop is upstream of the manifest.

ARM 6 / S96 — A GUEST IS NOT SUBSCRIBED TO A CANVAS IT ALREADY HOLDS.
    The survey already shows it statically: guest `disk_nodes=2`,
    `doc_nodes=0`, `hasWriter=False` on every wp79 board. This arm makes it
    behavioural — the guest's OWN edit to that file is never captured anywhere —
    and pairs it with the board where the same guest DOES hold a writer, which
    is the control that could have failed. Then it opens a leaf and asks whether
    that is the reach-around.

S45 is obeyed everywhere EXCEPT where a leaf is the variable under test, and
there the leaf is opened with `canvas.typeInNode{open:true}` — never
`canvas.open`, which would subscribe the doc as a side effect and destroy the
very distinction arms 4 and 6 exist to measure.
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
    rule15,
    say,
    sha_file,
    snapshot_shared,
    store_entry,
    vpath,
    waiter,
    write_canvas_raw,
)

NEEDED = ("session.info", "canvas.state", "canvas.file", "canvas.editingSignal",
          "fileop.inject", "manifest.info")
PREFIX = f"b59-{RUN}"


def regime(role: str, rel: str) -> dict:
    s = cmd(role, "canvas.editingSignal", path=rel).get("result") or {}
    d = read_canvas(role, rel)
    return {"hasAdapter": s.get("hasAdapter"), "hasWriter": s.get("hasWriter"),
            "adapterAvailable": s.get("adapterAvailable"),
            "disk_nodes": None if d is None else len(d.get("nodes", [])),
            "doc_nodes": len(doc_ids(role, rel)[0])}


def manifest_has(role: str, rel: str) -> tuple[bool, int]:
    r = cmd(role, "manifest.info", timeout=45)
    if not r.get("ok"):
        return False, -1
    res = r.get("result") or {}
    blob = json.dumps(res)
    files = res.get("files")
    n = len(files) if isinstance(files, (list, dict)) else -1
    return (rel in blob), n


# =========================================================================== #
def arm4_s93(h: str, g: str) -> dict:
    say("")
    say("=" * 78)
    say("  ARM 4 / S93 — what protects an EXISTING file with no leaf open?")
    say("=" * 78)
    board = f"{SHARED}/b59-s93-{RUN}.canvas"
    body = {"nodes": [card(f"{PREFIX}-s93-a", 0, 0), card(f"{PREFIX}-s93-b", 300, 0)],
            "edges": []}
    r = cmd(h, "fileop.inject", timeout=90,
            op={"type": "create", "path": board, "content": json.dumps(body, indent=2)},
            settleMs=1500)
    say(f"    fixture create on {h}: mutated={(r.get('result') or {}).get('mutated')}")
    both, t = await_state("both vaults hold the fixture on disk",
                          lambda: all(vpath(x, board).exists() for x in VAULTS), 90)
    say(f"    on both disks: {both} after {t:.1f}s")
    if not both:
        say("    !! fixture not on both sides — ARM 4 UNMEASURABLE")
        return {"measurable": False, "why": "fixture did not replicate"}

    out: dict = {"measurable": True, "board": board}
    say("")
    say("  STATE 1 — no leaf anywhere. The file exists on both sides.")
    out["state1_regime"] = {x: regime(x, board) for x in VAULTS}
    for x in VAULTS:
        say(f"    {x} ({ls_b59.ROLES[x]}): {out['state1_regime'][x]}")
    sha_pre = {x: sha_file(x, board) for x in VAULTS}
    out["sha_state1"] = sha_pre

    say("")
    say("  STATE 1 probe — 90 s with no leaf. Does ANY refusal or store entry appear,")
    say("  and does the file change at all?")
    t0 = time.time()
    seen, ts = await_state(
        "a seed-refusal store entry appears for this board on EITHER side",
        lambda: any(store_entry(x, board) is not None for x in VAULTS), 90)
    out["state1_store_entry"] = {"appeared": bool(seen), "after_s": round(ts, 1),
                                 "entries": {x: store_entry(x, board) for x in VAULTS}}
    say(f"    store entry appeared: {seen} after {ts:.1f}s")
    sha_mid = {x: sha_file(x, board) for x in VAULTS}
    out["sha_after_state1"] = sha_mid
    say(f"    file unchanged on both after the 90 s: "
        f"{ {x: sha_pre[x] == sha_mid[x] for x in VAULTS} }")
    say(f"    (elapsed {time.time() - t0:.0f}s)")

    say("")
    say("  STATE 2 — the ONLY variable changes: a leaf opens on the GUEST.")
    say("  Opened with `canvas.typeInNode{open:true}` (S45) — never `canvas.open`,")
    say("  which would subscribe the doc as a side effect and answer the question")
    say("  by asking it.")
    r = cmd(g, "canvas.typeInNode", timeout=90, path=board,
            nodeId=f"{PREFIX}-s93-a", text="", open=True, blur=True)
    say(f"    typeInNode -> {json.dumps(r)[:260]}")
    opened, to = await_state(f"an adapter attaches on {g}",
                             lambda: regime(g, board)["hasAdapter"] is True, 60)
    say(f"    adapter attached on {g}: {opened} after {to:.1f}s")
    out["state2_regime"] = {x: regime(x, board) for x in VAULTS}
    for x in VAULTS:
        say(f"    {x} ({ls_b59.ROLES[x]}): {out['state2_regime'][x]}")
    seen2, ts2 = await_state(
        "a seed-refusal store entry appears now that a leaf is open",
        lambda: any(store_entry(x, board) is not None for x in VAULTS), 60)
    out["state2_store_entry"] = {"appeared": bool(seen2), "after_s": round(ts2, 1),
                                 "entries": {x: store_entry(x, board) for x in VAULTS}}
    say(f"    store entry appeared: {seen2} after {ts2:.1f}s")
    sha_post = {x: sha_file(x, board) for x in VAULTS}
    out["sha_after_state2"] = sha_post
    say(f"    file unchanged vs state 1: "
        f"{ {x: sha_mid[x] == sha_post[x] for x in VAULTS} }")
    out["nodes_on_disk_after"] = {x: len((read_canvas(x, board) or {}).get("nodes", []))
                                  for x in VAULTS}
    say(f"    nodes on disk after: {out['nodes_on_disk_after']} (fixture had 2)")

    for x in VAULTS:
        p = vpath(x, board)
        if p.exists():
            p.unlink()
    say(f"    teardown: {board} removed from both vaults")
    return out


# =========================================================================== #
def arm5_s95(h: str, g: str) -> dict:
    say("")
    say("=" * 78)
    say("  ARM 5 / S95 — an externally CREATED file vs an externally MODIFIED one")
    say("=" * 78)
    out: dict = {}

    created = f"{SHARED}/{PREFIX}-extcreate.md"
    modified = f"{SHARED}/{PREFIX}-extmodify.md"

    say("")
    say("  (i) EXTERNAL CREATE — written straight to disk by this process, never")
    say("      through the plugin's inbound path.")
    m_before, n_before = manifest_has(h, created)
    vpath(h, created).write_text("b59 external create\n", encoding="utf-8")
    got, t = await_state(f"the peer {g} receives {created}",
                         lambda: vpath(g, created).exists(), 90)
    m_after, n_after = manifest_has(h, created)
    say(f"    peer has it: {got} after {t:.1f}s")
    say(f"    host manifest names the path: before={m_before} after={m_after} "
        f"(manifest entry count {n_before} -> {n_after})")
    out["external_create"] = {"peer_received": bool(got), "after_s": round(t, 1),
                              "manifest_before": m_before, "manifest_after": m_after,
                              "manifest_count_before": n_before,
                              "manifest_count_after": n_after}

    say("")
    say("  (ii) THE CONTROL — the SAME file, now EXTERNALLY MODIFIED. Same process,")
    say("       same folder, same watcher, minutes apart. If this does not land")
    say("       either, the instance is not watching and (i) says nothing.")
    say("       The file is first put on BOTH sides through the plugin's own")
    say("       inbound path, so the modify has an existing shared file to act on.")
    r = cmd(h, "fileop.inject", timeout=90,
            op={"type": "create", "path": modified, "content": "seed v1\n"},
            settleMs=1200)
    say(f"    seeded through fileop.inject: mutated={(r.get('result') or {}).get('mutated')}")
    seeded, ts = await_state(f"the peer {g} holds {modified}",
                             lambda: vpath(g, modified).exists(), 90)
    say(f"    peer holds the seed: {seeded} after {ts:.1f}s")
    if not seeded:
        say("    !! the control's precondition failed — the modify row is NOT scored")
        out["external_modify"] = {"scored": False,
                                  "why": "peer never received the seeded file"}
    else:
        marker = f"b59 external modify {RUN}\n"
        vpath(h, modified).write_text(marker, encoding="utf-8")
        landed, tm = await_state(
            f"the peer {g}'s copy carries the externally written marker",
            lambda: vpath(g, modified).exists()
            and marker.strip() in vpath(g, modified).read_text(encoding="utf-8", errors="replace"),
            90)
        say(f"    peer sees the external modify: {landed} after {tm:.1f}s")
        out["external_modify"] = {"scored": True, "peer_saw_modify": bool(landed),
                                  "after_s": round(tm, 1)}

    say("")
    say("  (iii) SAME PATH, SAME BYTES, THROUGH THE PLUGIN'S INBOUND PATH — the")
    say("        discriminator between 'creates do not propagate' and 'externally")
    say("        made creates are not NOTICED'.")
    inbound = f"{SHARED}/{PREFIX}-inbound.md"
    r = cmd(h, "fileop.inject", timeout=90,
            op={"type": "create", "path": inbound, "content": "b59 inbound create\n"},
            settleMs=1200)
    got3, t3 = await_state(f"the peer {g} receives {inbound}",
                           lambda: vpath(g, inbound).exists(), 90)
    say(f"    peer has it: {got3} after {t3:.1f}s")
    out["inbound_create"] = {"peer_received": bool(got3), "after_s": round(t3, 1)}

    for path in (created, modified, inbound):
        cmd(h, "fileop.inject", timeout=45, op={"type": "delete", "path": path}, settleMs=300)
        for x in VAULTS:
            p = vpath(x, path)
            if p.exists():
                try:
                    p.unlink()
                except OSError:
                    pass
    say("    teardown: all three probe files removed from both vaults")
    return out


# =========================================================================== #
def arm6_s96(h: str, g: str) -> dict:
    say("")
    say("=" * 78)
    say("  ARM 6 / S96 — a guest is not subscribed to a canvas it already holds")
    say("=" * 78)
    unsub = f"{SHARED}/wp79-035734-three.canvas"      # guest: doc_nodes=0 at survey
    subbed = f"{SHARED}/second-011125.canvas"          # guest: hasWriter=True
    out: dict = {"unsubscribed_board": unsub, "control_board": subbed}

    say("")
    say("  regimes on the GUEST before anything is touched:")
    for rel in (unsub, subbed):
        rg = regime(g, rel)
        say(f"    {rel}: {rg}")
        out.setdefault("guest_regime_before", {})[rel] = rg

    say("")
    say("  (i) the guest edits the board it holds but is NOT subscribed to.")
    nid = f"{PREFIX}-s96-unsub"
    d = read_canvas(g, unsub)
    d.setdefault("nodes", []).append(card(nid, 900, 900))
    write_canvas_raw(g, d, unsub)
    cap, t = await_state(f"{nid} reaches the GUEST'S OWN doc",
                         lambda: nid in doc_ids(g, unsub)[0], 45)
    onhost, th = await_state(f"{nid} reaches the HOST'S doc",
                             lambda: nid in doc_ids(h, unsub)[0], 20)
    say(f"    captured into the guest's own doc: {cap} after {t:.1f}s")
    say(f"    reached the host's doc:            {onhost} after {th:.1f}s")
    out["unsubscribed_edit"] = {"captured_locally": bool(cap), "after_s": round(t, 1),
                                "reached_host": bool(onhost)}

    say("")
    say("  (ii) THE CONTROL — the identical gesture by the identical instance in")
    say("       the same minute, on the board where it DOES hold a writer.")
    nid2 = f"{PREFIX}-s96-sub"
    d2 = read_canvas(g, subbed)
    d2.setdefault("nodes", []).append(card(nid2, 900, 900))
    write_canvas_raw(g, d2, subbed)
    cap2, t2 = await_state(f"{nid2} reaches the GUEST'S OWN doc",
                           lambda: nid2 in doc_ids(g, subbed)[0], 45)
    onhost2, th2 = await_state(f"{nid2} reaches the HOST'S doc",
                               lambda: nid2 in doc_ids(h, subbed)[0], 30)
    say(f"    captured into the guest's own doc: {cap2} after {t2:.1f}s")
    say(f"    reached the host's doc:            {onhost2} after {th2:.1f}s")
    out["control_edit"] = {"captured_locally": bool(cap2), "after_s": round(t2, 1),
                           "reached_host": bool(onhost2)}

    say("")
    say("  (iii) the reach-around: open a leaf on the unsubscribed board (S45 form)")
    r = cmd(g, "canvas.typeInNode", timeout=90, path=unsub, nodeId=nid,
            text="", open=True, blur=True)
    say(f"    typeInNode -> {json.dumps(r)[:220]}")
    sub3, t3 = await_state(f"{nid} reaches the guest's doc once a leaf is open",
                           lambda: nid in doc_ids(g, unsub)[0], 60)
    say(f"    now captured locally: {sub3} after {t3:.1f}s   regime={regime(g, unsub)}")
    out["after_leaf"] = {"captured_locally": bool(sub3), "after_s": round(t3, 1),
                         "regime": regime(g, unsub)}

    say("")
    say("  ---- teardown ----")
    for rel, n in ((unsub, nid), (subbed, nid2)):
        for _ in range(4):
            for x in VAULTS:
                dd = read_canvas(x, rel)
                if dd is None:
                    continue
                k = len(dd.get("nodes", []))
                dd["nodes"] = [q for q in dd.get("nodes", []) if q.get("id") != n]
                if len(dd["nodes"]) != k:
                    write_canvas_raw(x, dd, rel)
            time.sleep(1.5)
            clean, _ = await_state(f"{n} gone from both docs and both disks",
                                   lambda rr=rel, nn=n: not any(
                                       nn in doc_ids(x, rr)[0] for x in VAULTS)
                                   and not any(nn in {q.get("id") for q in
                                                      (read_canvas(x, rr) or {}).get("nodes", [])}
                                               for x in VAULTS), 15)
            if clean:
                break
        say(f"    {rel}: {n} removed = {clean}")
        out.setdefault("teardown", {})[rel] = bool(clean)
    return out


def main() -> int:
    if not gate("ARMS 4/5/6 — S93, S95, S96", NEEDED):
        say("\nREFUSING TO MEASURE — the gate did not pass.")
        return 2
    h, g = host_role(), guest_role()
    say(f"  HOST = {h}   GUEST = {g}   (asked, not assumed)")
    clamp_report()
    pre = snapshot_shared()
    w = waiter()
    mark = w.mark("arms456")

    out: dict = {"roles": dict(ls_b59.ROLES), "host": h, "guest": g}
    out["arm4_s93"] = arm4_s93(h, g)
    out["arm5_s95"] = arm5_s95(h, g)
    out["arm6_s96"] = arm6_s96(h, g)

    ev = w.collect(mark, ls_b59.RECEIPTS, timeout_s=90)
    say("")
    say(ev.summary())
    out["rule15"] = rule15(ev)

    post = snapshot_shared()
    say("")
    for r in VAULTS:
        added = sorted(set(post[r]) - set(pre[r]))
        removed = sorted(set(pre[r]) - set(post[r]))
        say(f"    tree {r}: added={added} removed={removed}")
        out.setdefault("tree_delta", {})[r] = {"added": added, "removed": removed}
    dump("arms456", out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
