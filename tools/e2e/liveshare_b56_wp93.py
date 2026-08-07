"""B56 / W4 — WP93's two undischarged §7b live arms.

The implementor stated plainly that neither is discharged. Both are taken here,
and the AC4 arm is the one most likely to end NOT DEMONSTRATED — which the
charter itself anticipates: *"A live run in which no overrun is ever counted has
not demonstrated that the instrument is wired; it has demonstrated that the tail
is 0.7 %."* So the AC4 arm reports the pulse-gap telltale for its own window
whatever the outcome, and a run with no clamp in it is reported as a run with no
clamp in it — never as a pass.

AC5 (§7b row 2) — THE NO-COLLATERAL ARM, IN THE REAL EDITOR
-----------------------------------------------------------
    "A remote create, a remote delete, a remote rename and a remote binary
     modify, each applied while the local user is idle, must produce no outbound
     echo and must leave `isPathMuted` FALSE afterwards."

`fileop.inject` is the right instrument and it is not a shortcut: the frame goes
to the live control socket, so `applyRemoteOp` takes the mute exactly as a real
peer's op would, and `vault-events.ts`'s five gates then see Obsidian's OWN
event ordering — which is the half the charter says no fake reproduces.

Two observables per row, and they are different questions:
  * `mutedAfterDispatch` — the mute WAS taken (sampled across the window and
    latched). If this is false the op never reached `applyRemoteOp` and the row
    is measuring nothing; that is why it is reported rather than assumed.
  * `after[].muted` — `FileOpsManager.isPathMuted` at the end of the window.
    THIS is AC5's assertion: the mute was released, not stranded.
  * no outbound echo — the PEER's shared tree is snapshotted before and after
    and must not gain a mirrored change for the injected path.

AC4 (§7b row 1) — THE LIVE OVERRUN COUNTER
------------------------------------------
`MUTE OVERRUN:` has exactly one emitter (`file-ops.ts:508`) and fires when a
release lands later than its own ceiling. There is NO e2e command exposing
`getMuteReleaseStats()`, so the log line is the only live reading available —
its `(overruns=N)` field is the counter. The arm drives many mute-taking ops and
reports the count, the pulse-gap telltale, and — honestly — whether a clamp
occurred in the window at all.

SAFETY: every path this file touches is named `b56-wp93-<run>-…` and is created
by this run. No owner file is created, modified, renamed or deleted.
"""

from __future__ import annotations

import base64
import json
import subprocess
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
    dump,
    gate,
    guest_role,
    host_role,
    log_path,
    say,
    snapshot_shared,
    vpath,
    waiter,
)

NEEDED = ("session.info", "canvas.state", "fileop.inject")


def inject(role: str, op: dict, settle: int = 1500) -> dict:
    r = cmd(role, "fileop.inject", timeout=90, op=op, settleMs=settle)
    return r.get("result") if r.get("ok") else {"__error__": r.get("error")}


def after_muted(res: dict) -> dict:
    return {o["path"]: o["muted"] for o in (res.get("after") or [])}


def before_exists(res: dict) -> dict:
    return {o["path"]: o["exists"] for o in (res.get("before") or [])}


def after_exists(res: dict) -> dict:
    return {o["path"]: o["exists"] for o in (res.get("after") or [])}


# =========================================================================== #
def ac5(target: str, peer: str) -> dict:
    say("")
    say("=" * 78)
    say(f"  AC5 — the four remote ops on {target}, local user IDLE")
    say("=" * 78)
    base = f"{SHARED}/b56-wp93-{RUN}"
    rows: dict = {}

    def row(name: str, op: dict, expect_paths: tuple[str, ...]) -> None:
        peer_before = snapshot_shared()[peer]
        res = inject(target, op)
        peer_after = snapshot_shared()[peer]
        if "__error__" in res:
            say(f"    {name:22} COMMAND ERROR: {res['__error__']}")
            rows[name] = {"error": res["__error__"]}
            return
        am = after_muted(res)
        echo = {k: (peer_before.get(k), peer_after.get(k))
                for k in set(peer_before) | set(peer_after)
                if peer_before.get(k) != peer_after.get(k)}
        stranded = [p for p, m in am.items() if m]
        rows[name] = {
            "op": op["type"],
            "delivered": res.get("delivered"),
            "reason": res.get("reason"),
            "mute_was_taken": res.get("mutedAfterDispatch"),
            "mutated": res.get("mutated"),
            "changed": res.get("changed"),
            "before_exists": before_exists(res),
            "after_exists": after_exists(res),
            "after_isPathMuted": am,
            "stranded_mutes": stranded,
            "peer_tree_delta": {k: [v[0], v[1]] for k, v in echo.items()},
            "samples": res.get("samples"),
        }
        say(f"    {name:22} delivered={res.get('delivered')} "
            f"mute_taken={res.get('mutedAfterDispatch')} mutated={res.get('mutated')}")
        say(f"      {'':20} after isPathMuted={am}  stranded={stranded or 'none'}")
        say(f"      {'':20} peer tree delta={list(echo) or 'none'}")

    # 1. remote CREATE
    row("remote create", {"type": "create", "path": f"{base}-a.md",
                          "content": f"b56 wp93 ac5 fixture {RUN}\n"},
        (f"{base}-a.md",))
    # 2. remote BINARY MODIFY — `binary: true` with base64 content, the shape
    #    `applyRemoteOpInner` routes to `vault.modifyBinary`.
    row("remote binary modify",
        {"type": "modify", "path": f"{base}-a.md", "binary": True,
         "content": base64.b64encode(f"b56 wp93 binary {RUN}".encode()).decode()},
        (f"{base}-a.md",))
    # 3. remote RENAME (inside the shared tree — WP68's gate must not fire)
    row("remote rename", {"type": "rename", "oldPath": f"{base}-a.md",
                          "newPath": f"{base}-b.md"},
        (f"{base}-a.md", f"{base}-b.md"))
    # 4. remote DELETE
    row("remote delete", {"type": "delete", "path": f"{base}-b.md"},
        (f"{base}-b.md",))

    # cleanup, on disk, of anything the four rows left behind
    for suffix in ("-a.md", "-b.md"):
        for r in VAULTS:
            p = vpath(r, f"{base}{suffix}")
            if p.exists():
                p.unlink()
                say(f"    cleanup: removed {r}:{base}{suffix}")
    return rows


# =========================================================================== #
def ac4(target: str, peer: str, load: bool, seconds: float) -> dict:
    """Drive many mute-taking ops and report whether any release OVERRAN.

    `load` spawns CPU contention — the same provocation B54 used to reproduce
    S74's failure shape. It does not fake the clamp and it is not claimed to BE
    the clamp: it produces genuine scheduler delay, which is the mechanism the
    ceiling is exposed to. Whether it is sufficient is the measurement.
    """
    say("")
    say("=" * 78)
    say(f"  AC4 — the live overrun counter (load={load}, window={seconds:.0f}s)")
    say("=" * 78)
    w = waiter()
    mark = w.mark("wp93-ac4")
    t0 = time.time()

    workers = []
    if load:
        import os
        n = max(4, (os.cpu_count() or 4))
        say(f"    spawning {n} busy processes for CPU contention")
        for _ in range(n):
            workers.append(subprocess.Popen(
                [sys.executable, "-c",
                 "import time\nt=time.time()+%f\nx=0\nwhile time.time()<t: x+=1" % seconds],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))

    base = f"{SHARED}/b56-wp93-{RUN}-ovr"
    n_ops = 0
    deadline = time.time() + seconds
    i = 0
    while time.time() < deadline:
        i += 1
        p = f"{base}-{i}.md"
        for role in (target, peer):
            inject(role, {"type": "create", "path": p, "content": f"{i}"}, settle=60)
            inject(role, {"type": "delete", "path": p}, settle=60)
            n_ops += 2
    for wkr in workers:
        try:
            wkr.wait(timeout=30)
        except Exception:  # noqa: BLE001
            wkr.kill()
    say(f"    drove {n_ops} mute-taking ops over {time.time() - t0:.1f}s")

    for r in VAULTS:
        d = vpath(r, SHARED)
        if d.is_dir():
            for f in d.iterdir():
                if f.is_file() and f"b56-wp93-{RUN}-ovr" in f.name:
                    f.unlink()
                    say(f"    cleanup: removed {r}:{f.name}")

    mark.close()
    ev = w.collect(mark, tuple(ls_b56.RECEIPTS), timeout_s=240)
    say("")
    say("  " + ev.summary().replace("\n", "\n  "))

    overrun = ev.hits("MUTE OVERRUN:")
    say(f"    'MUTE OVERRUN:' in the window: {len(overrun)}")
    for ln in overrun[:8]:
        say(f"      {ln.strip()[:200]}")

    # THE TELLTALE the charter asks for: was there a clamp in this window at all?
    gaps = []
    for role in VAULTS:
        for ln in ev.hits("awareness pulse: gap", role):
            try:
                gaps.append((role, int(ln.split("gap ")[1].split("ms")[0])))
            except Exception:  # noqa: BLE001
                pass
    worst = max((g for _, g in gaps), default=None)
    clamped = [g for g in gaps if g[1] >= 40000]
    say(f"    pulse-gap telltale: {len(gaps)} pulses in window, "
        f"worst={worst}ms, pulses in the 40-70 s clamp band={len(clamped)}")
    say(f"    'AWARENESS GAP:' lines in the window: {len(ev.hits('AWARENESS GAP:'))}")

    table = ls_b56.rule15(ev)
    return {"ops_driven": n_ops, "window_s": seconds, "load": load,
            "overrun_lines": overrun[:10], "overrun_count": len(overrun),
            "pulses_in_window": len(gaps), "worst_gap_ms": worst,
            "clamped_pulses": len(clamped),
            "awareness_gap_lines": len(ev.hits("AWARENESS GAP:")),
            "rule15": table}


def main() -> int:
    if not gate("WP93 §7b — the two live arms", NEEDED):
        say("\nREFUSING TO MEASURE — the gate did not pass.")
        return 2
    h, g = host_role(), guest_role()
    say(f"  HOST = {h}   GUEST = {g}   (asked, not assumed)")
    clamp_report()
    pre = snapshot_shared()

    out = {"roles": dict(ls_b56.ROLES), "target": g, "peer": h}
    out["ac5"] = ac5(g, h)
    out["ac5_host_arm"] = ac5(h, g)
    out["ac4"] = ac4(g, h, load=True, seconds=90.0)

    post = snapshot_shared()
    say("")
    say("  ---- shared trees, before vs after this arm ----")
    for r in VAULTS:
        added = sorted(set(post[r]) - set(pre[r]))
        removed = sorted(set(pre[r]) - set(post[r]))
        changed = sorted(k for k in set(pre[r]) & set(post[r]) if pre[r][k] != post[r][k])
        say(f"    {r}: added={added} removed={removed} changed={changed}")
        out.setdefault("tree_delta", {})[r] = {"added": added, "removed": removed,
                                               "changed": changed}
    dump("wp93", out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
