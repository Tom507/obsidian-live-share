"""REAL end-to-end tests against two live Obsidian instances.

Design rule, and the whole point:

    EDITS ARE DRIVEN BY WRITING THE .canvas FILE ON DISK.

`useCanvasBinding` is false, so the live capture path is
`vault.on("modify")` -> `handleLocalModify` -> the surface-shadow diff. Writing
the file is therefore the REAL path, the one the P0 fix lives on. We deliberately
do NOT use `canvas.simulateEdit`: it writes straight into the shared Y.Doc
(e2e-control.ts:995-1005) and returns a hardcoded `applied: true` (:1023), so a
suite built on it would measure doc -> relay -> doc and prove nothing about
capture. That is the vacuity this project spent months learning to spot.

Observation is via the control server (doc truth) AND the files on disk (user
truth). A scenario passes only when BOTH agree.


================================================================================
B44 — WHAT THE SCHEDULE DEPENDENCE TURNED OUT TO BE
================================================================================

The question this suite was asked: five of its checks flipped between the
schedule-preserving band (21/21) and `LS_S56_FAST=1` (16/20). Product defect, or
suite artefact? MEASURED ANSWER: BOTH, and they are separable.

THE PRODUCT DEFECT — the swallow window (measured 2026-08-07, runs 004534,
005427, 005600 of `liveshare_b41_observe_then_write.py`):

    A local whole-file write to a shared `.canvas` that lands within ~0.8 s of a
    REMOTE change having been applied to that same path is DROPPED. Not delayed —
    dropped. The bytes stay on the user's disk, `canvas.state` on that same
    instance never shows them, the peer never shows them, and 20 s later nothing
    has changed. There is NO `local modify` receipt: the event never reached
    `handleLocalModify` at all.

    ladder, positive control included, one instance host / one guest:
        delta <= 0.8 s   LOST  11/12   (0.0/0.1/0.2/0.3/0.5 also LOST 20/20
                                        across all four shapes)
        delta >= 0.9 s   OK     4/4

    Mechanism. LINE NUMBERS MEASURED AT COMMIT fb631f8, and against `git show`
    rather than the working tree — `file-ops.ts` carries a sibling's uncommitted
    change that moves `isPathMuted` to :219, and citing the tree would have
    produced a number nobody else could reproduce (Rule 5):

      vault-events.ts:232        `if (plugin.fileOpsManager.isPathMuted(file.path)) return;`
                                 the vault `modify` event is dropped OUTRIGHT,
                                 before any content is looked at, and with no
                                 log line — which is why the swallow leaves no
                                 receipt of any kind.
      file-ops.ts:196            `isPathMuted` is a bare per-path counter. No
                                 content test, no origin test: a GENUINE user
                                 edit is indistinguishable from our own echo.
      canvas-persistence.ts:53   `DISK_WRITE_SETTLE_MS = 250`
      canvas-persistence.ts:451  `acquireMute()` takes the mute for a write
      canvas-persistence.ts:463  `armSettleRelease()` CLEARS AND RE-ARMS the
                                 release on every write, so the mute is held for
                                 the whole BURST that applying one remote change
                                 provokes, plus 250 ms — not 250 ms per write.
                                 That is why the measured window is ~0.8 s and
                                 not the 250 ms the constant reads.
      canvas-sync.ts:3065        `if (this.recentDiskWrites.has(path)) return;`
                                 a second, independent drop of the same shape in
                                 `handleLocalModify`.

THE SUITE ARTEFACT — the greens were bought with an undeclared gap:

    Every scenario writes immediately after the previous scenario's propagation
    was observed, i.e. squarely inside that window. In the schedule band the
    residual hold (up to 9 s) carried each scenario out of it; in the fast band
    it did not. So the suite's green never meant "the edit propagated" — it meant
    "we waited long enough for the product not to be deaf". THAT is the artefact,
    and it is in the five checks below.

WHAT CHANGED HERE (B44)
    1. `write_and_confirm_capture()` — a write is now followed by observing THE
       WRITER'S OWN doc through `canvas.state`. Capture and propagation are
       adjudicated SEPARATELY, so a swallowed write is reported as a swallowed
       write and never again as "the peer did not receive it".
    2. `[02] endpoints survived intact` was CONDITIONAL and simply vanished when
       the edge failed to arrive — which is the entire reason the denominator
       moved 21 -> 20. It is unconditional now: no edge means FAIL, not absent.
    3. `[06]` required the node on A only, so `B: node gone` could pass for a
       node that was never on B. It now requires presence on BOTH before it
       deletes anything.
    4. `[06] no resurrection` was a bare `sleep(5)` and one look. It is a bounded
       WATCH now that reports how many observations it actually made, and it
       states the true cause when the deletion never propagated instead of
       accusing the product of resurrecting a node.
    5. The idempotency sweep reset ids but not GEOMETRY, so `[01]`'s x=777 ran
       against a canvas still carrying `[05]`'s x=1111 from the previous run.
       `reset_canvas()` — named in the old docstring but never written — exists.

THE BAND IS GONE AS A DEFAULT. The default now ENDS EVERY WAIT ON ITS STATE.
`LS_S56_KEEP_SCHEDULE=1` (alias `LS_S56_FAST=0`) restores the old hold, and it is
kept ONLY as a control: if a check passes under the hold and fails without it,
that check is measuring the clock and this file wants to know.

`LS_E2E_BREAK=mux|control` severs that link on the guest via `link.break` after
preflight. Every propagation check MUST go red under it. A check that stays green
with the link cut is a check that cannot fail, and is worse than a flaky one.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Optional

VAULTS = {
    "A": (Path(r"H:\Developement\_NeuralAngels\ObsidianOrga"), 39431),
    "B": (Path(r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie"), 39432),
}
CANVAS = "_liveshare-test/smoke.canvas"
SETTLE = 4.0

# IDEMPOTENCY. Every artefact this suite creates is namespaced with RUN, which is
# stamped once per process. Without it a re-run can be satisfied by the PREVIOUS
# run's leftovers: scenario [04] passed on run 2 only because run 1's node was
# still in the canvas. A suite that can pass for the wrong reason is the exact
# failure this project exists to avoid, so the ids are unique and `reset_canvas()`
# puts the canvas back to a known shape before anything is measured.
RUN = time.strftime("%H%M%S")
def rid(name: str) -> str:
    return f"{name}-{RUN}"

results: list[tuple[str, bool, str]] = []


def cmd(role: str, name: str, **args: Any) -> Any:
    _, port = VAULTS[role]
    body = json.dumps({"cmd": name, "args": args}).encode()
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/command", data=body,
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return {"ok": False, "error": f"HTTP {e.code}: {e.read().decode('utf-8','replace')[:300]}"}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}


def canvas_path(role: str) -> Path:
    return VAULTS[role][0] / CANVAS


def read_canvas(role: str) -> Optional[dict]:
    p = canvas_path(role)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


def write_canvas(role: str, data: dict) -> None:
    canvas_path(role).write_text(json.dumps(data, indent=2), encoding="utf-8")


def nodes_by_id(doc: Optional[dict]) -> dict:
    return {n.get("id"): n for n in (doc or {}).get("nodes", []) if isinstance(n, dict)}


def edges_by_id(doc: Optional[dict]) -> dict:
    return {e.get("id"): e for e in (doc or {}).get("edges", []) if isinstance(e, dict)}


# S56/B44 - THE BANDS. THE DEFAULT IS NOW THE ONE THAT ENDS ON ITS STATE.
#
# The old default held the residual budget after the state was observed, so the
# wall-clock schedule matched the bare sleeps it replaced. That hold was doing
# real work and nobody had said so: it was carrying each scenario's write out of
# the product's ~0.8 s swallow window (see the module docstring). A green bought
# that way certifies the schedule, not the product.
#
#   default              end the wait the moment the state is observed.
#   LS_S56_KEEP_SCHEDULE=1   hold the rest of the budget - THE CONTROL BAND.
#
# The control band is kept deliberately and only for this: a check that is green
# under the hold and red without it is measuring elapsed time, and the run says
# so at the bottom instead of the difference being folded into a score.
S56_HOLD = (os.environ.get("LS_S56_KEEP_SCHEDULE") == "1"
            or os.environ.get("LS_S56_FAST") == "0")
BAND = "schedule-hold (CONTROL)" if S56_HOLD else "state-ending (default)"

# LS_E2E_BREAK - the falsification injection. `link.break` (WP82,
# e2e-control.ts:910) severs one link on the GUEST after preflight. Local capture
# keeps working; nothing can reach the peer. Every propagation check must go red.
BREAK_LINK = os.environ.get("LS_E2E_BREAK", "").strip() or None


def _observed(label: str, deadline: float, budget: float) -> bool:
    left = deadline - time.monotonic()
    if left > 0:
        print(f"  .. observed after {budget - left:.1f}s of a {budget:.1f}s budget"
              f"{'; holding the remaining ' + format(left, '.1f') + 's (CONTROL band)' if S56_HOLD else ''}"
              f": {label}")
        if S56_HOLD:
            time.sleep(left)
    return True


def await_state(label: str, predicate, budget: float, interval: float = 0.2) -> bool:
    """S56 — a BOUNDED POLL standing exactly where a bare `sleep(budget)` stood.

    `budget` is the sleep it replaces, so the window in which the state may
    become true is byte-identical and no verdict can move; the wait simply ENDS
    EARLY when the state is observed and SAYS WHAT IT WAS WAITING FOR when it is
    not. It never asserts — the caller's own `check` still adjudicates.

    The rule this enforces: a green must mean *the state was reached*, not
    *enough time passed*. A bare sleep always completes, on a schedule unrelated
    to whether the thing happened, which is why it certifies nothing.
    """
    # The loop test is a CLOCK against a DEADLINE, deliberately: that is what makes
    # this a bounded wait rather than the hang class this sweep must not trade into.
    deadline = time.monotonic() + budget
    while time.monotonic() < deadline:
        try:
            if predicate():
                return _observed(label, deadline, budget)
        except Exception:  # noqa: BLE001 — a probe that cannot answer yet is not an answer
            pass
        time.sleep(min(interval, max(0.0, deadline - time.monotonic())))
    try:
        if predicate():
            return _observed(label, deadline, budget)
    except Exception:  # noqa: BLE001
        pass
    print(f"  !! WAIT TIMED OUT after {budget:.1f}s waiting for: {label}")
    return False


def settle(seconds: float = SETTLE, until=None, label: str = "") -> bool:
    """Quiesce both instances, then wait for THE STATE — not for the clock.

    S56. `sync.waitQuiescent` already answers `{quiescent: bool}` and this
    function used to throw that answer away and then sleep the same budget over
    again. Now the answer is read and reported, and the residual budget is a
    bounded poll on the caller's own condition. `seconds` is unchanged.

    A caller with no observable condition passes none and gets the old blind
    sleep — with the reason it is blind stated at the call site, never silently.
    """
    quiet = {}
    for role in VAULTS:
        r = cmd(role, "sync.waitQuiescent", path=CANVAS, timeoutMs=int(seconds * 1000))
        quiet[role] = (r.get("result") or {}).get("quiescent")
    if not all(quiet.get(role) for role in VAULTS):
        # Previously invisible: the suite asked, was told "no", and slept anyway.
        print(f"  !! NOT QUIESCENT within {seconds:.0f}s: {quiet}")
    if until is None:
        time.sleep(seconds)
        return False
    return await_state(label or "the scenario's own post-condition", until, seconds)


def check(name: str, ok: bool, detail: str = "") -> bool:
    results.append((name, ok, detail))
    print(f"  {'PASS' if ok else '>>> FAIL'}  {name}" + (f"\n           {detail}" if detail else ""))
    return ok


# ---------------------------------------------------------------------------
# B44 — CAPTURE IS A SEPARATE QUESTION FROM PROPAGATION, AND IT HAS ITS OWN ORACLE
# ---------------------------------------------------------------------------


def doc_ids(role: str) -> tuple[set, set]:
    """The WRITER'S OWN doc, read through the control server.

    This is the oracle the suite never had. `canvas.state` answers about the
    Y.Doc of the instance being asked, so it separates
        "my own edit was never captured"      (doc lacks it)
    from
        "captured here, never arrived there"  (doc has it, peer's file does not).
    Every failure this suite reported before conflated the two, and the swallow
    defect lives entirely in the first one.
    """
    r = cmd(role, "canvas.state", path=CANVAS)
    if not r.get("ok"):
        return set(), set()
    st = r.get("result") or {}
    return ({n.get("id") for n in st.get("nodes", []) if isinstance(n, dict)},
            {e.get("id") for e in st.get("edges", []) if isinstance(e, dict)})


def write_and_confirm_capture(role: str, doc: dict, what: str, *,
                              present: tuple = (), absent: tuple = (),
                              edges: bool = False, budget: float = 10.0) -> bool:
    """Write the file, then OBSERVE that this instance's own doc took the change.

    Records a check of its own. This is the anti-sleep: nothing here waits for a
    duration, it waits for `canvas.state` to agree with the bytes we just wrote,
    and it says which of the two failed when they disagree.

    A swallowed write is a REAL PRODUCT FAILURE and is reported as one — it is
    not retried and not slept around. Retrying would re-issue the `modify` event
    outside the mute window and turn the defect back into a green, which is the
    exact move that hid it for the life of this suite.
    """
    write_canvas(role, doc)
    ok = await_state(
        f"{role}'s OWN doc to carry {what} (capture, before any peer is involved)",
        lambda: (lambda n, e: (all(i in (e if edges else n) for i in present)
                               and all(i not in (e if edges else n) for i in absent)))(
            *doc_ids(role)),
        budget,
    )
    n, e = doc_ids(role)
    have = e if edges else n
    return check(
        f"{role}: the local write was CAPTURED ({what})", ok,
        "" if ok else
        f"the bytes are on {role}'s disk and {role}'s OWN doc does not have them. "
        f"This is the swallow window (vault-events.ts:232 / file-ops.ts:196 / "
        f"canvas-persistence.ts:439-445), not a relay or peer fault. "
        f"present-wanted={list(present)} absent-wanted={list(absent)} "
        f"doc-has={sorted(i for i in have if i)[:12]}")


# ---------------------------------------------------------------------------


def sweep_previous_runs() -> tuple[int, int]:
    """Remove every artefact earlier runs left behind, in BOTH vaults.

    Without this the suite is not idempotent: leftover nodes and edges make a
    later run's assertions true for the PREVIOUS run's reasons. Scenario [04]
    passed on run 2 for exactly that reason. Returns
    (nodes+edges removed, stray canvas files removed) so a run states the shape
    it started from instead of quietly inheriting one.
    """
    marks = 0
    for role in VAULTS:
        doc = read_canvas(role)
        if not doc:
            continue
        before = len(doc.get("nodes", [])) + len(doc.get("edges", []))
        doc["nodes"] = [n for n in doc.get("nodes", [])
                        if not str(n.get("id", "")).startswith(("empty-card-", "from-guest-"))]
        doc["edges"] = [e for e in doc.get("edges", [])
                        if not str(e.get("id", "")).startswith("edge-sideless-")]
        after = len(doc["nodes"]) + len(doc["edges"])
        if after != before:
            write_canvas(role, doc)
            marks += before - after
    files = 0
    for role in VAULTS:
        folder = VAULTS[role][0] / "_liveshare-test"
        if folder.is_dir():
            for stray in folder.glob("second-*.canvas"):
                try:
                    stray.unlink()
                    files += 1
                except OSError:
                    pass
    return marks, files


# B44 — the old docstring promised `reset_canvas()` "puts the canvas back to a
# known shape before anything is measured". No such function was ever written,
# and the gap was load-bearing: the sweep removed IDS but never GEOMETRY, so
# `[01]` asserted x==777 on a canvas whose node still carried x=1111 from the
# PREVIOUS run's `[05]`. In the fast band that produced `A kept the move  A.x=1111`
# — a failure that looks exactly like a product defect and is a leftover.
GEOMETRY_BASELINE = {"x": 0, "y": 0}


def reset_canvas() -> str:
    """Put both replicas' geometry back to a stated shape. Returns what it did."""
    doc = read_canvas("A")
    if not doc or not doc.get("nodes"):
        return "no canvas on A to reset"
    moved = 0
    for i, n in enumerate(doc["nodes"]):
        want_x = GEOMETRY_BASELINE["x"] + 240 * i
        want_y = GEOMETRY_BASELINE["y"]
        if n.get("x") != want_x or n.get("y") != want_y:
            n["x"], n["y"] = want_x, want_y
            moved += 1
    if moved:
        write_canvas("A", doc)
    return f"reset the geometry of {moved}/{len(doc['nodes'])} node(s) on A to a stated baseline"


def scenario_00_preflight() -> None:
    print("\n[00] preflight — both instances reachable, canvas open on both")
    marks, files = sweep_previous_runs()
    print(f"  idempotency sweep: removed {marks} leftover node/edge(s), {files} stray canvas file(s)")
    print(f"  this run's artefacts are namespaced -{RUN}")
    # S56 — the sweep rewrote both canvases; what this waited for is that the
    # rewrite has been observed by the product, i.e. no swept id is left in
    # either replica. Same 3 s budget, but now it is the STATE that ends it.
    stale = ("empty-card-", "from-guest-", "edge-sideless-")
    await_state(
        "both replicas to be free of every id the idempotency sweep removed",
        lambda: not any(
            str(i).startswith(stale)
            for role in VAULTS
            for i in list(nodes_by_id(read_canvas(role))) + list(edges_by_id(read_canvas(role)))
        ),
        3,
    )
    for role in VAULTS:
        info = cmd(role, "session.info")
        check(f"{role}: control server answers", bool(info.get("ok")), json.dumps(info)[:200])
    for role in VAULTS:
        if not canvas_path(role).exists():
            src = read_canvas("A")
            if src:
                write_canvas(role, src)
                # S56 — what this stood in for is "the instance can now answer
                # about this canvas", which `canvas.state` observes directly.
                await_state(
                    f"{role} to answer canvas.state for the canvas just seeded",
                    lambda role=role: bool(cmd(role, "canvas.state", path=CANVAS).get("ok")),
                    2,
                )
    # S45 — `canvas.open` SUBSCRIBES BUT OPENS NO LEAF, and the leaf-open attach is
    # gated on `!isSubscribed`, so calling it *permanently disables* the seam that
    # attaches the disk writer. Every file-level assertion after it then measures the
    # rig, not the product.
    #
    # This was load-bearing: five rows of this suite failed for months of runs and were
    # read as a product baseline (19/18, then 13/18). Measured by WP85: both peers'
    # DOCS were byte-identical at 25 nodes while both FILES sat at 18-19, with no
    # writer attached on either peer. Opening a real leaf converged both files
    # 6->25 / 7->25 within 8 s.
    #
    # `canvas.typeInNode` with no text and no blur is a NON-INVASIVE read that opens
    # the real leaf, so it attaches the writer the way the product does.
    for role in VAULTS:
        r = cmd(role, "canvas.open", path=CANVAS)
        check(f"{role}: canvas.open", bool(r.get("ok")), json.dumps(r)[:220])
    node_ids = list(nodes_by_id(read_canvas("A")))
    if node_ids:
        for role in VAULTS:
            r = cmd(role, "canvas.typeInNode", path=CANVAS, nodeId=node_ids[0], open=True)
            check(f"{role}: real leaf open (writer attaches)", bool(r.get("ok")),
                  json.dumps(r)[:220])
    else:
        check("a node id was available to open a leaf with", False,
              "without one this run measures the rig, not the product")
    # S56 — the warm-up's real post-condition is the one every later scenario
    # assumes without stating: the two replicas start from the SAME node set.
    settle(8, until=lambda: set(nodes_by_id(read_canvas("A"))) == set(nodes_by_id(read_canvas("B"))),
           label="the two replicas to agree on their node set before anything is measured")
    # B44 — geometry, which the id sweep never touched.
    print(f"  {reset_canvas()}")
    settle(8,
           until=lambda: json.dumps(nodes_by_id(read_canvas("A")), sort_keys=True)
           == json.dumps(nodes_by_id(read_canvas("B")), sort_keys=True),
           label="both replicas to carry the reset geometry, node for node")
    same = (json.dumps(nodes_by_id(read_canvas("A")), sort_keys=True)
            == json.dumps(nodes_by_id(read_canvas("B")), sort_keys=True))
    check("the run starts from a stated, converged canvas (idempotency)", same,
          "" if same else "the two replicas differ BEFORE anything is measured; every "
                          "verdict below would inherit that difference")
    # B44 — the falsification injection, armed AFTER preflight so preflight's own
    # checks still describe a working rig. Nothing below may stay green under it.
    if BREAK_LINK:
        # `shape="close"` is NOT a break: `autoReconnect` re-establishes the
        # socket within the scenario, and a first attempt at this injection
        # scored 29/29 with the link nominally "severed" — the injection had
        # measured nothing. `shape="silence"` leaves the socket OPEN and stops
        # delivering, which is the condition the checks below actually depend on.
        r = cmd("B", "link.break", link=BREAK_LINK, shape="silence")
        check(f"INJECTION: guest's '{BREAK_LINK}' link silenced", bool(r.get("ok")),
              json.dumps(r)[:200])
        print(f"  !! FALSIFICATION RUN — every propagation check below MUST go red.")


def scenario_01_move_card() -> None:
    """The core P0 claim: a geometry change on one side reaches the other."""
    print("\n[01] move a card in A by writing the FILE (the real capture path)")
    doc = read_canvas("A")
    if not doc or not doc.get("nodes"):
        return check("A has a canvas with nodes", False, str(doc)[:200]) and None
    doc["nodes"][0]["x"] = 777
    doc["nodes"][0]["y"] = -333
    node_id = doc["nodes"][0]["id"]
    # B44 — geometry has no id to poll for, so capture is confirmed by the value
    # arriving in A's OWN doc. `canvas.state` is the writer's doc, not the file.
    write_canvas("A", doc)
    captured = await_state(
        f"A's OWN doc to carry {node_id}.x=777 (capture, before B is involved)",
        lambda: any(n.get("id") == node_id and n.get("x") == 777
                    for n in ((cmd("A", "canvas.state", path=CANVAS).get("result") or {})
                              .get("nodes") or [])),
        10)
    check("A: the local write was CAPTURED (move x=777)", captured,
          "" if captured else "the bytes are on A's disk and A's OWN doc does not have "
                              "them — the swallow window, not a peer fault")
    settle(6, until=lambda: nodes_by_id(read_canvas("B")).get(node_id, {}).get("x") == 777,
           label=f"B's copy of node {node_id} to carry x=777")
    a, b = nodes_by_id(read_canvas("A")), nodes_by_id(read_canvas("B"))
    check("A kept the move", a.get(node_id, {}).get("x") == 777,
          f"A.x={a.get(node_id, {}).get('x')}")
    check("B received the move", b.get(node_id, {}).get("x") == 777,
          f"B.x={b.get(node_id, {}).get('x')} B.y={b.get(node_id, {}).get('y')}")


def scenario_02_sideless_edge() -> None:
    """Side-less edges are legal JSON Canvas and were the documented data-loss case."""
    print("\n[02] side-less edge — legal JSON Canvas, the documented data-loss case")
    doc = read_canvas("A")
    if not doc:
        return check("A canvas readable", False) and None
    ids = [n["id"] for n in doc.get("nodes", [])][:2]
    if len(ids) < 2:
        return check("two nodes present", False, str(ids)) and None
    doc.setdefault("edges", []).append(
        {"id": rid("edge-sideless"), "fromNode": ids[0], "toNode": ids[1]})
    write_and_confirm_capture("A", doc, f"the side-less edge {rid('edge-sideless')}",
                              present=(rid("edge-sideless"),), edges=True)
    settle(6, until=lambda: rid("edge-sideless") in edges_by_id(read_canvas("B")),
           label=f"the side-less edge {rid('edge-sideless')} to appear in B's file")
    ea, eb = edges_by_id(read_canvas("A")), edges_by_id(read_canvas("B"))
    check("A still has the side-less edge (I11: refusal never destroys)",
          rid("edge-sideless") in ea, f"A edges={list(ea)}")
    check("B received the side-less edge", rid("edge-sideless") in eb, f"B edges={list(eb)}")
    # B44 — THIS CHECK USED TO BE CONDITIONAL, and that is the whole reason the
    # denominator moved 21 -> 20 between the bands. `if edge in eb:` meant that
    # when the edge failed to arrive the check was not recorded AT ALL: it did not
    # fail, it ceased to exist, and the run reported a smaller total that read as
    # "fewer things were asked" rather than "one of them was unanswerable".
    # A check that can vanish cannot fail. It is unconditional now, and the
    # absence of the edge is its FAILURE, stated as such.
    e = eb.get(rid("edge-sideless"))
    check("endpoints survived intact",
          bool(e) and e.get("fromNode") == ids[0] and e.get("toNode") == ids[1],
          json.dumps(e) if e else
          f"the edge never reached B, so its endpoints cannot be intact — "
          f"this is a FAILURE, not an inapplicable check. B edges={list(eb)}")


def scenario_03_empty_text() -> None:
    """`"text": ""` is a legal empty card. Presence counts, not non-emptiness."""
    print('\n[03] empty text card — `"text": ""` is legal, presence counts not non-emptiness')
    doc = read_canvas("A")
    if not doc:
        return check("A canvas readable", False) and None
    doc.setdefault("nodes", []).append(
        {"id": rid("empty-card"), "type": "text", "text": "", "x": 500, "y": 500,
         "width": 200, "height": 100})
    write_and_confirm_capture("A", doc, f"the empty card {rid('empty-card')}",
                              present=(rid("empty-card"),))
    settle(6, until=lambda: rid("empty-card") in nodes_by_id(read_canvas("B")),
           label=f"the empty card {rid('empty-card')} to appear in B's file")
    na, nb = nodes_by_id(read_canvas("A")), nodes_by_id(read_canvas("B"))
    check("A kept the empty card", rid("empty-card") in na, f"A nodes={list(na)}")
    check("B received the empty card", rid("empty-card") in nb, f"B nodes={list(nb)}")


def scenario_04_guest_to_host() -> None:
    """Sync must be symmetric — the guest is not a read-only mirror."""
    print("\n[04] reverse direction — an edit in the GUEST reaches the host")
    doc = read_canvas("B")
    if not doc:
        return check("B canvas readable", False) and None
    doc.setdefault("nodes", []).append(
        {"id": rid("from-guest"), "type": "text", "text": "made in B", "x": -600, "y": 400,
         "width": 200, "height": 100})
    write_and_confirm_capture("B", doc, f"the guest's node {rid('from-guest')}",
                              present=(rid("from-guest"),))
    settle(6, until=lambda: rid("from-guest") in nodes_by_id(read_canvas("A")),
           label=f"the guest's node {rid('from-guest')} to appear in A's file")
    na = nodes_by_id(read_canvas("A"))
    check("host received the guest's node", rid("from-guest") in na, f"A nodes={list(na)}")


def scenario_05_concurrent() -> None:
    """Both sides move DIFFERENT cards at once — must converge, losing neither."""
    print("\n[05] concurrent edits on both sides — convergence without loss")
    da, db = read_canvas("A"), read_canvas("B")
    if not da or not db or len(da.get("nodes", [])) < 2:
        return check("both canvases readable with 2+ nodes", False) and None
    ids = [n["id"] for n in da["nodes"]][:2]
    for n in da["nodes"]:
        if n["id"] == ids[0]:
            n["x"] = 1111
    for n in db["nodes"]:
        if n["id"] == ids[1]:
            n["x"] = 2222
    write_canvas("A", da)
    write_canvas("B", db)
    settle(
        9,
        until=lambda: (
            nodes_by_id(read_canvas("A")).get(ids[0], {}).get("x") == 1111
            and nodes_by_id(read_canvas("B")).get(ids[0], {}).get("x") == 1111
            and nodes_by_id(read_canvas("A")).get(ids[1], {}).get("x") == 2222
            and nodes_by_id(read_canvas("B")).get(ids[1], {}).get("x") == 2222
        ),
        label=f"both replicas to carry BOTH concurrent moves ({ids[0]}.x=1111, {ids[1]}.x=2222)",
    )
    na, nb = nodes_by_id(read_canvas("A")), nodes_by_id(read_canvas("B"))
    check("A's edit survived on both",
          na.get(ids[0], {}).get("x") == 1111 and nb.get(ids[0], {}).get("x") == 1111,
          f"A={na.get(ids[0],{}).get('x')} B={nb.get(ids[0],{}).get('x')}")
    check("B's edit survived on both",
          na.get(ids[1], {}).get("x") == 2222 and nb.get(ids[1], {}).get("x") == 2222,
          f"A={na.get(ids[1],{}).get('x')} B={nb.get(ids[1],{}).get('x')}")
    check("the two replicas converged",
          json.dumps(na, sort_keys=True) == json.dumps(nb, sort_keys=True),
          f"A ids={sorted(na)} B ids={sorted(nb)}")


def scenario_06_delete() -> None:
    """Deletion is a value, not an absence — it must propagate, not resurrect."""
    print("\n[06] delete a node — deletion propagates and does not resurrect")
    doc = read_canvas("A")
    # B44 — THE PRECONDITION USED TO NAME ONLY A. `B: node gone` then asserted an
    # ABSENCE on a peer that may never have had the node: if `[03]` failed to
    # propagate, `empty-card-<RUN>` was never on B and "it is not on B" was true
    # for free. A per-run id makes absence the DEFAULT state, so an absence check
    # without a presence precondition is a green that cannot fail — this project's
    # signature defect, sitting in the scenario that tests deletion.
    on_a = rid("empty-card") in nodes_by_id(doc)
    on_b = rid("empty-card") in nodes_by_id(read_canvas("B"))
    if not (on_a and on_b):
        why = (f"A={on_a} B={on_b} — refusing to measure a deletion that cannot be "
               f"distinguished from a node that was never there")
        check(f"{rid('empty-card')} present on BOTH peers to delete", False, why)
        # B44 — and the three checks downstream are recorded as FAILURES, not
        # skipped. Returning here is what made the denominator move in the first
        # place; a check that is missing "has not passed and has not failed, it
        # has escaped adjudication". The run is short of an answer either way,
        # and a run that could not answer has not passed.
        for name in ("A: the local write was CAPTURED (the deletion)",
                     "A: node gone", "B: node gone",
                     "no resurrection after a further watch"):
            check(name, False, f"NOT ADJUDICATED — {why}")
        return None
    check(f"{rid('empty-card')} present on BOTH peers to delete", True)
    doc["nodes"] = [n for n in doc["nodes"] if n.get("id") != rid("empty-card")]
    write_and_confirm_capture("A", doc, f"the deletion of {rid('empty-card')}",
                              absent=(rid("empty-card"),))
    settle(8, until=lambda: rid("empty-card") not in nodes_by_id(read_canvas("B")),
           label=f"the deletion of {rid('empty-card')} to reach B's file")
    na, nb = nodes_by_id(read_canvas("A")), nodes_by_id(read_canvas("B"))
    check("A: node gone", rid("empty-card") not in na, f"A nodes={list(na)}")
    gone_b = rid("empty-card") not in nb
    check("B: node gone", gone_b, f"B nodes={list(nb)}")

    # B44 — a NON-EVENT is still not pollable, but it is WATCHABLE, and the two
    # are not the same instrument. The old form was `sleep(5)` and one look: it
    # could not say how much of that window it had actually observed, and if the
    # node reappeared and vanished again inside the five seconds it saw nothing.
    # Worse, when the DELETION had never propagated at all this check failed with
    # "no resurrection" — accusing the product of resurrecting a node it had
    # simply never deleted. Both are fixed: the watch reports its own sample
    # count (a zero-sample pass is impossible), and the check states the true
    # cause when the precondition for a resurrection was never established.
    watch_s, interval = 5.0, 0.2
    deadline = time.monotonic() + watch_s
    samples, sightings = 0, []
    while time.monotonic() < deadline:
        samples += 1
        for role in VAULTS:
            if rid("empty-card") in nodes_by_id(read_canvas(role)):
                sightings.append((role, round(watch_s - (deadline - time.monotonic()), 2)))
        time.sleep(interval)
    if not gone_b:
        check("no resurrection after a further watch", False,
              f"NOT A RESURRECTION — the deletion never reached B in the first place, "
              f"so this check never had its precondition. {samples} samples over "
              f"{watch_s:.0f}s. Read the capture/propagation checks above for the cause.")
    else:
        check("no resurrection after a further watch",
              not sightings and samples > 0,
              f"watched both replicas for {watch_s:.0f}s, {samples} samples at "
              f"{interval}s; sightings={sightings[:6]}")


def scenario_07_new_canvas_distribution() -> None:
    """WP79: does a canvas created on the host reach the guest at all?"""
    print("\n[07] NEW canvas on the host — does it reach the guest? (WP79)")
    new_rel = f"_liveshare-test/second-{RUN}.canvas"
    (VAULTS["A"][0] / new_rel).write_text(json.dumps({
        "nodes": [{"id": "n1", "type": "text", "text": f"second canvas {RUN}",
                   "x": 0, "y": 0, "width": 200, "height": 100}],
        "edges": [],
    }, indent=2), encoding="utf-8")
    # S56 — the awaited state is exactly the thing the check asserts, and it is
    # directly observable on disk. Same 12 s window; on failure the wait now says
    # what never arrived instead of just having elapsed.
    await_state(f"the guest's copy of {new_rel} to exist on disk",
                lambda: (VAULTS["B"][0] / new_rel).exists(), 12)
    guest_has = (VAULTS["B"][0] / new_rel).exists()
    check("guest received a canvas it never had (expected FAIL until WP79)", guest_has,
          "confirms the circular dependency: background-sync.ts:97 skips .canvas, "
          "coldOpen only runs on open, open needs the file")


# B44 — the run must assert its own SHAPE, not only its score. Every check above
# is unconditional now, so the total is a constant of the suite; if it moves, a
# check vanished rather than failed and the score is not comparable to any other
# run. That is exactly how 21/21 and 16/20 were ever put side by side.
EXPECTED_CHECKS = 28


def main() -> int:
    print("=" * 78)
    print("REAL E2E — two live Obsidian instances, edits via the real capture path")
    print(f"band: {BAND}" + (f"   INJECTION: link.break {BREAK_LINK} on the guest"
                             if BREAK_LINK else ""))
    print("=" * 78)
    for fn in (scenario_00_preflight, scenario_01_move_card, scenario_02_sideless_edge,
               scenario_03_empty_text, scenario_04_guest_to_host, scenario_05_concurrent,
               scenario_06_delete, scenario_07_new_canvas_distribution):
        try:
            fn()
        except Exception as e:
            check(f"{fn.__name__} raised", False, f"{type(e).__name__}: {e}")

    if BREAK_LINK:
        r = cmd("B", "link.restore", link=BREAK_LINK)
        print(f"\n  teardown: link.restore {BREAK_LINK} -> {json.dumps(r)[:160]}")

    passed = sum(1 for _, ok, _ in results if ok)
    print("\n" + "=" * 78)
    print(f"RESULT: {passed}/{len(results)} checks passed   [band: {BAND}]")
    for name, ok, detail in results:
        if not ok:
            print(f"  FAIL  {name}" + (f"  [{detail[:140]}]" if detail else ""))
    expected = EXPECTED_CHECKS + (1 if BREAK_LINK else 0)
    if len(results) != expected:
        print(f"\n  !! DENOMINATOR MOVED: {len(results)} checks recorded, {expected} expected.")
        print("     A check that is absent has not passed and has not failed — it has")
        print("     escaped adjudication, and this run is NOT comparable to another.")
    if BREAK_LINK:
        print("\n  FALSIFICATION RUN: the numbers above are only meaningful as a")
        print("  demonstration that these checks CAN go red. A high score here is a")
        print("  defect in the suite, not a success.")
    print("=" * 78)
    return 0


if __name__ == "__main__":
    sys.exit(main())
