"""B68 (`S188`) — THE HUMAN-READABLE SIDE OF THE CANVAS-DISJOINT DIAGNOSTIC.

THE ONE SENTENCE
----------------
The owner clicks ONCE; this prints what that click did, on all three peers, in
all FOUR planes, with a cause for every move it can attribute and a loud
``UNATTRIBUTED`` row for every move it cannot.

B71 (`S192`) — THE FOURTH PLANE
-------------------------------
``view``, ``doc`` and ``file`` are three readings of ONE MODEL, so they agree
with each other by construction whenever the sync is working. B70 measured
exactly that — eleven nodes, three peers, three identical planes, taken twice,
the second time while the owner's screen was visibly disjointed. The instrument
could not see the symptom because it was never pointed at it. ``paint`` reads the
card's own DOM element, so it is the only plane that can disagree, and
``PAINT vs MODEL`` is printed before every other table.

WHAT IT IS FOR
--------------
The primary consumer is a live guided session read by a person under time
pressure with the owner waiting. So: one table, flags in the right margin, and a
causal story merged by wall clock. Not an event stream.

THREE THINGS IT REFUSES TO DO
-----------------------------
1. **It never prints a table it cannot vouch for.** Any peer that returns
   non-200, or ``armed: false``, or no ``diagProto``, produces
   ``INCOMPLETE — <peer>: <reason>`` and the table is withheld. A partial table
   is worse than none: it looks exactly like a converged board.
2. **It never says "converged".** There is no verdict field anywhere in this
   file. It prints flags and it refuses on incompleteness; the reading is the
   human's.
3. **It never judges on bytes** (R5, ``S174``/``S177``: three stable byte
   spellings of one identical board were measured live). ``size``/``sha256``
   appear as a label beside the file plane and are never compared.

`S186` — LOSING THE RECORD
--------------------------
The console silently stopped capturing for eleven minutes during the last live
run, and one arm was lost to a driver caching stale targets. Therefore:

  * every raw response is written to
    ``workflowArtifacts/canvas-v2/diag/<label>-<peer>.json`` **before** anything
    is printed, and the paths are printed. The table is a rendering of files on
    disk, not of something that lived only in a console.
  * ports are resolved freshly on every invocation. Nothing is cached.
  * ``dropped > 0`` on any peer is surfaced in the header AND as a flag.

USAGE
-----
::

    python tools/e2e/canvas_diag.py --ports 39431,39432,39433 \
        --path "_liveshare-test/Board.canvas" --op census --label orient
    python tools/e2e/canvas_diag.py --ports 39431,39432,39433 \
        --path "_liveshare-test/Board.canvas" --op arm   --label click-1
    #   ... the owner performs EXACTLY ONE gesture, then:
    python tools/e2e/canvas_diag.py --ports 39431,39432,39433 \
        --path "_liveshare-test/Board.canvas" --op dump  --label click-1
    python tools/e2e/canvas_diag.py --ports 39431,39432,39433 --op clear

Peer labels default to ``A``/``B``/``C`` in the order the ports are given, and
``session.info`` is read on every call so a role that migrated between arms is
visible rather than assumed.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Optional

# The canonical artifact root. Written BEFORE anything is printed (`S186`).
DIAG_DIR = Path(__file__).resolve().parents[2] / "workflowArtifacts" / "canvas-v2" / "diag"

PEER_NAMES = ["A", "B", "C", "D", "E", "F"]

# B71 (`S192`) — FOUR PLANES, AND THE ORDER IS THE READING ORDER.
#
# `view`, `doc` and `file` are three readings of ONE MODEL — the canvas node
# object, that record in the Y.Doc, that record on disk. When the sync works they
# agree BY CONSTRUCTION, which is why B70's drag showed three identical planes on
# three peers while the owner's screen was visibly disjointed. `paint` is the
# pixels: the card's own DOM element. It is the only plane here that can disagree
# with the other three, so it is printed FIRST and it is the one to read first.
PLANES = ("paint", "view", "doc", "file")

# The dump shape that first carried `paint`. A peer below this has three planes
# and cannot answer a paint question; saying so is not the same as saying the
# board is fine (R7).
PAINT_PLANE_PROTO = 2

# The live session runs on a Windows console whose default codec is cp1252, and
# `⚠` is not in it. An UnicodeEncodeError halfway through the table would lose
# the rest of the reading — the `S186` failure wearing a new hat — so stdout is
# reconfigured to UTF-8 and, if even that is refused, the flag degrades to ASCII
# rather than taking the table down with it.
FLAG = "⚠"
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    FLAG = "!!"


# --------------------------------------------------------------------------- #
# transport — one envelope, resolved fresh, raw response always kept
# --------------------------------------------------------------------------- #
def post(port: int, cmd: str, args: Optional[dict] = None, timeout: float = 30.0) -> dict:
    """POST one command. NEVER raises: a transport failure is a reading too.

    The body field is ``cmd``. It is not ``command`` — a wrong field returns a
    400 that a careless parser reads as "no answer".
    """
    body = json.dumps({"cmd": cmd, "args": args or {}}).encode()
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/command",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return {"status": r.status, "body": json.loads(r.read().decode())}
    except urllib.error.HTTPError as e:  # a 400 carries the refusal REASON
        try:
            payload = json.loads(e.read().decode())
        except Exception:  # noqa: BLE001
            payload = None
        return {"status": e.code, "body": payload}
    except Exception as e:  # noqa: BLE001
        return {"status": 0, "body": None, "transport": f"{type(e).__name__}: {e}"}


def fmt_geo(geo: Optional[dict]) -> str:
    if not isinstance(geo, dict):
        return "—"
    return f"({geo.get('x')},{geo.get('y')})"


def fmt_size(geo: Optional[dict]) -> str:
    if not isinstance(geo, dict):
        return ""
    return f"{geo.get('width')}x{geo.get('height')}"


# --------------------------------------------------------------------------- #
# the refusal (§3.4) — this runs BEFORE any table is printed
# --------------------------------------------------------------------------- #
def check_peer(name: str, op: str, resp: dict) -> Optional[str]:
    """``None`` when this peer's answer is usable; otherwise the reason it is not."""
    if resp.get("transport"):
        return f"transport failed: {resp['transport']}"
    if resp.get("status") != 200:
        body = resp.get("body")
        err = body.get("error") if isinstance(body, dict) else None
        if resp.get("status") == 400 and isinstance(err, str) and "unknown cmd" in err:
            return "NO_DIAG — this peer's bundle has no canvas.diag (pre-B68 build)"
        return f"HTTP {resp.get('status')}: {err or body}"
    body = resp.get("body")
    if not isinstance(body, dict) or body.get("ok") is not True:
        return f"envelope not ok: {body}"
    result = body.get("result")
    if not isinstance(result, dict):
        return f"result is not an object: {result!r}"
    if result.get("diagProto") is None:
        return "diagProto absent — this peer has no diag build (§4)"
    if op in ("arm",) and result.get("armed") is not True:
        return "armed !== true"
    if op in ("dump",) and result.get("armed") is not True:
        return "not armed at dump time — the ring has no arm census to diff against"
    return None


def census_of(result: dict) -> dict:
    c = result.get("census")
    return c if isinstance(c, dict) else {}


def plane(census: dict, name: str) -> dict:
    p = census.get(name)
    return p if isinstance(p, dict) else {}


# --------------------------------------------------------------------------- #
# rendering
# --------------------------------------------------------------------------- #
def print_header(label: str, op: str, peers: list[dict]) -> None:
    print()
    print(f"=== {label} : op={op} ===")
    bits = []
    for p in peers:
        info = p.get("info") or {}
        bits.append(
            f"{p['name']}={p['port']} {info.get('role') or '?'} "
            f"build={(info.get('pluginBuild') or '?')} vault={(info.get('vaultName') or '?')}"
        )
    print("peers: " + "  ".join(bits))
    ring = []
    for p in peers:
        r = p.get("result") or {}
        events = r.get("events")
        if isinstance(events, list):
            ring.append(f"{p['name']} {len(events)} rows ({r.get('dropped', 0)} dropped)")
    if ring:
        print("ring: " + " · ".join(ring))
    for p in peers:
        r = p.get("result") or {}
        for note in r.get("notes") or []:
            print(f"NOTE {p['name']}: {note}")


def print_plane_availability(peers: list[dict]) -> None:
    """R7 — a plane that could not be read says why, before any cell is printed."""
    for p in peers:
        result = p.get("result") or {}
        census = census_of(result)
        proto = result.get("diagProto")
        for name in PLANES:
            pl = plane(census, name)
            if not pl and name == "paint":
                # B71/R7 — a peer with no paint plane must SAY it has none. Absent
                # is not "agrees"; three model planes agreeing is exactly what the
                # broken board already looked like.
                print(
                    f"PLANE {p['name']} PAINT ABSENT — this peer's dump is diagProto="
                    f"{proto} (< {PAINT_PLANE_PROTO}); its bundle has no paint plane, "
                    f"so NOTHING here has looked at the pixels on this peer"
                )
            elif pl and pl.get("available") is not True:
                print(f"PLANE {p['name']} {name.upper():5} UNAVAILABLE — {pl.get('reason')}")
            elif pl.get("truncated"):
                print(f"PLANE {p['name']} {name.upper():5} TRUNCATED at the node cap "
                      f"(count={pl.get('count')})")
            elif name == "file" and pl.get("degraded") is True:
                print(f"PLANE {p['name']} FILE DEGRADED — parseCanvasReport could not read it")
            elif name == "paint" and pl.get("available") is True:
                lbl = pl.get("label") or {}
                counts = lbl.get("sourceCounts") or {}
                vp = lbl.get("viewport")
                print(
                    f"PLANE {p['name']} PAINT read from {lbl.get('primarySource')} — "
                    f"sources={counts} viewport={vp} "
                    f"rectTol={lbl.get('rectToleranceCanvasUnits')}"
                )
                if lbl.get("unreadableNodes"):
                    print(
                        f"PLANE {p['name']} PAINT UNREADABLE NODES "
                        f"{lbl['unreadableNodes']} — these are BLANK cells below, "
                        f"not stationary cards"
                    )


def print_paint_divergence(peers: list[dict]) -> None:
    """B71 (`S192`) — THE HEADLINE. Model vs pixels, per node, per peer.

    Printed before every other table because it is the only reading in this file
    that compares two DIFFERENT things. ``view``/``doc``/``file`` are three
    readings of one model and agree by construction; a divergence here is a card
    whose model says one thing and whose element is somewhere else.
    """
    print()
    print("PAINT vs MODEL  (nodeEl geometry vs canvas.nodes[id].x/y — the only cross-check here)")
    saw_any = False
    for p in peers:
        result = p.get("result") or {}
        pl = plane(census_of(result), "paint")
        if not pl:
            print(f"  {p['name']}: NO PAINT PLANE (diagProto={result.get('diagProto')}) — not measured")
            continue
        if pl.get("available") is not True:
            print(f"  {p['name']}: UNAVAILABLE — {pl.get('reason')}")
            continue
        saw_any = True
        lbl = pl.get("label") or {}
        detail = lbl.get("nodesDetail") or {}
        divergent = lbl.get("divergentNodes") or []
        agree = sum(1 for d in detail.values() if d.get("verdict") == "agree")
        unread = sum(1 for d in detail.values() if d.get("verdict") == "unreadable")
        print(
            f"  {p['name']}: {len(divergent)} DIVERGENT · {agree} agree · "
            f"{unread} unreadable  (of {pl.get('count')} live nodes)"
        )
        for node in sorted(divergent):
            d = detail.get(node) or {}
            off = d.get("offset") or {}
            print(
                f"      {FLAG} {node[:20]:<21} model={fmt_geo(d.get('model'))} "
                f"style={fmt_geo(d.get('styleTransform'))} rect={fmt_geo(d.get('rect'))} "
                f"offset=({off.get('dx')},{off.get('dy')}) "
                f"[style={d.get('styleVerdict')} rect={d.get('rectVerdict')}]"
            )
        for node, d in sorted(detail.items()):
            if d.get("verdict") != "unreadable":
                continue
            print(f"      ?  {node[:20]:<21} UNREADABLE — {d.get('reason')}")
    if not saw_any:
        print("  (no peer produced a readable paint plane — see the reasons above)")


def all_node_ids(peers: list[dict], keys: tuple[str, ...]) -> list[str]:
    ids: set[str] = set()
    for p in peers:
        r = p.get("result") or {}
        for key in keys:
            census = r.get(key)
            if not isinstance(census, dict):
                continue
            for name in PLANES:
                nodes = plane(census, name).get("nodes")
                if isinstance(nodes, dict):
                    ids.update(nodes.keys())
    return sorted(ids)


def print_census_table(peers: list[dict]) -> None:
    """The nine-cell table: three planes × three peers, one row per node+plane."""
    ids = all_node_ids(peers, ("census",))
    if not ids:
        print("(no nodes on any plane of any peer)")
        return
    head = f"{'NODE':<14}{'PLANE':<7}"
    for p in peers:
        head += f"{p['name']:<16}"
    print()
    print(head + "FLAG")
    for node in ids:
        for name in PLANES:
            cells = []
            for p in peers:
                nodes = plane(census_of(p.get("result") or {}), name).get("nodes") or {}
                cells.append(nodes.get(node))
            row = f"{node[:13]:<14}{name:<7}"
            for c in cells:
                row += f"{fmt_geo(c):<16}"
            present = [c for c in cells if isinstance(c, dict)]
            flag = ""
            if len(present) > 1 and any(
                (c.get("x"), c.get("y")) != (present[0].get("x"), present[0].get("y"))
                for c in present
            ):
                flag = f"{FLAG} {name.upper()} DISAGREES ACROSS PEERS"
            print(row + flag)


def print_delta_table(peers: list[dict]) -> None:
    """armed → dumped, per node per plane, per peer. The `I8` frame."""
    ids = all_node_ids(peers, ("armCensus", "census"))
    if not ids:
        print("(no nodes on any plane of any peer)")
        return
    print()
    print(f"{'NODE':<14}{'PLANE':<7}{'PEER':<6}{'ARMED':<16}{'DUMPED':<16}DELTA")
    for node in ids:
        for name in PLANES:
            for p in peers:
                r = p.get("result") or {}
                a = plane(r.get("armCensus") or {}, name).get("nodes") or {}
                d = plane(r.get("census") or {}, name).get("nodes") or {}
                av, dv = a.get(node), d.get(node)
                if av is None and dv is None:
                    continue
                delta = ""
                if isinstance(av, dict) and isinstance(dv, dict):
                    dx = dv.get("x", 0) - av.get("x", 0)
                    dy = dv.get("y", 0) - av.get("y", 0)
                    if dx or dy:
                        delta = f"({dx:+g},{dy:+g})"
                elif av is None:
                    delta = "APPEARED"
                elif dv is None:
                    delta = "VANISHED"
                if not delta:
                    continue
                print(
                    f"{node[:13]:<14}{name:<7}{p['name']:<6}"
                    f"{fmt_geo(av):<16}{fmt_geo(dv):<16}{delta}"
                )


def print_story(peers: list[dict]) -> None:
    """Every ledger row from every peer, merged by wall clock."""
    rows: list[tuple[int, str, dict]] = []
    base: Optional[int] = None
    for p in peers:
        for ev in (p.get("result") or {}).get("events") or []:
            t = ev.get("t")
            if not isinstance(t, (int, float)):
                continue
            base = t if base is None else min(base, t)
            rows.append((int(t), p["name"], ev))
    if not rows:
        print()
        print("CAUSAL STORY: (no ledger rows — steps 3-6 not armed, or nothing ran)")
        return
    rows.sort(key=lambda r: r[0])
    print()
    print("CAUSAL STORY (merged by wall clock)")
    for t, peer, ev in rows:
        offset = (t - (base or t)) / 1000.0
        print(f"  {offset:+8.3f} {peer}  {ev.get('kind', '?'):<11}{summarise(ev)}")


def summarise(ev: dict) -> str:
    """One line per ledger row. Verbose enough to read, short enough to scan."""
    kind = ev.get("kind")
    if kind == "mark":
        return f"---- {ev.get('label')} ----"
    if kind == "probe":
        # The deploy detector. expireSweepPresent=False IS a pre-WP120 bundle;
        # that absence is a reading, and §4.2's A/B turns on it.
        return (
            f"presence={ev.get('hasPresence')} awareness={ev.get('hasAwareness')} "
            f"myClientId={ev.get('myClientId')} reconcileSweep={ev.get('reconcileSweepPresent')} "
            f"expireSweep={ev.get('expireSweepPresent')} "
            f"lockedNodesReadable={ev.get('lockedNodesReadable')} "
            f"lockMetaReadable={ev.get('lockMetaReadable')} "
            f"locksAtArm={ev.get('lockedNodesAtArm')}"
        )
    if kind == "applyGeom":
        return (
            f"{ev.get('nodeId')} {fmt_geo(ev.get('from'))} -> {fmt_geo(ev.get('to'))} "
            f"outcome={ev.get('outcome')} cause={ev.get('cause')}"
        )
    if kind == "setData":
        moved = ev.get("moved") or []
        head = f"ok={ev.get('ok')} nodes={ev.get('nodeCount')} cause={ev.get('cause')} moved={len(moved)}"
        for m in moved[:8]:
            head += f"\n{'':>26}{m.get('nodeId')} {fmt_geo(m.get('from'))} -> {fmt_geo(m.get('to'))}"
        return head
    if kind == "ytxn":
        head = (
            f"origin={ev.get('origin')} local={ev.get('local')} "
            f"changed={len(ev.get('changed') or [])}"
        )
        for c in (ev.get("changed") or [])[:8]:
            head += f"\n{'':>26}{c.get('nodeId')} {fmt_geo(c.get('from'))} -> {fmt_geo(c.get('to'))}"
        return head
    if kind == "reconcile":
        return (
            f"entered candidates={ev.get('candidates')} reverted={ev.get('revertedCount')} "
            f"declined={ev.get('declinedCount')} perNode={json.dumps(ev.get('perNode') or [])}"
        )
    if kind == "expire":
        return (
            f"entered present={ev.get('present')} heldBefore={ev.get('heldBefore')} "
            f"expired={ev.get('expired')} perExpired={json.dumps(ev.get('perExpired') or [])}"
        )
    if kind == "viewport":
        return f"{json.dumps(ev.get('viewport'))}"
    return json.dumps({k: v for k, v in ev.items() if k not in ("t", "kind")})


def print_unattributed(peers: list[dict]) -> None:
    """`I8`. The row to read first: a move no ledger row explains."""
    print()
    print("UNATTRIBUTED (view/doc/file deltas no ledger row explains)")
    any_row = False
    for p in peers:
        for row in (p.get("result") or {}).get("unattributed") or []:
            any_row = True
            print(
                f"  {p['name']}  {row.get('plane'):<5} {row.get('nodeId')} "
                f"{fmt_geo(row.get('from'))} -> {fmt_geo(row.get('to'))}  {row.get('note', '')}"
            )
    if not any_row:
        print("  (none)")


def print_awareness(peers: list[dict]) -> None:
    printed = False
    for p in peers:
        aw = (p.get("result") or {}).get("awareness")
        if not isinstance(aw, dict):
            continue
        if not printed:
            print()
            print("AWARENESS")
            printed = True
        if aw.get("available") is not True:
            print(f"  {p['name']}: unavailable — {aw.get('reason')}")
            continue
        print(f"  {p['name']}: myClientId={aw.get('myClientId')} peers={len(aw.get('peers') or [])} "
              f"lockMeta={aw.get('lockMeta')}")
        for peer in aw.get("peers") or []:
            locked = peer.get("lockedNodes") or {}
            phantom = f" {FLAG} PHANTOM (typing) PILL" if (
                peer.get("nodeId") is not None and not locked
            ) else ""
            print(
                f"      client={peer.get('clientId')} path={peer.get('canvasPath')} "
                f"nodeId={peer.get('nodeId')} locks={len(locked)} "
                f"{sorted(locked.keys())} epochs={peer.get('epochs')}{phantom}"
            )


# --------------------------------------------------------------------------- #
# main
# --------------------------------------------------------------------------- #
def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="B68 canvas-disjoint diagnostic reader")
    ap.add_argument("--ports", required=True, help="comma-separated control ports, in peer order")
    ap.add_argument("--path", default=None, help="the .canvas path under test")
    ap.add_argument(
        "--op",
        default="dump",
        choices=["census", "arm", "mark", "dump", "awareness", "clear"],
    )
    ap.add_argument("--label", default=None, help="a label for this reading (also the mark label)")
    ap.add_argument("--names", default=None, help="comma-separated peer names (default A,B,C)")
    args = ap.parse_args(argv)

    ports = [int(p.strip()) for p in args.ports.split(",") if p.strip()]
    names = (
        [n.strip() for n in args.names.split(",")] if args.names else PEER_NAMES[: len(ports)]
    )
    label = args.label or f"{args.op}-{time.strftime('%H%M%S')}"
    if args.op in ("census", "arm", "dump") and not args.path:
        print("ERROR: --path is required for census/arm/dump")
        return 2

    DIAG_DIR.mkdir(parents=True, exist_ok=True)

    peers: list[dict] = []
    for name, port in zip(names, ports):
        # STEP 0, every time. Roles migrate between runs, so this is never assumed.
        info_resp = post(port, "session.info")
        info = None
        if info_resp.get("status") == 200 and isinstance(info_resp.get("body"), dict):
            body = info_resp["body"]
            if body.get("ok") is True and isinstance(body.get("result"), dict):
                info = body["result"]
        diag_args: dict[str, Any] = {"op": args.op}
        if args.path:
            diag_args["path"] = args.path
        if args.op == "mark":
            diag_args["label"] = label
        resp = post(port, "canvas.diag", diag_args)
        # `S186` — TO DISK FIRST, ALWAYS, before a single line is printed.
        out = DIAG_DIR / f"{label}-{name}.json"
        out.write_text(
            json.dumps(
                {
                    "peer": name,
                    "port": port,
                    "op": args.op,
                    "path": args.path,
                    "label": label,
                    "wallClock": time.time(),
                    "sessionInfo": info,
                    "sessionInfoRaw": info_resp,
                    "raw": resp,
                },
                indent=2,
                default=str,
            ),
            encoding="utf-8",
        )
        result = None
        body = resp.get("body")
        if isinstance(body, dict) and isinstance(body.get("result"), dict):
            result = body["result"]
        peers.append(
            {
                "name": name,
                "port": port,
                "info": info,
                "resp": resp,
                "result": result,
                "file": out,
            }
        )

    print("raw responses written (read these if the console loses the rest):")
    for p in peers:
        print(f"  {p['name']}  {p['file']}")

    problems = [(p["name"], check_peer(p["name"], args.op, p["resp"])) for p in peers]
    bad = [(n, r) for n, r in problems if r]
    for p in peers:
        r = p.get("result") or {}
        if isinstance(r.get("dropped"), int) and r["dropped"] > 0:
            bad.append((p["name"], f"dropped={r['dropped']} — the ring evicted rows"))
        if args.path and isinstance(r.get("patchedPaths"), list) and args.op == "dump":
            if args.path not in r["patchedPaths"] and r.get("patchedPaths") != []:
                bad.append((p["name"], f"patchedPaths ⊉ {args.path}: {r['patchedPaths']}"))
    if bad:
        print()
        for name, reason in bad:
            print(f"INCOMPLETE — {name}: {reason}")
        print()
        print("The table is WITHHELD. An incomplete dump is not evidence. Re-run the arm.")
        return 1

    print_header(label, args.op, peers)
    print_plane_availability(peers)
    if args.op in ("census", "arm", "dump"):
        print_paint_divergence(peers)

    if args.op == "clear":
        for p in peers:
            r = p.get("result") or {}
            print(
                f"  {p['name']}: armed={r.get('armed')} patchesRemoved={r.get('patchesRemoved')} "
                f"listenersRemoved={r.get('listenersRemoved')}"
            )
        return 0
    if args.op == "mark":
        for p in peers:
            print(f"  {p['name']}: mark '{label}' pushed")
        return 0

    if args.op == "dump":
        print_delta_table(peers)
        print_story(peers)
        print_unattributed(peers)
    else:
        print_census_table(peers)
    print_awareness(peers)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
