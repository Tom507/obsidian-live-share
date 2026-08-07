"""B56 / W4 — S79 (characterise, do NOT repair) and S84 (the PRE-WP94 profile).

S79 — "LEFT THE SHARED TREE" DESTROYS THE PEER'S COPY
-----------------------------------------------------
B50 established the fact and attributed it away from WP68: a rename out of the
shared folder loses the peer's file REGARDLESS of destination, including a
destination where WP68's guard cannot fire. What it did not establish is WHICH
GESTURE and WHICH DOOR. This arm asks exactly that and repairs nothing:

  * which op does the moving instance put on the wire — `rename`, or `delete`?
  * does it depend on the destination at all?
  * is it the manifest/cleanup door WP80 and WP86 closed, or the file-op door?

The discriminator is the emitted op, read from the moving instance's own log,
plus whether the peer's loss is accompanied by a `publish[...]` line (manifest
door) or by nothing but a file-op (file-op door).

S84 — A CLOSED BOARD NEVER CAPTURES A DELETION
----------------------------------------------
S78's general form, derived by B52 from `canvas-shadow.ts:567` (rule 4 is gated
on `viewOpen`). WP94 has NOT landed at the commit this bundle was built from, so
what is measured here is the PRE-FIX PROFILE — which is exactly what made B50's
WP91 result trustworthy and costs nothing to take now.

THE CONTROL IS THE WHOLE ARM. "The deletion was not captured" is worthless
without "an addition through the identical gesture on the identical closed board
WAS captured" — otherwise the board is simply not being watched. Every delete
rung is therefore paired with an add rung at the same delta on the same file.

ORACLE: the writer's OWN doc via `canvas.state` (B50's rule — the peer conflates
"never captured" with "captured, never delivered").
S45: `canvas.open` is never called.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, r"H:\tmp")
import ls_b56  # noqa: E402
from ls_b56 import (  # noqa: E402
    RUN,
    SHARED,
    VAULTS,
    await_state,
    clamp_report,
    cmd,
    doc_ids,
    dump,
    gate,
    guest_role,
    host_role,
    log_path,
    read_canvas,
    say,
    sha_file,
    snapshot_shared,
    vpath,
    waiter,
    write_canvas_raw,
)

LADDER = f"{SHARED}/wp79-035734-one.canvas"
NEEDED = ("session.info", "canvas.state", "canvas.file", "sync.waitQuiescent")
PREFIX = f"b56-{RUN}"


def card(nid: str, x: int, y: int) -> dict:
    return {"id": nid, "type": "text", "text": nid, "x": x, "y": y,
            "width": 160, "height": 80}


def mark_lines(role: str, since: float, needles: tuple[str, ...]) -> list[str]:
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
            out.append(ln)
    return out


# =========================================================================== #
def s79(mover: str, peer: str) -> dict:
    say("")
    say("=" * 78)
    say(f"  S79 — a shared file leaves the shared tree on {mover}")
    say("=" * 78)
    rows = {}

    for label, dest in (("vault_root", f"b56-s79-{RUN}-root.canvas"),
                        ("sidecar", f".obsidian/liveshare/state/b56-s79-{RUN}-sc.canvas"),
                        ("inside_tree", f"{SHARED}/b56-s79-{RUN}-moved.canvas")):
        src = f"{SHARED}/b56-s79-{RUN}-{label}.canvas"
        say("")
        say(f"  [{label}] {src} -> {dest}")

        # The fixture has to be one Obsidian has INDEXED, and this rig does not
        # notice an externally created file (measured: 0 receipts in 90 s). So
        # the fixture is created through the product's own inbound path with
        # `fileop.inject`, which is a real `create` on the real vault.
        r = cmd(mover, "fileop.inject", timeout=60,
                op={"type": "create", "path": src,
                    "content": json.dumps({"nodes": [card(f"{PREFIX}-s79", 0, 0)],
                                           "edges": []}, indent=2)},
                settleMs=1200)
        made = (r.get("result") or {}).get("mutated")
        got_peer, t_peer = await_state(
            f"the peer {peer} replicates {src}",
            lambda: vpath(peer, src).exists(), 60)
        say(f"    fixture created={made}  peer has it after {t_peer:.1f}s: "
            f"{vpath(peer, src).exists()}")
        if not vpath(mover, src).exists() or not got_peer:
            say("    !! fixture not established on both sides — row SKIPPED, not scored")
            rows[label] = {"skipped": "fixture not on both sides"}
            continue

        t0 = time.time()
        srcp, dstp = vpath(mover, src), vpath(mover, dest)
        dstp.parent.mkdir(parents=True, exist_ok=True)
        srcp.replace(dstp)                     # the gesture: a move, on disk
        say(f"    moved on disk at {time.strftime('%H:%M:%S')}")

        lost, t_lost = await_state(
            f"the peer {peer} LOSES its copy at the old path",
            lambda: not vpath(peer, src).exists(), 90)
        say(f"    peer lost its copy: {lost} after {t_lost:.1f}s")
        say(f"    peer has the destination: {vpath(peer, dest).exists()}")

        ops = mark_lines(mover, t0, ("file-op", "emit", "publish", "cleanup",
                                     "trash", "manifest"))
        say(f"    {mover} log lines in the window naming an op/manifest path: {len(ops)}")
        for ln in ops[:12]:
            say(f"      {ln.strip()[:205]}")
        peer_ops = mark_lines(peer, t0, ("file-op", "trash", "cleanup", "publish"))
        say(f"    {peer} log lines: {len(peer_ops)}")
        for ln in peer_ops[:12]:
            say(f"      {ln.strip()[:205]}")

        rows[label] = {
            "src": src, "dest": dest,
            "peer_lost_old_path": bool(lost),
            "peer_lost_after_s": t_lost if lost else None,
            "peer_has_destination": vpath(peer, dest).exists(),
            "mover_lines": [l.strip()[:220] for l in ops[:20]],
            "peer_lines": [l.strip()[:220] for l in peer_ops[:20]],
        }

        # teardown: remove whatever this row left, on both sides
        for r_ in VAULTS:
            for pth in (src, dest):
                p = vpath(r_, pth)
                if p.exists():
                    p.unlink()
                    say(f"    cleanup: removed {r_}:{pth}")
    return rows


# =========================================================================== #
def s84(writer: str, peer: str) -> dict:
    say("")
    say("=" * 78)
    say(f"  S84 — the closed-board deletion ladder on {writer} (PRE-WP94 profile)")
    say("=" * 78)

    sig = cmd(writer, "canvas.editingSignal", path=LADDER).get("result") or {}
    say(f"  board state on {writer}: hasAdapter={sig.get('hasAdapter')} "
        f"hasWriter={sig.get('hasWriter')} adapterAvailable={sig.get('adapterAvailable')}")
    say("  (hasAdapter=True means a LEAF IS OPEN on this board — the arm reports")
    say("   which regime it measured rather than assuming the board is closed.)")
    board_open = bool(sig.get("hasAdapter"))

    rows = []
    for delta in (0.3, 1.0, 2.0):
        for shape in ("ADD", "DELETE"):
            nid = f"{PREFIX}-s84-{shape.lower()}-{str(delta).replace('.', '')}"
            doc = read_canvas(writer, LADDER)
            if doc is None:
                say("  !! ladder board missing — arm aborted")
                return {"error": "ladder board missing"}

            if shape == "DELETE":
                # PRECONDITION: the node must be present in BOTH docs first, or
                # "the deletion was not captured" is unfalsifiable.
                doc.setdefault("nodes", []).append(card(nid, 1200, 1200))
                write_canvas_raw(writer, doc, LADDER)
                # PRECONDITION, CORRECTED AND SAID OUT LOUD. B50 required the
                # node on BOTH peers. That is unmeetable on this rig: the guest
                # is not subscribed to this board at all (mirror ->
                # SKIP_LOCAL_FILE, no leaf -> no lazy subscribe), so it has no
                # doc to hold anything. The question S84 asks is about the
                # WRITER'S OWN doc, so the precondition is the writer's own doc
                # and the peer's state is recorded separately rather than
                # conflated into it.
                seeded, t_seed = await_state(
                    f"{nid} is in {writer}'s OWN doc before it is deleted",
                    lambda: nid in doc_ids(writer, LADDER)[0], 60)
                if not seeded:
                    say(f"    delta={delta} {shape}: PRECONDITION FAILED "
                        f"({nid} never reached {writer}'s own doc) — INVALID, not scored")
                    rows.append({"delta": delta, "shape": shape, "valid": False,
                                 "why": "precondition: node never reached the writer's own doc"})
                    continue
                time.sleep(delta)
                doc = read_canvas(writer, LADDER)
                doc["nodes"] = [n for n in doc.get("nodes", []) if n.get("id") != nid]
                write_canvas_raw(writer, doc, LADDER)
                captured, t = await_state(
                    f"the DELETION of {nid} reaches {writer}'s OWN doc",
                    lambda: nid not in doc_ids(writer, LADDER)[0], 45)
            else:
                time.sleep(delta)
                doc.setdefault("nodes", []).append(card(nid, 1400, 1400))
                write_canvas_raw(writer, doc, LADDER)
                captured, t = await_state(
                    f"the ADDITION of {nid} reaches {writer}'s OWN doc",
                    lambda: nid in doc_ids(writer, LADDER)[0], 45)

            on_peer = nid in doc_ids(peer, LADDER)[0]
            say(f"    delta={delta:<4} {shape:<7} captured_in_writer_doc={captured} "
                f"after={t:.1f}s  present_in_peer_doc={on_peer}")
            rows.append({"delta": delta, "shape": shape, "valid": True,
                         "node": nid, "captured": bool(captured), "after_s": round(t, 1),
                         "present_in_peer_doc": on_peer,
                         "on_writer_disk": nid in {n.get("id") for n in
                                                   (read_canvas(writer, LADDER) or {})
                                                   .get("nodes", [])}})

    # teardown: every node this arm added, from both replicas
    say("")
    say("  ---- teardown of the ladder board ----")
    for attempt in range(6):
        for role in VAULTS:
            d = read_canvas(role, LADDER)
            if d is None:
                continue
            n0 = len(d.get("nodes", []))
            d["nodes"] = [n for n in d.get("nodes", [])
                          if not str(n.get("id", "")).startswith(PREFIX)]
            if len(d["nodes"]) != n0:
                write_canvas_raw(role, d, LADDER)
            time.sleep(1.5)
        clean, _ = await_state(
            "both replicas free of every node this arm added",
            lambda: not any(str(i).startswith(PREFIX) for r in VAULTS
                            for i in doc_ids(r, LADDER)[0] if i), 20)
        if clean:
            say("  teardown: both docs are free of this arm's nodes")
            break
    left = {r: sorted(i for i in doc_ids(r, LADDER)[0] if i and str(i).startswith(PREFIX))
            for r in VAULTS}
    if any(left.values()):
        say(f"  teardown INCOMPLETE — {left}")
    return {"board_open_on_writer": board_open, "rows": rows, "left_over": left}


def main() -> int:
    if not gate("S79 + S84", NEEDED, probe_canvas=LADDER):
        say("\nREFUSING TO MEASURE — the gate did not pass.")
        return 2
    h, g = host_role(), guest_role()
    say(f"  HOST = {h}   GUEST = {g}   (asked, not assumed)")
    clamp_report()
    pre = snapshot_shared()

    out = {"roles": dict(ls_b56.ROLES), "host": h, "guest": g}
    # MEASURED, and it is why the first attempt scored nothing: an instance is
    # subscribed to a shared canvas only where a leaf has opened one, plus the
    # HOST's own mirror-pass subscriptions. On this rig the guest holds every
    # shared file already (mirror -> SKIP_LOCAL_FILE) and had no leaf, so it had
    # NO doc, NO writer and NO adapter for the ladder board — and its ADD control
    # therefore failed, which is exactly what the control is for. Both arms are
    # driven from the HOST, and S84 uses a board with hasAdapter=False so the
    # regime under test really is a CLOSED one.
    out["s79_from_host"] = s79(h, g)
    out["s84"] = s84(h, g)

    post = snapshot_shared()
    say("")
    say("  ---- shared trees, before vs after ----")
    for r in VAULTS:
        added = sorted(set(post[r]) - set(pre[r]))
        removed = sorted(set(pre[r]) - set(post[r]))
        say(f"    {r}: added={added} removed={removed}")
        out.setdefault("tree_delta", {})[r] = {"added": added, "removed": removed}
    dump("s79_s84", out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
