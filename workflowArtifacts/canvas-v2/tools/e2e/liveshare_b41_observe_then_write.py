"""B41 experiment 4 — OBSERVE, THEN WRITE. The suite's actual shape, isolated.

WHAT EXPERIMENTS 1-3 SETTLED, AND WHAT THEY DID NOT
Experiment 3 (`liveshare_b41_ladder.py`, run 130817) wrote 48 whole-file
`.canvas` writes across four shapes — node-add on the host, node-add on the
guest, edge-add, node-delete — with gaps descending to 0.15 s, and **48/48
survived**, with `SHADOW STALE: 0` and `CANVAS WRITE HELD: 0` in the whole
window. So:

    >>> "consecutive whole-file writes inside the debounce are discarded as
    >>>  stale by the shadow-based intent diff" is FALSIFIED, for every shape
    >>>  the canvas suite exercises.

But experiment 3 timed each write from MY OWN PREVIOUS WRITE. The suite does not
do that. The suite does this:

    write  ->  POLL THE PEER UNTIL THE STATE IS OBSERVED  ->  write again

and "the state is observed on the peer" is, by construction, the instant the
peer's `CanvasPersistence` finished writing the peer's `.canvas` file. Every
disk write in this tree takes a 250 ms echo mute around itself
(`canvas-persistence.ts` `DISK_WRITE_SETTLE_MS = 250`, `utils.ts`
`VAULT_EVENT_SETTLE_MS = 250`), and inside that window BOTH
`vault-events.ts:232` (`isPathMuted`) and `canvas-sync.ts:2965`
(`recentDiskWrites`) drop a `modify` **with no log line at all**.

In the SCHEDULE band the suite then waits ~6 s. In the FAST band it waits ~0.2 s.
That is the ONLY thing the two bands differ on, and it is the interval this
experiment sweeps.

A RUNG
    1. write marker M on A, and POLL B's FILE until M appears  (= the suite's
       `await_state`; its return is the peer's write completing)
    2. sleep DELTA                                             (= the band)
    3. write the TEST record, in one of four shapes
    4. wait 20 s: did the test record reach the other side?

SHAPES — the suite's own four, three of which flip in the FAST band
    CTRL_NODE_A   node added on A          [01]/[03] — PASSES in the FAST band
    EDGE_A        side-less edge on A      [02]      — TIMES OUT in the FAST band
    NODE_B        node added on B          [04]      — TIMES OUT in the FAST band
    DELETE_A      node deleted on A        [06]      — TIMES OUT in the FAST band

VACUITY GUARDS, because three of these verdicts are absences or presences that a
badly written rung can satisfy for free:
    * a rung whose marker M never arrived is INVALID and its verdict is discarded
    * DELETE_A refuses to run unless the node it deletes is present on BOTH peers
      first — "absent on B" is trivially true of a node that was never there, and
      experiment 2 committed exactly that error
    * CTRL_NODE_A is the positive control: if the control ever fails, no other
      row in that block means anything

RULES: S45 (no `canvas.open`), S47, S37, S57, rule 15, no data.json VALUE printed.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any, Optional

VAULTS = {
    "A": (Path(r"H:\Developement\_NeuralAngels\ObsidianOrga"), 39431),
    "B": (Path(r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie"), 39432),
}
CANVAS = "_liveshare-test/smoke.canvas"
RUN = time.strftime("%H%M%S")
MARK = f"b41O-{RUN}"

DELTAS = [6.0, 2.0, 1.0, 0.5, 0.25, 0.1]
SHAPES = ("CTRL_NODE_A", "EDGE_A", "NODE_B", "DELETE_A")

RECEIPTS = ("CANVAS WRITER:", "CANVAS WRITE HELD:", "SHADOW STALE:",
            "local modify ", "reconcile ", "SEED REFUSED:")
FLUSH_MARGIN_S = 2.0
OBSERVE_S = 20.0

out_lines: list[str] = []


def say(m: str = "") -> None:
    print(m, flush=True)
    out_lines.append(m)


def cmd(role: str, name: str, timeout: float = 30.0, **args: Any) -> dict:
    _, port = VAULTS[role]
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/command",
        data=json.dumps({"cmd": name, "args": args}).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}


def cpath(role: str) -> Path:
    return VAULTS[role][0] / CANVAS


def read_canvas(role: str) -> Optional[dict]:
    p = cpath(role)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return None


def write_canvas_raw(role: str, data: dict) -> None:
    cpath(role).write_text(json.dumps(data, indent=2), encoding="utf-8")


def nids(d: Optional[dict]) -> set:
    return {n.get("id") for n in (d or {}).get("nodes", []) if isinstance(n, dict)}


def eids(d: Optional[dict]) -> set:
    return {e.get("id") for e in (d or {}).get("edges", []) if isinstance(e, dict)}


def doc_ids(role: str) -> tuple[set, set]:
    r = cmd(role, "canvas.state", path=CANVAS)
    if not r.get("ok"):
        return set(), set()
    st = r.get("result") or {}
    return ({n.get("id") for n in st.get("nodes", []) if isinstance(n, dict)},
            {e.get("id") for e in st.get("edges", []) if isinstance(e, dict)})


def card(nid: str, x: int, y: int) -> dict:
    return {"id": nid, "type": "text", "text": nid, "x": x, "y": y,
            "width": 160, "height": 80}


def log_path(role: str) -> Optional[Path]:
    vault, _ = VAULTS[role]
    try:
        cfg = json.loads((vault / ".obsidian/plugins/live-share/data.json").read_text("utf-8"))
    except Exception:  # noqa: BLE001
        return None
    raw = cfg.get("debugLogPath")
    if not raw:
        return None
    p = Path(raw)
    return p if p.is_absolute() else vault / raw


def log_offset(role: str) -> int:
    p = log_path(role)
    try:
        return p.stat().st_size if p and p.exists() else 0
    except Exception:  # noqa: BLE001
        return 0


def log_since(role: str, offset: int) -> list[str]:
    p = log_path(role)
    if not p or not p.exists():
        return []
    try:
        with p.open("rb") as fh:
            fh.seek(offset)
            return fh.read().decode("utf-8", "replace").splitlines()
    except Exception:  # noqa: BLE001
        return []


TS = re.compile(r"T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z")


def utc_sod(line: str) -> Optional[float]:
    m = TS.search(line)
    if not m:
        return None
    h, mi, s, ms = (int(g) for g in m.groups())
    return h * 3600 + mi * 60 + s + ms / 1000.0


def now_utc_sod() -> float:
    t = time.time()
    g = time.gmtime(t)
    return g.tm_hour * 3600 + g.tm_min * 60 + g.tm_sec + (t % 1)


def await_state(label: str, pred, budget: float, interval: float = 0.2) -> tuple[bool, float]:
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


ROLES: dict[str, str] = {}
NEEDED = ("session.info", "canvas.state", "canvas.file", "sync.waitQuiescent", "canvas.typeInNode")


def gate() -> bool:
    say("=" * 78)
    say(f"B41 EXPERIMENT 4 — OBSERVE, THEN WRITE   run {RUN}")
    say("=" * 78)
    ok = True
    for role in VAULTS:
        mj = VAULTS[role][0] / ".obsidian/plugins/live-share/main.js"
        say(f"  bundle {role}: sha256={hashlib.sha256(mj.read_bytes()).hexdigest()[:16]}… "
            f"size={mj.stat().st_size}")
    for role in VAULTS:
        r = cmd(role, "session.info")
        info = (r.get("result") or {}) if r.get("ok") else {}
        ROLES[role] = str(info.get("role"))
        say(f"  {role}: role={info.get('role')} connected={info.get('connected')}")
        if info.get("connected") is not True:
            ok = False
    probe = sorted(nids(read_canvas("A")) - {None})
    for role in VAULTS:
        for name in NEEDED:
            if name == "canvas.typeInNode":
                r = cmd(role, name, path=CANVAS, nodeId=probe[0], open=True) if probe else {"ok": False}
            elif name in ("canvas.state", "canvas.file"):
                r = cmd(role, name, path=CANVAS)
            elif name == "sync.waitQuiescent":
                r = cmd(role, name, path=CANVAS, timeoutMs=1500)
            else:
                r = cmd(role, name)
            blob = json.dumps(r)
            if not (r.get("ok") is True and "unknown cmd" not in blob and "result" in r):
                say(f"  !! GATE: {role} did not route {name}: {blob[:160]}")
                ok = False
    if ok:
        say(f"  S57 gate: both ports ROUTED all {len(NEEDED)} commands")
    return ok


def quiet_watch(seconds: float = 15.0) -> bool:
    def snap():
        d = {}
        for role in VAULTS:
            f = VAULTS[role][0] / "_liveshare-test"
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
    say(f"  quiet watch {seconds:.0f}s over BOTH shared trees: {'QUIET' if a == b else 'NOT QUIET'}")
    return a == b


RUNGS: list[dict] = []


def rung(shape: str, delta: float, idx: int) -> dict:
    tag = f"{shape}-d{delta:g}"
    marker = f"{MARK}-{idx:02d}-M"
    say("")
    say(f"  ---- rung {idx}: {tag} ----")
    row: dict = {"tag": tag, "shape": shape, "delta": delta, "idx": idx, "valid": False}

    off = {r: log_offset(r) for r in VAULTS}

    # 1. THE MARKER, and the poll that ends the moment B's writer has written.
    d = read_canvas("A")
    if d is None:
        row["why"] = "A unreadable"
        RUNGS.append(row)
        return row
    d = json.loads(json.dumps(d))
    d.setdefault("nodes", []).append(card(marker, -3400, -3400 - 90 * idx))
    write_canvas_raw("A", d)
    m_ok, m_t = await_state(f"the marker {marker} to appear in B's file",
                            lambda: marker in nids(read_canvas("B")), 15)
    if not m_ok:
        row["why"] = "marker never arrived — rung INVALID, verdict discarded"
        say(f"      INVALID: {row['why']}")
        RUNGS.append(row)
        return row
    say(f"      marker observed in B's file after {m_t:.2f}s — this is the instant "
        f"B's CanvasPersistence finished writing B's file")

    # 2. THE BAND.
    time.sleep(delta)

    # 3. THE TEST WRITE — exactly the suite's read-modify-write.
    if shape == "NODE_B":
        wrole, peer, kind, polarity = "B", "A", "node", "present"
        src = read_canvas("B")
        if src is None:
            row["why"] = "B unreadable"
            RUNGS.append(row)
            return row
        src = json.loads(json.dumps(src))
        target = f"{MARK}-{idx:02d}-g"
        src.setdefault("nodes", []).append(card(target, -3800, -3400 - 90 * idx))
    elif shape == "EDGE_A":
        wrole, peer, kind, polarity = "A", "B", "edge", "present"
        src = json.loads(json.dumps(read_canvas("A") or {}))
        ends = [n["id"] for n in src.get("nodes", []) if isinstance(n, dict)][:2]
        if len(ends) < 2:
            row["why"] = "fewer than 2 nodes"
            RUNGS.append(row)
            return row
        target = f"{MARK}-{idx:02d}-e"
        src.setdefault("edges", []).append({"id": target, "fromNode": ends[0], "toNode": ends[1]})
    elif shape == "DELETE_A":
        wrole, peer, kind, polarity = "A", "B", "node", "absent"
        # VACUITY GUARD: the node must be present on BOTH before it can be deleted.
        if marker not in nids(read_canvas("A")) or marker not in nids(read_canvas("B")):
            row["why"] = "the node to delete is not present on both peers — rung INVALID"
            say(f"      INVALID: {row['why']}")
            RUNGS.append(row)
            return row
        src = json.loads(json.dumps(read_canvas("A") or {}))
        target = marker
        src["nodes"] = [n for n in src.get("nodes", []) if n.get("id") != marker]
    else:  # CTRL_NODE_A
        wrole, peer, kind, polarity = "A", "B", "node", "present"
        src = json.loads(json.dumps(read_canvas("A") or {}))
        target = f"{MARK}-{idx:02d}-n"
        src.setdefault("nodes", []).append(card(target, -4200, -3400 - 90 * idx))

    t_utc = now_utc_sod()
    write_canvas_raw(wrole, src)

    def has() -> bool:
        doc = read_canvas(peer)
        return target in (eids(doc) if kind == "edge" else nids(doc))

    ok, ok_t = await_state(f"{target} to be {polarity} in {peer}'s file",
                           (has if polarity == "present" else (lambda: not has())),
                           OBSERVE_S)

    wn, we = doc_ids(wrole)
    pn, pe = doc_ids(peer)
    wfile = eids(read_canvas(wrole)) if kind == "edge" else nids(read_canvas(wrole))
    pfile = eids(read_canvas(peer)) if kind == "edge" else nids(read_canvas(peer))
    wdoc = we if kind == "edge" else wn
    pdoc = pe if kind == "edge" else pn

    time.sleep(FLUSH_MARGIN_S)
    lines = {r: log_since(r, off[r]) for r in VAULTS}
    wlines = [ln for ln in lines[wrole] if "smoke.canvas" in ln]

    def stamped(sig):
        return [(utc_sod(ln), ln) for ln in wlines if sig in ln and utc_sod(ln) is not None]

    writer = [t for t, _ in stamped("CANVAS WRITER:")]
    prev_w = [t for t in writer if t <= t_utc]
    dt_writer = round((t_utc - max(prev_w)) * 1000) if prev_w else None
    after = [ln for t, ln in stamped("local modify ") if t_utc <= t <= t_utc + 3.0]
    stale = [ln for t, ln in stamped("SHADOW STALE:") if t_utc <= t <= t_utc + 3.0]
    held = [ln for t, ln in stamped("CANVAS WRITE HELD:") if t_utc <= t <= t_utc + 3.0]

    row.update({
        "valid": True, "marker": marker, "marker_after": round(m_t, 2),
        "write_role": wrole, "peer": peer, "kind": kind, "polarity": polarity,
        "target": target, "verdict_ok": ok, "verdict_after": round(ok_t, 2),
        "in_write_file": target in wfile, "in_write_doc": target in wdoc,
        "in_peer_file": target in pfile, "in_peer_doc": target in pdoc,
        "dt_since_last_CANVAS_WRITER_ms": dt_writer,
        "local_modify_after_write": [ln.split("] ", 2)[-1][:110] for ln in after],
        "shadow_stale_after_write": [ln.split("] ", 2)[-1][:140] for ln in stale],
        "write_held_after_write": [ln.split("] ", 2)[-1][:140] for ln in held],
    })
    RUNGS.append(row)

    say(f"      test write on {wrole}: {target} ({kind}); expect {polarity} on {peer}")
    say(f"      it landed {dt_writer} ms after {wrole}'s own last CANVAS WRITER: line "
        f"(the echo-settle windows are 250 ms)")
    say(f"      VERDICT {'OK' if ok else 'LOST'} after {ok_t:.2f}s   "
        f"{wrole}.file={row['in_write_file']} {wrole}.doc={row['in_write_doc']} "
        f"{peer}.file={row['in_peer_file']} {peer}.doc={row['in_peer_doc']}")
    say(f"      `local modify` receipts in the 3 s after the write: {len(after)}")
    for ln in after[:3]:
        say(f"        {ln}")
    if not after:
        say("        << NONE — the write produced no capture receipt at all >>")
    for ln in stale[:3]:
        say(f"        SHADOW STALE: {ln}")
    for ln in held[:3]:
        say(f"        HELD: {ln}")
    return row


def cleanup() -> None:
    say("")
    say("  ---- teardown ----")
    pref = ("b41-", "b41s-", "b41L-", "b41O-")
    for attempt in range(8):
        for role in VAULTS:
            doc = read_canvas(role)
            if doc is None:
                continue
            n0, e0 = len(doc.get("nodes", [])), len(doc.get("edges", []))
            doc["nodes"] = [n for n in doc.get("nodes", [])
                            if not str(n.get("id", "")).startswith(pref)]
            doc["edges"] = [e for e in doc.get("edges", [])
                            if not str(e.get("id", "")).startswith(pref)]
            if len(doc["nodes"]) != n0 or len(doc["edges"]) != e0:
                write_canvas_raw(role, doc)
            time.sleep(1.5)
        got, _ = await_state(f"both replicas free of every b41 artefact (attempt {attempt + 1})",
                             lambda: not any(str(i).startswith(pref) for r in VAULTS
                                             for i in (nids(read_canvas(r)) | eids(read_canvas(r)))),
                             12)
        if got:
            say("  teardown: both replicas are free of every b41 artefact")
            return
    left = {r: sorted(i for i in (nids(read_canvas(r)) | eids(read_canvas(r)))
                      if str(i).startswith(pref)) for r in VAULTS}
    say(f"  teardown INCOMPLETE — A={len(left['A'])} B={len(left['B'])}")
    say(f"    A: {left['A'][:25]}")
    say(f"    B: {left['B'][:25]}")


def main() -> int:
    if not gate():
        say("\nREFUSING TO MEASURE — the gate did not pass.")
        return 2
    quiet = quiet_watch(15.0)
    probe = sorted(nids(read_canvas("A")) - {None})
    if probe:
        for role in VAULTS:
            cmd(role, "canvas.typeInNode", path=CANVAS, nodeId=probe[0], open=True)
    all_off = {r: log_offset(r) for r in VAULTS}

    deltas = DELTAS if os.environ.get("LS_B41_QUICK") != "1" else [6.0, 0.25]
    if os.environ.get("LS_B41_DELTAS"):
        deltas = [float(x) for x in os.environ["LS_B41_DELTAS"].split(",")]
    shapes = SHAPES
    if os.environ.get("LS_B41_SHAPES"):
        shapes = tuple(os.environ["LS_B41_SHAPES"].split(","))
    reps = int(os.environ.get("LS_B41_REPS", "1"))
    plan = [(s, d) for _ in range(reps) for d in deltas for s in shapes]
    say("")
    say(f"  plan: {len(plan)} rungs · deltas={deltas} · roles A={ROLES['A']} B={ROLES['B']}")
    for i, (s, d) in enumerate(plan, start=1):
        try:
            rung(s, d, i)
        except Exception as e:  # noqa: BLE001
            say(f"      RUNG RAISED: {type(e).__name__}: {e}")

    cleanup()
    time.sleep(FLUSH_MARGIN_S)
    tail: list[str] = []
    for r in VAULTS:
        tail += log_since(r, all_off[r])
    say("")
    say("  RULE 15 — every receipt signature, proved able to match a known-present line.")
    say("  TOOL: Python `substring in line` over the plugin's own debug log; every")
    say("        pattern is a LITERAL (no regex, no metacharacter, no `grep -o`).")
    for sig in RECEIPTS:
        hits = [ln for ln in tail if sig in ln]
        say(f"    {sig!r:24} hits={len(hits):5}  "
            + (f"e.g. {hits[0].strip()[:130]}" if hits
               else "<< NO HIT in this window — an absence claim here would be UNSOUND"))

    say("")
    say("=" * 78)
    say("  RESULT TABLE — the suite's own shape, with the band as the only variable")
    say("=" * 78)
    say(f"  {'rung':18} {'verdict':8} {'after':7} {'wr.doc':7} {'peer.file':10} "
        f"{'dt_wr_ms':9} {'modify':7} {'stale':6}")
    for r in RUNGS:
        if not r.get("valid"):
            say(f"  {r['tag']:18} INVALID  {r.get('why', '')[:60]}")
            continue
        say(f"  {r['tag']:18} {('OK' if r['verdict_ok'] else 'LOST'):8} "
            f"{r['verdict_after']:<7} {str(r['in_write_doc']):7} {str(r['in_peer_file']):10} "
            f"{str(r['dt_since_last_CANVAS_WRITER_ms']):9} "
            f"{len(r['local_modify_after_write']):<7} {len(r['shadow_stale_after_write']):<6}")
    say("")
    say(f"  tree quiet before measuring: {quiet}  ·  roles A={ROLES['A']} B={ROLES['B']}")
    Path(rf"H:\tmp\b41_observe_{RUN}.json").write_text(
        json.dumps({"run": RUN, "roles": ROLES, "quiet": quiet, "deltas": deltas,
                    "rungs": RUNGS}, indent=2), encoding="utf-8")
    Path(rf"H:\tmp\b41_observe_{RUN}.log").write_text("\n".join(out_lines), encoding="utf-8")
    say(f"  machine-readable: H:\\tmp\\b41_observe_{RUN}.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
