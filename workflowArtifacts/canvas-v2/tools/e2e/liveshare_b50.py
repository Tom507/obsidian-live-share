"""B50 — Worker 4 live validation of WP91, WP90 and WP68 in two real Obsidian
instances.

WHY THIS FILE EXISTS RATHER THAN A RE-RUN OF `liveshare_b41_observe_then_write.py`
---------------------------------------------------------------------------------
B41's ladder takes TWO S65-guarded log reads PER RUNG. Measured on this rig at
02:40 on 2026-08-07, S71's host wake-up clamp is ACTIVE — both vaults reported
`AWARENESS GAP: 60006ms … source=tick` and the debug log's newest stamp trailed
wall-clock by 90 s. Each guarded read therefore blocks 60-180 s, so a 24-rung
ladder costs 1-2 hours of pure instrument wait and can time out into
`FlushNotProven` on rungs whose STATE oracle is perfectly readable.

The repair is not to weaken the guard. It is to stop asking the log a question
per rung:

  * the VERDICT of every rung is STATE — the writer's own doc via `canvas.state`,
    the writer's file and the peer's file on disk. None of it involves the log.
  * the log is read exactly ONCE, over a mark spanning the whole run, and its
    lines are attributed to rungs BY STAMP. Same watermark guard, same rule-15
    controls, 1/24th of the wait.

WHAT THE ORACLE IS, AND WHY IT IS NOT THE PEER
-----------------------------------------------
B41 scored a rung on whether the record reached the PEER. That conflates "never
captured" with "captured, never delivered". WP91 is about CAPTURE, so the
primary oracle here is THE WRITER'S OWN DOC:

    CAPTURED  := the record the writer wrote to its own `.canvas` is in the
                 writer's own Y.Doc (read back through `canvas.state`)
    ARRIVED   := ... and in the peer's `.canvas` on disk

A swallow is `in_write_file=True, in_write_doc=False` — the bytes are on the
user's disk and the writer's own document never learned about them. That is the
exact signature B44 measured and the one WP91 closes.

RULES OBEYED
------------
  S45   `canvas.open` is NEVER called; leaves are opened with
        `canvas.typeInNode{open:true}`.
  S46   the installed bundle's sha256 is printed for both vaults, every run.
  S57   every command this suite depends on is ROUTED once before measuring.
  S65   every log read goes through `ls_logwait`, which refuses to return an
        empty list as an absence and raises `FlushNotProven` instead.
  S71   the clamp is measured and reported, never assumed away.
  rule 15 every signature carries its historical-hit control.
  I11   nothing here deletes a file; teardown only removes records this run made.
  secrets  no `data.json` VALUE is read, printed or hashed. Key names, the
        `sharedFolder` guard value and `e2eControlPort` only.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any, Callable, Optional

sys.path.insert(0, r"H:\tmp")
from ls_logwait import (  # noqa: E402
    ABSENT,
    PRESENT,
    UNINFORMATIVE,
    FlushNotProven,
    LogWaiter,
    parse_stamp,
)

VAULTS: dict[str, tuple[Path, int]] = {
    "A": (Path(r"H:\Developement\_NeuralAngels\ObsidianOrga"), 39431),
    "B": (Path(r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie"), 39432),
}
SHARED = "_liveshare-test"
CANVAS = f"{SHARED}/smoke.canvas"
REQUIRED_SHARED_FOLDER = "_liveshare-test"
RUN = time.strftime("%H%M%S")
PREFIX = f"b50-{RUN}"

# Signatures this suite reads. Each is checked against its historical hit count
# before any absence is reported (rule 15).
RECEIPTS = (
    "CANVAS WRITER:",
    "CAPTURE DECLINED:",
    "local modify ",
    "SEED REFUSED:",
    "SEED RESTORED:",
    "SEED REFUSAL STORE:",
    "CANVAS WRITE HELD:",
    "SHADOW STALE:",
    "AWARENESS GAP:",
)

OUT: list[str] = []


def say(m: str = "") -> None:
    print(m, flush=True)
    OUT.append(m)


# --------------------------------------------------------------------------- #
# control surface
# --------------------------------------------------------------------------- #
def cmd(role: str, name: str, timeout: float = 30.0, **args: Any) -> dict:
    _, port = VAULTS[role]
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/command",
        data=json.dumps({"cmd": name, "args": args}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}


def vpath(role: str, rel: str) -> Path:
    return VAULTS[role][0] / rel


def read_canvas(role: str, rel: str = CANVAS) -> Optional[dict]:
    p = vpath(role, rel)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return None


def write_canvas_raw(role: str, data: dict, rel: str = CANVAS) -> None:
    vpath(role, rel).write_text(json.dumps(data, indent=2), encoding="utf-8")


def nids(d: Optional[dict]) -> set:
    """Node ids, parsed from the record's OWN id field.

    Never a substring search over the file: `"x": 20` and `"width": 400` both
    match a naive `in` test, which is the guard WP87 got wrong.
    """
    return {n.get("id") for n in (d or {}).get("nodes", []) if isinstance(n, dict)}


def eids(d: Optional[dict]) -> set:
    return {e.get("id") for e in (d or {}).get("edges", []) if isinstance(e, dict)}


def doc_ids(role: str, rel: str = CANVAS) -> tuple[set, set]:
    r = cmd(role, "canvas.state", path=rel)
    if not r.get("ok"):
        return set(), set()
    st = r.get("result") or {}
    return (
        {n.get("id") for n in st.get("nodes", []) if isinstance(n, dict)},
        {e.get("id") for e in st.get("edges", []) if isinstance(e, dict)},
    )


def card(nid: str, x: int, y: int) -> dict:
    return {"id": nid, "type": "text", "text": nid, "x": x, "y": y, "width": 160, "height": 80}


def bundle_digest(role: str) -> tuple[str, int]:
    p = vpath(role, ".obsidian/plugins/live-share/main.js")
    return hashlib.sha256(p.read_bytes()).hexdigest(), p.stat().st_size


def shared_folder(role: str) -> str:
    """The ONE data.json value this suite is allowed to read (its own guard)."""
    cfg = json.loads(
        vpath(role, ".obsidian/plugins/live-share/data.json").read_text(encoding="utf-8")
    )
    return str(cfg.get("sharedFolder"))


def log_path(role: str) -> Path:
    cfg = json.loads(
        vpath(role, ".obsidian/plugins/live-share/data.json").read_text(encoding="utf-8")
    )
    raw = cfg.get("debugLogPath") or ".obsidian/live-share-debug.md"
    p = Path(raw)
    return p if p.is_absolute() else vpath(role, raw)


def waiter() -> LogWaiter:
    return LogWaiter({r: log_path(r) for r in VAULTS})


def await_state(label: str, pred: Callable[[], bool], budget: float,
                interval: float = 0.2) -> tuple[bool, float]:
    t0 = time.monotonic()
    dl = t0 + budget
    while time.monotonic() < dl:
        try:
            if pred():
                return True, time.monotonic() - t0
        except Exception:  # noqa: BLE001
            pass
        time.sleep(min(interval, max(0.0, dl - time.monotonic())))
    try:
        if pred():
            return True, time.monotonic() - t0
    except Exception:  # noqa: BLE001
        pass
    say(f"      !! WAIT TIMED OUT after {budget:.1f}s waiting for: {label}")
    return False, time.monotonic() - t0


# --------------------------------------------------------------------------- #
# gate
# --------------------------------------------------------------------------- #
ROLES: dict[str, str] = {}
BUNDLES: dict[str, str] = {}
NEEDED = ("session.info", "canvas.state", "canvas.file", "sync.waitQuiescent",
          "canvas.typeInNode")


def gate(title: str) -> bool:
    say("=" * 78)
    say(f"B50 — {title}   run {RUN}")
    say("=" * 78)
    ok = True

    for role in VAULTS:
        d, n = bundle_digest(role)
        BUNDLES[role] = d
        say(f"  bundle {role}: sha256={d}  size={n}")
    if len(set(BUNDLES.values())) != 1:
        say("  !! THE TWO VAULTS HOLD DIFFERENT BUNDLES — refusing to measure")
        ok = False

    for role in VAULTS:
        sf = shared_folder(role)
        say(f"  sharedFolder {role} = {sf!r}")
        if sf != REQUIRED_SHARED_FOLDER:
            say(f"  !! sharedFolder is not {REQUIRED_SHARED_FOLDER!r} — ABORT, a guest "
                f"would trash the whole vault")
            ok = False

    for role in VAULTS:
        r = cmd(role, "session.info")
        info = (r.get("result") or {}) if r.get("ok") else {}
        ROLES[role] = str(info.get("role"))
        say(f"  {role}: role={info.get('role')} connected={info.get('connected')} "
            f"vaultId={info.get('vaultId')} build={info.get('pluginBuild')}")
        if info.get("connected") is not True:
            ok = False

    probe = sorted(i for i in nids(read_canvas("A")) if i)
    for role in VAULTS:
        for name in NEEDED:
            if name == "canvas.typeInNode":
                r = (cmd(role, name, path=CANVAS, nodeId=probe[0], open=True)
                     if probe else {"ok": False, "error": "no probe node"})
            elif name in ("canvas.state", "canvas.file"):
                r = cmd(role, name, path=CANVAS)
            elif name == "sync.waitQuiescent":
                r = cmd(role, name, path=CANVAS, timeoutMs=1500)
            else:
                r = cmd(role, name)
            blob = json.dumps(r)
            if not (r.get("ok") is True and "unknown cmd" not in blob and "result" in r):
                say(f"  !! S57 GATE: {role} did not route {name}: {blob[:160]}")
                ok = False
    if ok:
        say(f"  S57 gate: both ports ROUTED all {len(NEEDED)} commands")
    return ok


def clamp_report(w: LogWaiter) -> None:
    """S71 — measure the clamp instead of assuming it away."""
    say("")
    say("  S71 — host wake-up clamp, measured now:")
    now = time.time()
    for role in VAULTS:
        from ls_logwait import newest_stamp
        wm = newest_stamp(log_path(role))
        say(f"    {role}: newest on-disk stamp is {('%.1fs' % (now - wm)) if wm else 'n/a'} "
            f"behind wall clock")


def quiet_watch(seconds: float = 12.0) -> bool:
    def snap() -> dict:
        d = {}
        for role in VAULTS:
            f = vpath(role, SHARED)
            if f.is_dir():
                for x in sorted(f.iterdir()):
                    try:
                        d[f"{role}:{x.name}"] = (x.stat().st_mtime_ns, x.stat().st_size)
                    except OSError:
                        pass
        return d

    a = snap()
    time.sleep(seconds)
    b = snap()
    q = a == b
    say(f"  quiet watch {seconds:.0f}s over BOTH shared trees: {'QUIET' if q else 'NOT QUIET'}")
    if not q:
        for k in sorted(set(a) | set(b)):
            if a.get(k) != b.get(k):
                say(f"    changed: {k}")
    return q


def teardown(prefixes: tuple[str, ...] = (PREFIX,), rel: str = CANVAS) -> None:
    say("")
    say("  ---- teardown ----")
    for attempt in range(6):
        for role in VAULTS:
            doc = read_canvas(role, rel)
            if doc is None:
                continue
            n0, e0 = len(doc.get("nodes", [])), len(doc.get("edges", []))
            doc["nodes"] = [n for n in doc.get("nodes", [])
                            if not str(n.get("id", "")).startswith(prefixes)]
            doc["edges"] = [e for e in doc.get("edges", [])
                            if not str(e.get("id", "")).startswith(prefixes)]
            if len(doc["nodes"]) != n0 or len(doc["edges"]) != e0:
                write_canvas_raw(role, doc, rel)
            time.sleep(1.5)
        got, _ = await_state(
            f"both replicas free of every {prefixes} artefact (attempt {attempt + 1})",
            lambda: not any(str(i).startswith(prefixes) for r in VAULTS
                            for i in (nids(read_canvas(r, rel)) | eids(read_canvas(r, rel)))),
            12)
        if got:
            say("  teardown: both replicas are free of every artefact this run made")
            return
    left = {r: sorted(i for i in (nids(read_canvas(r, rel)) | eids(read_canvas(r, rel)))
                      if str(i).startswith(prefixes)) for r in VAULTS}
    say(f"  teardown INCOMPLETE — A={left['A']} B={left['B']}")


def rule15(ev) -> None:
    say("")
    say("  RULE 15 — every signature, with the control that proves it can match.")
    say("  TOOL: Python `substring in line` over the plugin's own debug log; every")
    say("        pattern is a LITERAL (no regex, no metacharacter).")
    for sig in RECEIPTS:
        c = ev.controls.get(sig, {})
        try:
            v = ev.verdict(sig)
        except FlushNotProven:
            v = "FLUSH-NOT-PROVEN"
        n = len(ev.hits(sig))
        say(f"    {sig!r:24} window_hits={n:<5} verdict={v:<18} "
            f"history_hits={c.get('history_hits', 0):<6} matcher_ok={c.get('matcher_ok')}")
        if v == UNINFORMATIVE:
            say("        ^^ UNINFORMATIVE: no absence claim may be made about this "
                "signature from this window.")


def dump(name: str, payload: dict) -> None:
    Path(rf"H:\tmp\b50_{name}_{RUN}.json").write_text(
        json.dumps(payload, indent=2, default=str), encoding="utf-8")
    Path(rf"H:\tmp\b50_{name}_{RUN}.log").write_text("\n".join(OUT), encoding="utf-8")
    say(f"  machine-readable: H:\\tmp\\b50_{name}_{RUN}.json")


# =========================================================================== #
# 1. THE DELTA LADDER  (WP91 AC1, live)
# =========================================================================== #
SHAPES = ("CTRL_NODE_A", "EDGE_A", "NODE_B", "DELETE_A")


def ladder() -> int:
    if not gate("DELTA LADDER (WP91 AC1)"):
        say("\nREFUSING TO MEASURE — the gate did not pass.")
        return 2
    w = waiter()
    clamp_report(w)
    quiet = quiet_watch(12.0)

    # S45: a real leaf, opened the only way that attaches the writer seam.
    probe = sorted(i for i in nids(read_canvas("A")) if i)
    if probe:
        for role in VAULTS:
            cmd(role, "canvas.typeInNode", path=CANVAS, nodeId=probe[0], open=True)

    deltas = [float(x) for x in
              os.environ.get("LS_B50_DELTAS", "0.1,0.3,0.5,0.8,1.0,2.0").split(",")]
    shapes = tuple(os.environ.get("LS_B50_SHAPES", ",".join(SHAPES)).split(","))
    reps = int(os.environ.get("LS_B50_REPS", "1"))
    plan = [(s, d) for _ in range(reps) for d in deltas for s in shapes]

    mark = w.mark("b50 ladder")
    say("")
    say(f"  plan: {len(plan)} rungs · deltas={deltas} · shapes={shapes} · "
        f"roles A={ROLES['A']} B={ROLES['B']}")

    rows: list[dict] = []
    for idx, (shape, delta) in enumerate(plan, start=1):
        rows.append(rung(shape, delta, idx))

    teardown()
    mark.close()

    say("")
    say("  reading the log ONCE, over the whole run, through the S65 watermark guard…")
    t0 = time.monotonic()
    try:
        ev = w.collect(mark, RECEIPTS, timeout_s=240.0)
    except Exception as e:  # noqa: BLE001
        say(f"  !! collect raised {type(e).__name__}: {e}")
        ev = None
    if ev is not None:
        say(f"  waited {time.monotonic() - t0:.1f}s   flush_proven={ev.flush_proven}")
        say("  " + ev.summary().replace("\n", "\n  "))
        attribute(rows, ev)
        rule15(ev)
    else:
        say("  !! NO LOG EVIDENCE. Every state verdict below still stands; every")
        say("     receipt column is UNKNOWN, not zero.")

    say("")
    say("=" * 78)
    say("  LADDER — CAPTURED is the writer's OWN doc. ARRIVED is the peer's file.")
    say("=" * 78)
    say(f"  {'rung':20} {'delta':6} {'CAPTURED':9} {'ARRIVED':8} {'wr.file':8} "
        f"{'modify':7} {'declined':9}")
    for r in rows:
        if not r.get("valid"):
            say(f"  {r['tag']:20} INVALID  {r.get('why', '')[:52]}")
            continue
        say(f"  {r['tag']:20} {r['delta']:<6} "
            f"{('YES' if r['in_write_doc'] else 'SWALLOWED'):9} "
            f"{('yes' if r['in_peer_file'] else 'no'):8} "
            f"{str(r['in_write_file']):8} "
            f"{str(r.get('n_modify', '?')):7} {str(r.get('n_declined', '?')):9}")

    valid = [r for r in rows if r.get("valid")]
    say("")
    say("  BLOCK SUMMARY — captured / valid, by delta")
    for d in sorted({r["delta"] for r in valid}):
        blk = [r for r in valid if r["delta"] == d]
        cap = sum(1 for r in blk if r["in_write_doc"])
        say(f"    delta {d:<5} captured {cap}/{len(blk)}"
            + ("" if cap == len(blk) else "   << NOT ALL CAPTURED"))
    say("")
    say(f"  tree quiet before measuring: {quiet}  ·  roles A={ROLES['A']} B={ROLES['B']}")
    say(f"  bundle under measurement: {BUNDLES.get('A')}")
    dump("ladder", {"run": RUN, "roles": ROLES, "bundles": BUNDLES, "quiet": quiet,
                    "deltas": deltas, "shapes": shapes, "rows": rows})
    return 0


def rung(shape: str, delta: float, idx: int) -> dict:
    tag = f"{shape}-d{delta:g}"
    marker = f"{PREFIX}-{idx:02d}-M"
    say("")
    say(f"  ---- rung {idx}: {tag} ----")
    row: dict = {"tag": tag, "shape": shape, "delta": delta, "idx": idx, "valid": False}

    d = read_canvas("A")
    if d is None:
        row["why"] = "A unreadable"
        return row
    d = json.loads(json.dumps(d))
    d.setdefault("nodes", []).append(card(marker, -3400, -3400 - 90 * idx))
    write_canvas_raw("A", d)

    # THE POSITIVE CONTROL of the rung: if the marker never lands on B, the band
    # was never established and the verdict is discarded rather than reported.
    m_ok, m_t = await_state(f"marker {marker} in B's file",
                            lambda: marker in nids(read_canvas("B")), 15)
    if not m_ok:
        row["why"] = "marker never arrived — rung INVALID, verdict discarded"
        say(f"      INVALID: {row['why']}")
        return row
    say(f"      marker in B's file after {m_t:.2f}s — B's CanvasPersistence has just "
        f"written B's file, so the path's echo window is open on both sides")

    time.sleep(delta)

    if shape == "NODE_B":
        wrole, peer, kind, polarity = "B", "A", "node", "present"
        src = read_canvas("B")
        if src is None:
            row["why"] = "B unreadable"
            return row
        src = json.loads(json.dumps(src))
        target = f"{PREFIX}-{idx:02d}-g"
        src.setdefault("nodes", []).append(card(target, -3800, -3400 - 90 * idx))
    elif shape == "EDGE_A":
        wrole, peer, kind, polarity = "A", "B", "edge", "present"
        src = json.loads(json.dumps(read_canvas("A") or {}))
        ends = [n["id"] for n in src.get("nodes", []) if isinstance(n, dict)][:2]
        if len(ends) < 2:
            row["why"] = "fewer than 2 nodes"
            return row
        target = f"{PREFIX}-{idx:02d}-e"
        src.setdefault("edges", []).append(
            {"id": target, "fromNode": ends[0], "toNode": ends[1]})
    elif shape == "DELETE_A":
        wrole, peer, kind, polarity = "A", "B", "node", "absent"
        if marker not in nids(read_canvas("A")) or marker not in nids(read_canvas("B")):
            row["why"] = "the node to delete is not on both peers — rung INVALID"
            say(f"      INVALID: {row['why']}")
            return row
        src = json.loads(json.dumps(read_canvas("A") or {}))
        target = marker
        src["nodes"] = [n for n in src.get("nodes", []) if n.get("id") != marker]
    else:
        wrole, peer, kind, polarity = "A", "B", "node", "present"
        src = json.loads(json.dumps(read_canvas("A") or {}))
        target = f"{PREFIX}-{idx:02d}-n"
        src.setdefault("nodes", []).append(card(target, -4200, -3400 - 90 * idx))

    t_write = time.time()
    write_canvas_raw(wrole, src)

    def in_writer_doc() -> bool:
        wn, we = doc_ids(wrole)
        got = (we if kind == "edge" else wn)
        return (target in got) if polarity == "present" else (target not in got)

    # PRIMARY ORACLE: the writer's own doc. This is the capture question.
    budget = float(os.environ.get("LS_B50_OBSERVE", "12"))
    cap_ok, cap_t = await_state(f"{target} {polarity} in {wrole}'s OWN doc",
                                in_writer_doc, budget)

    def in_peer_file() -> bool:
        doc = read_canvas(peer)
        got = eids(doc) if kind == "edge" else nids(doc)
        return (target in got) if polarity == "present" else (target not in got)

    arr_ok, arr_t = await_state(f"{target} {polarity} in {peer}'s file", in_peer_file, budget)

    wn, we = doc_ids(wrole)
    pn, pe = doc_ids(peer)
    wfile = eids(read_canvas(wrole)) if kind == "edge" else nids(read_canvas(wrole))
    pfile = eids(read_canvas(peer)) if kind == "edge" else nids(read_canvas(peer))
    present = (lambda s: target in s) if polarity == "present" else (lambda s: target not in s)

    row.update({
        "valid": True, "marker": marker, "marker_after": round(m_t, 2),
        "write_role": wrole, "peer": peer, "kind": kind, "polarity": polarity,
        "target": target, "t_write": t_write,
        "in_write_file": present(wfile),
        "in_write_doc": present(we if kind == "edge" else wn),
        "in_peer_doc": present(pe if kind == "edge" else pn),
        "in_peer_file": present(pfile),
        "capture_after": round(cap_t, 2) if cap_ok else None,
        "arrive_after": round(arr_t, 2) if arr_ok else None,
    })
    say(f"      test write on {wrole}: {target} ({kind}); expect {polarity}")
    say(f"      CAPTURED(writer doc)={row['in_write_doc']}  "
        f"writer.file={row['in_write_file']}  "
        f"peer.file={row['in_peer_file']}  peer.doc={row['in_peer_doc']}")
    if row["in_write_file"] and not row["in_write_doc"]:
        say("      >>> SWALLOWED: the bytes are on the writer's disk and the writer's "
            "own document never learned about them.")
    return row


def attribute(rows: list[dict], ev) -> None:
    """Attribute receipts to rungs by STAMP, from the single window read."""
    stamped: list[tuple[float, str, str]] = []
    for role, lines in ev.lines.items():
        for ln in lines:
            ts = parse_stamp(ln)
            if ts is not None:
                stamped.append((ts, role, ln))
    stamped.sort()
    for r in rows:
        if not r.get("valid"):
            continue
        t0, t1 = r["t_write"], r["t_write"] + 4.0
        wr = r["write_role"]
        win = [ln for ts, role, ln in stamped
               if t0 <= ts <= t1 and role == wr and "smoke.canvas" in ln]
        r["n_modify"] = sum(1 for ln in win if "local modify " in ln)
        r["n_declined"] = sum(1 for ln in win if "CAPTURE DECLINED:" in ln)
        r["declined_lines"] = [ln.split("] ", 2)[-1][:140]
                               for ln in win if "CAPTURE DECLINED:" in ln]
        r["writer_lines"] = sum(1 for ln in win if "CANVAS WRITER:" in ln)


# =========================================================================== #
# 2. WP91 AC4 — the swallow's SECOND STEP: does the projection eat the bytes?
# =========================================================================== #
def wp91_ac4() -> int:
    """AC4 is a TWO-STEP scenario and the second step is the serious half.

    step 1  a local whole-file write lands inside the echo window and is
            swallowed — bytes on the writer's disk, absent from the writer's doc.
    step 2  ONE FURTHER REMOTE CHANGE to the same path. That advances the doc,
            so `flushToDisk`'s `lastQueuedContent` dedup no longer suppresses the
            write, and the projection of a doc that never learned about the
            user's edit is written OVER the file that still holds it.

    B44 observed only "unchanged after 20 s" with no further remote change. The
    file survived because NOTHING TRIED. This scenario makes something try, and
    proves it tried by requiring the step-2 record to LAND in the writer's file.
    """
    if not gate("WP91 AC4 — swallow, then one further remote change"):
        return 2
    w = waiter()
    clamp_report(w)
    quiet_watch(12.0)

    probe = sorted(i for i in nids(read_canvas("A")) if i)
    if probe:
        for role in VAULTS:
            cmd(role, "canvas.typeInNode", path=CANVAS, nodeId=probe[0], open=True)

    delta = float(os.environ.get("LS_B50_AC4_DELTA", "0.3"))
    mark = w.mark("b50 wp91 ac4")
    res: dict = {"delta": delta, "bundles": dict(BUNDLES), "roles": dict(ROLES)}

    # ---- arm the window: a remote change is applied to B's copy of the path --
    marker = f"{PREFIX}-ac4-M"
    d = json.loads(json.dumps(read_canvas("A") or {}))
    d.setdefault("nodes", []).append(card(marker, -5000, -5000))
    write_canvas_raw("A", d)
    ok, t = await_state(f"marker {marker} in B's file",
                        lambda: marker in nids(read_canvas("B")), 20)
    res["marker_arrived"] = ok
    if not ok:
        say("  INVALID: the arming remote change never reached B. Nothing below means "
            "anything; reported as NOT DEMONSTRATED rather than as a result.")
        dump("wp91ac4", res)
        return 3
    say(f"  arming remote change applied to B's path after {t:.2f}s")

    time.sleep(delta)

    # ---- STEP 1: the user's own edit, written to B's .canvas on disk ---------
    user = f"{PREFIX}-ac4-USER"
    src = json.loads(json.dumps(read_canvas("B") or {}))
    src.setdefault("nodes", []).append(card(user, -5400, -5000))
    t_user = time.time()
    write_canvas_raw("B", src)

    time.sleep(0.4)
    on_disk_now = user in nids(read_canvas("B"))
    say(f"  STEP 1: user node {user} written to B's .canvas — on B's disk: {on_disk_now}")
    res["step1_bytes_on_disk"] = on_disk_now
    if not on_disk_now:
        say("  INVALID: the marker write never landed on disk (AC1 vacuity risk (c)).")
        dump("wp91ac4", res)
        return 3

    captured, cap_t = await_state(f"{user} in B's OWN doc",
                                  lambda: user in doc_ids("B")[0], 10.0)
    res["step1_captured"] = captured
    res["step1_capture_after"] = round(cap_t, 2) if captured else None
    say(f"  STEP 1 verdict: CAPTURED={captured}"
        + ("" if captured else "   <<< SWALLOWED — the writer's own doc never saw it"))

    # ---- STEP 2: ONE FURTHER REMOTE CHANGE, non-geometry --------------------
    second = f"{PREFIX}-ac4-R2"
    d2 = json.loads(json.dumps(read_canvas("A") or {}))
    d2.setdefault("nodes", []).append(card(second, -5000, -5200))
    write_canvas_raw("A", d2)
    say(f"  STEP 2: one further remote change ({second}, a NEW NODE — structural, not "
        f"geometry-only) applied on A")

    # THE PROOF THAT A WRITE WAS ATTEMPTED: the step-2 record must LAND in B's
    # file. A file that survives because nothing tried is not evidence.
    landed, land_t = await_state(f"{second} in B's file — proof B's projection was written",
                                 lambda: second in nids(read_canvas("B")), 25.0)
    res["step2_projection_written"] = landed
    say(f"  STEP 2: B's file received the projection: {landed}"
        + (f" after {land_t:.2f}s" if landed else ""))

    time.sleep(2.0)
    survives = user in nids(read_canvas("B"))
    in_a = user in nids(read_canvas("A"))
    res.update({"user_survives_on_B_disk": survives, "user_on_A_disk": in_a})

    say("")
    say("  ---- AC4 VERDICT ----")
    if not landed:
        say("  NOT DEMONSTRATED: no projection write was observed after step 2, so the")
        say("  file's survival proves nothing (the dedup may simply have held).")
        res["verdict"] = "NOT DEMONSTRATED"
    elif not captured and not survives:
        say("  I11 RED — DESTRUCTION REPRODUCED: step 1 was swallowed, step 2's")
        say(f"  projection was written, and the user's node {user} is GONE from their")
        say("  own disk. The bytes the user wrote were overwritten by a doc that never")
        say("  learned about them.")
        res["verdict"] = "RED — user bytes destroyed"
    elif not captured and survives:
        say("  PARTIAL: step 1 was swallowed but the user's node survived the step-2")
        say("  projection. The swallow is present; the destruction is not reproduced in")
        say("  this run and must not be reported as absent from the product.")
        res["verdict"] = "SWALLOW, NO DESTRUCTION THIS RUN"
    elif captured and survives:
        say("  GREEN: step 1 CAPTURED, so step 2 can never reach the loss. The user's")
        say(f"  node is on B's disk ({survives}) and on A's disk ({in_a}).")
        res["verdict"] = "GREEN — captured, nothing to destroy"
    else:
        say("  ANOMALY: captured but the node is gone from the writer's disk. That is a")
        say("  different defect and is reported as such, not as this one.")
        res["verdict"] = "ANOMALY"

    teardown()
    mark.close()
    try:
        ev = w.collect(mark, RECEIPTS, timeout_s=240.0)
        say("  " + ev.summary().replace("\n", "\n  "))
        blines = [ln for ln in ev.lines.get("B", []) if "smoke.canvas" in ln]
        res["B_capture_declined"] = [ln.split("] ", 2)[-1][:160] for ln in blines
                                     if "CAPTURE DECLINED:" in ln]
        res["B_local_modify"] = sum(1 for ln in blines if "local modify " in ln)
        say(f"  B `local modify` receipts in the window: {res['B_local_modify']}")
        for ln in res["B_capture_declined"][:12]:
            say(f"    {ln}")
        rule15(ev)
    except Exception as e:  # noqa: BLE001
        say(f"  !! log evidence unavailable: {type(e).__name__}: {e}")
        say("     The STATE verdict above stands on its own; the receipt columns are")
        say("     UNKNOWN, not zero.")

    dump("wp91ac4", res)
    return 0


# =========================================================================== #
# 3. WP90 / S73 — plant a malformed record and make `SEED REFUSED:` fire
# =========================================================================== #
def _wp90_canvas(run: str, repaired: bool) -> dict:
    """A .canvas carrying one VALID node and one record the ingest gate refuses.

    The malformed record is an EDGE with `fromNode` and NO `toNode`. It survives
    `parseCanvas` (it has an `id`), reaches `validateEdgeIngest`, fails
    `hasBothEndpoints`, and yields MISSING_TO with `reject: true` because the
    seed's origin is local. Repaired = the same edge with its `toNode` supplied.
    """
    ok1 = f"wp90-{run}-ok1"
    ok2 = f"wp90-{run}-ok2"
    bad = f"wp90-{run}-BADEDGE"
    edge: dict = {"id": bad, "fromNode": ok1}
    if repaired:
        edge["toNode"] = ok2
    return {
        "nodes": [card(ok1, 100, 100), card(ok2, 100, 400)],
        "edges": [edge],
    }


def wp90() -> int:
    """S73 first, then WP90 proper.

    S73 says `SEED REFUSED:` has NEVER fired in 79 185 lines of retained history,
    and that nothing on hand distinguishes "no malformed record was ever present"
    from "the refusal path is unreachable in the live wiring". This plants one and
    finds out. Until that line appears live, WP63's and WP90's mechanisms have
    ZERO live evidence and no absence claim about them is admissible.
    """
    phase = os.environ.get("LS_B50_WP90_PHASE", "1")
    tag = os.environ.get("LS_B50_WP90_TAG", RUN)
    rel = f"{SHARED}/wp90-{tag}.canvas"
    if not gate(f"WP90 / S73 — phase {phase}  ({rel})"):
        return 2
    w = waiter()
    clamp_report(w)
    # THE PLANT GOES ON THE HOST, whichever instance that currently is. The host
    # seed (`applyCanvasToYMaps`) is the boundary that fills the refusal ledger,
    # and a role assignment inherited from a previous session is exactly the
    # thing S37 says to record rather than assume.
    host = os.environ.get("LS_B50_WP90_ROLE") or next(
        (r for r in VAULTS if ROLES.get(r) == "host"), "A")
    peer = next(r for r in VAULTS if r != host)
    say(f"  planting on {host} (role={ROLES.get(host)}); peer is {peer} "
        f"(role={ROLES.get(peer)})")
    res: dict = {"phase": phase, "tag": tag, "rel": rel, "bundles": dict(BUNDLES),
                 "roles": dict(ROLES), "plant_role": host, "peer_role": peer}
    bad = f"wp90-{tag}-BADEDGE"
    store_rel = ".obsidian/liveshare/state/seed-refusals.json"

    def store_state(role: str) -> dict:
        p = vpath(role, store_rel)
        if not p.exists():
            return {"exists": False}
        try:
            raw = json.loads(p.read_text(encoding="utf-8"))
        except Exception as e:  # noqa: BLE001
            return {"exists": True, "unreadable": str(e)}
        # The store nests under "paths" (SeedRefusalStore v1). Reading the TOP
        # level here reported n_paths=2 for {"version","paths"} and found no
        # entry for the run — a reader bug that looked like a missing record.
        table = raw.get("paths") if isinstance(raw, dict) else None
        keys = list(table.keys()) if isinstance(table, dict) else []
        hit = [k for k in keys if f"wp90-{tag}" in k]
        return {"exists": True, "n_paths": len(keys), "paths_for_this_run": hit,
                "entries": {k: table[k] for k in hit}}

    def file_has_bad(role: str) -> bool:
        return bad in eids(read_canvas(role, rel))

    if phase == "1":
        mark = w.mark("b50 wp90 phase 1")
        say("")
        say("  PHASE 1 — plant a malformed record on the HOST and make the refusal fire.")
        say(f"  The malformed record is edge {bad}: `fromNode` present, `toNode` ABSENT.")
        say("  `validateEdgeIngest` → MISSING_TO, `reject: true` (origin=local).")

        for role in VAULTS:
            say(f"  seed-refusal store on {role} BEFORE: {store_state(role)}")

        write_canvas_raw(host, _wp90_canvas(tag, repaired=False), rel)
        say(f"  planted {rel} on {host} (role={ROLES.get(host)})")

        got, t = await_state(f"the planting instance's doc for {rel} to hold the two VALID nodes",
                             lambda: len(doc_ids(host, rel)[0]) >= 2, 40.0)

        # ── INSTRUMENT CORRECTION, recorded because the first attempt got it
        # wrong and the wrong answer looked like a product finding.
        #
        # `SEED REFUSED:` is emitted by `CanvasPersistence.writeIsWithheld()`,
        # which is reached ONLY from `flushToDisk`. If no `CanvasPersistence` is
        # attached for the path, the withhold is never consulted and the
        # signature cannot fire however many records were refused.
        #
        # On the HOST a writer is NOT attached by WP79's mirror pass — C79 AC4
        # forbids the mirror to materialise the host's own file, so it returns
        # PUBLISH — and the only other trigger is WP85's per-open-leaf attach
        # consultation. So the board has to be OPEN on the refusing instance.
        # Opened with `canvas.typeInNode{open:true}`; `canvas.open` is never used
        # (S45: it subscribes without opening a leaf and permanently disables the
        # very attach seam this needs).
        probe = sorted(i for i in nids(read_canvas(host, rel)) if i)
        say(f"  opening a REAL LEAF on {host} so a writer attaches "
            f"(node {probe[0] if probe else '(none)'})")
        if probe:
            r = cmd(host, "canvas.typeInNode", path=rel, nodeId=probe[0], open=True)
            say(f"    canvas.typeInNode -> ok={r.get('ok')}")
        # Provoke a flush: a remote delta from the peer advances the doc, so the
        # observer schedules a write and `writeIsWithheld` is asked.
        time.sleep(3.0)
        nudge = f"wp90-{tag}-nudge"
        dpeer = read_canvas(peer, rel)
        if dpeer is not None:
            dpeer = json.loads(json.dumps(dpeer))
            dpeer.setdefault("nodes", []).append(card(nudge, 900, 100))
            write_canvas_raw(peer, dpeer, rel)
            say(f"  nudged the path from {peer} ({nudge}) so the refusing instance "
                f"must attempt a write")
            n_ok, _ = await_state(f"{nudge} in {host}'s DOC",
                                  lambda: nudge in doc_ids(host, rel)[0], 30)
            res["nudge_reached_refusing_doc"] = n_ok
            say(f"  the nudge reached {host}'s doc: {n_ok}")
            time.sleep(4.0)
            res["nudge_in_refusing_file"] = nudge in nids(read_canvas(host, rel))
            say(f"  the nudge reached {host}'s FILE: {res['nudge_in_refusing_file']}   "
                f"(a WITHHELD path must NOT receive it)")
        res["seeded"] = got
        say(f"  the planting instance's doc seeded: {got}" + (f" after {t:.2f}s" if got else ""))

        time.sleep(6.0)
        nA, eA = doc_ids(host, rel)
        res["PLANT_doc_nodes"] = sorted(nA)
        res["PLANT_doc_edges"] = sorted(eA)
        res["PLANT_file_has_bad"] = file_has_bad(host)
        say(f"  {host} doc nodes={sorted(nA)}")
        say(f"  {host} doc edges={sorted(eA)}   (the refused edge must NOT be here)")
        say(f"  A file still carries {bad}: {res['PLANT_file_has_bad']}   "
            f"(I11: the refusal must not destroy)")
        for role in VAULTS:
            st = store_state(role)
            res[f"store_after_{role}"] = st
            say(f"  seed-refusal store on {role} AFTER: {st}")

        mark.close()
        try:
            ev = w.collect(mark, RECEIPTS, timeout_s=300.0)
            say("  " + ev.summary().replace("\n", "\n  "))
            for sig in ("SEED REFUSED:", "SEED REFUSAL STORE:", "SEED RESTORED:",
                        "CANVAS WRITER:"):
                hits = [h for h in ev.hits(sig) if f"wp90-{tag}" in h or sig == "SEED REFUSED:"]
                res[f"hits_{sig.strip(':').replace(' ', '_')}"] = [
                    h.split("] ", 2)[-1][:200] for h in hits][:10]
                say(f"    {sig!r:24} hits={len(hits)}")
                for h in hits[:4]:
                    say(f"        {h.split('] ', 2)[-1][:190]}")
            try:
                res["SEED_REFUSED_verdict"] = ev.verdict("SEED REFUSED:")
            except FlushNotProven as e:
                res["SEED_REFUSED_verdict"] = f"FLUSH NOT PROVEN: {e}"
            say(f"  S73 VERDICT for 'SEED REFUSED:' → {res['SEED_REFUSED_verdict']}")
            rule15(ev)
        except Exception as e:  # noqa: BLE001
            say(f"  !! log evidence unavailable: {type(e).__name__}: {e}")
            res["SEED_REFUSED_verdict"] = f"UNAVAILABLE: {e}"

        say("")
        say("  Now RESTART both instances (same bundle, digest-guarded) and re-run")
        say(f"  this file with LS_B50_WP90_PHASE=2 LS_B50_WP90_TAG={tag}")
        dump(f"wp90p1_{tag}", res)
        return 0

    if phase == "2":
        mark = w.mark("b50 wp90 phase 2")
        say("")
        say("  PHASE 2 — after a real restart of BOTH instances.")
        for role in VAULTS:
            st = store_state(role)
            res[f"store_at_start_{role}"] = st
            say(f"  seed-refusal store on {role} at session start: {st}")
        res["PLANT_file_has_bad_at_start"] = file_has_bad(host)
        say(f"  the planting instance's file still carries {bad} at session start: "
            f"{res['PLANT_file_has_bad_at_start']}")

        # Open the board so the writer attaches and a flush is attempted.
        probe = sorted(i for i in nids(read_canvas(host, rel)) if i)
        if probe:
            cmd(host, "canvas.typeInNode", path=rel, nodeId=probe[0], open=True)
        time.sleep(8.0)
        nA, eA = doc_ids(host, rel)
        res["PLANT_doc_nodes"] = sorted(nA)
        res["PLANT_doc_edges"] = sorted(eA)
        say(f"  {host} doc nodes={sorted(nA)} edges={sorted(eA)}")

        # Provoke a write attempt on the withheld path: a remote-side change.
        poke = f"wp90-{tag}-poke"
        dB = read_canvas(peer, rel)
        if dB is not None:
            dB = json.loads(json.dumps(dB))
            dB.setdefault("nodes", []).append(card(poke, 600, 100))
            write_canvas_raw(peer, dB, rel)
            say(f"  poked the path from {peer} ({poke}) so A must attempt a write")
        arrived, _ = await_state(f"{poke} in A's DOC", lambda: poke in doc_ids(host, rel)[0], 30)
        res["poke_reached_A_doc"] = arrived
        time.sleep(5.0)
        res["poke_in_PLANT_file"] = poke in nids(read_canvas(host, rel))
        res["PLANT_file_has_bad_after_poke"] = file_has_bad(host)
        say(f"  poke reached the planting instance's doc: {arrived}; poke reached A's FILE: "
            f"{res['poke_in_PLANT_file']}  (a withheld path must NOT receive it)")
        say(f"  the planting instance's file still carries {bad}: {res['PLANT_file_has_bad_after_poke']}")

        # ---- the LIFT, across the restart --------------------------------
        say("")
        say("  LIFT — repair the malformed record in the user's own file.")
        write_canvas_raw(host, _wp90_canvas(tag, repaired=True), rel)
        lifted, lt = await_state(f"{bad} to appear in A's DOC (the repair admitted)",
                                 lambda: bad in doc_ids(host, rel)[1], 40.0)
        res["lift_admitted"] = lifted
        say(f"  repaired edge admitted into the planting instance's doc: {lifted}"
            + (f" after {lt:.2f}s" if lifted else ""))
        time.sleep(6.0)
        for role in VAULTS:
            st = store_state(role)
            res[f"store_after_lift_{role}"] = st
            say(f"  seed-refusal store on {role} after the lift: {st}")

        mark.close()
        try:
            ev = w.collect(mark, RECEIPTS, timeout_s=300.0)
            say("  " + ev.summary().replace("\n", "\n  "))
            for sig in ("SEED REFUSAL STORE:", "SEED REFUSED:", "SEED RESTORED:",
                        "CANVAS WRITER:"):
                hits = ev.hits(sig)
                res[f"hits_{sig.strip(':').replace(' ', '_')}"] = [
                    h.split("] ", 2)[-1][:200] for h in hits][:10]
                say(f"    {sig!r:24} hits={len(hits)}")
                for h in hits[:4]:
                    say(f"        {h.split('] ', 2)[-1][:190]}")
            rule15(ev)
        except Exception as e:  # noqa: BLE001
            say(f"  !! log evidence unavailable: {type(e).__name__}: {e}")

        dump(f"wp90p2_{tag}", res)
        return 0

    say(f"unknown phase {phase!r}")
    return 2


# =========================================================================== #
# 4. WP68 — the rename boundary refuses, in both directions, and destroys nothing
# =========================================================================== #
def wp68() -> int:
    """Drive the rename boundary from a REAL vault, both directions.

    THE INSTRUMENT IS TESTED FIRST. A rename whose endpoints are both ordinary
    shared paths MUST propagate. If it does not, this rig cannot observe an
    outbound rename at all, and every "no sidecar rename was emitted" reading
    below would be true for free — the exact class this project keeps producing.
    That control decides whether the rest is evidence or noise.
    """
    if not gate("WP68 — the rename boundary"):
        return 2
    w = waiter()
    clamp_report(w)
    quiet_watch(10.0)
    mark = w.mark("b50 wp68")
    res: dict = {"bundles": dict(BUNDLES), "roles": dict(ROLES)}

    sidecar_dir = ".obsidian/liveshare/state"
    ctl_src = f"{SHARED}/wp68-{RUN}-ctl.md"
    ctl_dst = f"{SHARED}/wp68-{RUN}-ctl-renamed.md"
    out_src = f"{SHARED}/wp68-{RUN}-out.md"
    out_dst = f"{sidecar_dir}/wp68-{RUN}-out.md"
    in_src = f"{sidecar_dir}/wp68-{RUN}-in.md"
    in_dst = f"{SHARED}/wp68-{RUN}-in.md"

    def put(role: str, rel: str, text: str) -> None:
        p = vpath(role, rel)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")

    def exists(role: str, rel: str) -> bool:
        return vpath(role, rel).exists()

    def digest(role: str, rel: str) -> Optional[str]:
        p = vpath(role, rel)
        return hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None

    # ---- CONTROL: an ordinary shared -> shared rename, which MUST propagate --
    say("")
    say("  ---- POSITIVE CONTROL: shared -> shared rename ----")
    say("  If this does not propagate, the rig cannot observe a rename at all and")
    say("  every refusal reading below is vacuous.")
    put("A", ctl_src, f"b50 wp68 control {RUN}\n")
    ctl_there, _ = await_state(f"{ctl_src} to reach B", lambda: exists("B", ctl_src), 25)
    res["control_created_on_B"] = ctl_there
    say(f"  control file reached B: {ctl_there}")
    if ctl_there:
        vpath("A", ctl_src).rename(vpath("A", ctl_dst))
        say(f"  renamed on A: {ctl_src} -> {ctl_dst}")
        moved, mt = await_state(
            f"B to follow the rename ({ctl_dst} present AND {ctl_src} gone)",
            lambda: exists("B", ctl_dst) and not exists("B", ctl_src), 30)
        res["control_rename_followed_by_B"] = moved
        res["control_B_new"] = exists("B", ctl_dst)
        res["control_B_old"] = exists("B", ctl_src)
        say(f"  B followed the rename: {moved}  (new={res['control_B_new']} "
            f"old_still_there={res['control_B_old']})")
    else:
        res["control_rename_followed_by_B"] = None

    instrument_ok = bool(res.get("control_rename_followed_by_B"))
    say("")
    if instrument_ok:
        say("  INSTRUMENT: LIVE. A rename performed on disk in vault A is observed by")
        say("  the plugin and applied on B. Refusal readings below are meaningful.")
    else:
        say("  INSTRUMENT: NOT LIVE. An ordinary shared->shared rename did NOT")
        say("  propagate, so this rig cannot drive `onFileRename` from disk. Every")
        say("  refusal reading below would be TRUE FOR FREE and is reported as NOT")
        say("  DEMONSTRATED, never as a pass.")

    # ---- DIRECTION 1: shared -> sidecar --------------------------------------
    say("")
    say("  ---- DIRECTION 1: shared -> sidecar (outbound refusal) ----")
    put("A", out_src, f"b50 wp68 outbound {RUN}\n")
    out_there, _ = await_state(f"{out_src} to reach B", lambda: exists("B", out_src), 25)
    res["d1_source_on_B"] = out_there
    d_before = digest("A", out_src)
    if out_there:
        vpath("A", out_dst).parent.mkdir(parents=True, exist_ok=True)
        vpath("A", out_src).rename(vpath("A", out_dst))
        say(f"  renamed on A: {out_src} -> {out_dst}")
        time.sleep(20.0)
        res["d1_A_dest_exists"] = exists("A", out_dst)
        res["d1_A_dest_digest_unchanged"] = digest("A", out_dst) == d_before
        res["d1_B_sidecar_written"] = exists("B", out_dst)
        res["d1_B_source_still_there"] = exists("B", out_src)
        res["d1_B_source_digest"] = digest("B", out_src)
        say(f"  A holds the moved file at the sidecar path: {res['d1_A_dest_exists']} "
            f"(bytes unchanged: {res['d1_A_dest_digest_unchanged']})")
        say(f"  B's .obsidian/** received the rename: {res['d1_B_sidecar_written']}   "
            f"<< must be False")
        say(f"  B still holds its own copy at the OLD path: "
            f"{res['d1_B_source_still_there']}   << must be True (I11: a refusal "
            f"costs no file)")

    # ---- DIRECTION 2: sidecar -> shared --------------------------------------
    say("")
    say("  ---- DIRECTION 2: sidecar -> shared (the reverse, and the one that names")
    say("       a path every peer holds) ----")
    put("A", in_src, f"b50 wp68 inbound {RUN}\n")
    time.sleep(6.0)
    res["d2_sidecar_source_leaked_to_B"] = exists("B", in_src)
    say(f"  the sidecar source leaked to B on CREATE: "
        f"{res['d2_sidecar_source_leaked_to_B']}   << must be False")
    d2_before = digest("A", in_src)
    vpath("A", in_src).rename(vpath("A", in_dst))
    say(f"  renamed on A: {in_src} -> {in_dst}")
    time.sleep(20.0)
    res["d2_A_dest_exists"] = exists("A", in_dst)
    res["d2_A_dest_digest_unchanged"] = digest("A", in_dst) == d2_before
    res["d2_B_dest_exists"] = exists("B", in_dst)
    say(f"  A holds the moved file at the shared path: {res['d2_A_dest_exists']} "
        f"(bytes unchanged: {res['d2_A_dest_digest_unchanged']})")
    say(f"  B received a rename OUT of the sidecar directory: "
        f"{res['d2_B_dest_exists']}")

    # ---- I11: nothing was destroyed at either end ----------------------------
    say("")
    say("  ---- I11: BOTH ENDPOINTS, BOTH VAULTS, AFTER EVERYTHING ----")
    survey = {}
    for role in VAULTS:
        for rel in (ctl_src, ctl_dst, out_src, out_dst, in_src, in_dst):
            survey[f"{role}:{rel}"] = {"exists": exists(role, rel),
                                       "sha256": digest(role, rel)}
            say(f"    {role}:{rel:52} exists={exists(role, rel)}")
    res["survey"] = survey

    say("")
    say("  ---- teardown (our own files only; nothing pre-existing is touched) ----")
    for role in VAULTS:
        for rel in (ctl_src, ctl_dst, out_src, out_dst, in_src, in_dst):
            p = vpath(role, rel)
            if p.exists():
                try:
                    p.unlink()
                    say(f"    removed {role}:{rel}")
                except OSError as e:
                    say(f"    could not remove {role}:{rel}: {e}")

    mark.close()
    try:
        ev = w.collect(mark, RECEIPTS, timeout_s=300.0)
        say("  " + ev.summary().replace("\n", "\n  "))
        rule15(ev)
    except Exception as e:  # noqa: BLE001
        say(f"  !! log evidence unavailable: {type(e).__name__}: {e}")

    res["instrument_live"] = instrument_ok
    for role in VAULTS:
        say(f"  sharedFolder {role} after the run = {shared_folder(role)!r}")
        res[f"sharedFolder_after_{role}"] = shared_folder(role)
    dump("wp68", res)
    return 0


COMMANDS = {"ladder": ladder, "wp91ac4": wp91_ac4, "wp90": wp90, "wp68": wp68}

if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "ladder"
    if what not in COMMANDS:
        print(f"usage: {sys.argv[0]} [{'|'.join(COMMANDS)}]")
        sys.exit(2)
    sys.exit(COMMANDS[what]())
