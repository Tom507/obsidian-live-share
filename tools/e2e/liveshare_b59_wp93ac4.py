"""B59 / W4 — ARM 2. WP93 AC4: the mute-release ceiling, with a LIVE READER.

WHY THIS ARM IS DIFFERENT FROM THE LAST ATTEMPT. B56 reported AC4 NOT
DEMONSTRATED: 0 overruns, `MUTE OVERRUN:` history_hits=0 (so its silence was
UNINFORMATIVE and no absence claim over it was admissible), and 0 awareness
pulses in the 40-70 s clamp band. `getMuteReleaseStats()` existed and NO COMMAND
REACHED IT, so a validator could not tell a genuine zero from a missing
instrument. WP95 added `fileop.muteStats`. This arm uses it.

FOUR QUESTIONS, and the first one is not about the product at all.

  Q1 IS THE READER WIRED TO THE LIVE MANAGER? Drive K inbound ops that each take
     a mute, and require `releasedByEvent + releasedByCeiling` to advance by at
     least K. A reader that cannot be shown to MOVE is not evidence when it
     reports a zero. THIS IS THE CONTROL THAT COULD HAVE FAILED.

  Q2 DOES THE CEILING GET EXCEEDED, AND IS THAT COUNTED AND NAMED? `overruns`,
     `worstOverrunMs`, `overrunsByClass` before/after, and the `MUTE OVERRUN:`
     signature with its rule-15 history control. A counter that moves while the
     signature stays silent is a finding, not a pass.

  Q3 DOES THE CLASS BREAKDOWN TRACK WHAT WAS DRIVEN? Drive `.md` ops and require
     the `text` class specifically to advance. A total that moves proves a
     counter; a CLASS that moves proves it is counting the thing that happened.

  Q4 HAS THE LAZY RELEASE EVER FIRED LIVE? `releasedByEvent` is AC2's ordinary
     path — the whole point of WP93 is that the consuming vault event, not the
     clampable `setTimeout`, decides the ordinary case. The survey measured
     `releasedByEvent: 0` on BOTH instances. This arm drives the ops that are
     supposed to produce it and reports what happens.

CLAMP BAND. `MUTE OVERRUN:` carries `held=<n>ms`, so the 40-70 s band is a
census over that number in the retained log rather than an inference from
awareness pulses. Both are reported.

NO `sleep` IS USED AS A SETTLE. The only sleeps here are the deliberate gaps
BETWEEN driven ops; every wait for the system is `await_state`.
"""

from __future__ import annotations

import json
import re
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
    clamp_report,
    cmd,
    dump,
    gate,
    guest_role,
    host_role,
    log_path,
    rule15,
    say,
    snapshot_shared,
    vpath,
    waiter,
)

NEEDED = ("session.info", "fileop.inject", "fileop.muteStats")
OVERRUN_SIG = "MUTE OVERRUN:"
HELD_RE = re.compile(r"MUTE OVERRUN: (\S+) held=(\d+)ms ceiling=(\d+)ms")
PREFIX = f"b59-{RUN}"


def stats(role: str) -> dict:
    r = cmd(role, "fileop.muteStats")
    return (r.get("result") or {}) if r.get("ok") else {"__error__": r}


def total_releases(s: dict) -> int:
    return int(s.get("releasedByEvent", 0)) + int(s.get("releasedByCeiling", 0))


def held_census(role: str, since: float | None = None) -> dict:
    """Every `held=` value the emitter has ever written on this instance."""
    p = log_path(role)
    if not p.exists():
        return {"n": 0}
    held = []
    for ln in p.read_text(encoding="utf-8", errors="replace").splitlines():
        m = HELD_RE.search(ln)
        if not m:
            continue
        if since is not None:
            try:
                ts = time.mktime(time.strptime(ln[:19], "%Y-%m-%dT%H:%M:%S")) - time.timezone
            except Exception:  # noqa: BLE001
                continue
            if ts < since - 5:
                continue
        held.append((m.group(1), int(m.group(2)), int(m.group(3))))
    vals = [h for _, h, _ in held]
    band = [v for v in vals if 40_000 <= v <= 70_000]
    return {
        "n": len(held),
        "max_held_ms": max(vals) if vals else None,
        "min_held_ms": min(vals) if vals else None,
        "in_40_70s_clamp_band": len(band),
        "over_1s": len([v for v in vals if v >= 1000]),
        "sample": held[-8:],
    }


# =========================================================================== #
def drive(role: str, n: int, gap: float) -> dict:
    """K inbound ops that each take a mute and each mutate a real file, so each
    one also produces the vault event that is supposed to consume its mute."""
    say(f"    driving {n} inbound file-ops on {role} ({ls_b59.ROLES[role]}), gap={gap}s")
    made = []
    for i in range(n):
        path = f"{SHARED}/{PREFIX}-mute-{i}.md"
        r = cmd(role, "fileop.inject", timeout=45,
                op={"type": "create", "path": path, "content": f"b59 mute probe {i}\n"},
                settleMs=120)
        ok = bool((r.get("result") or {}).get("mutated"))
        made.append({"path": path, "mutated": ok})
        time.sleep(gap)
    for i in range(n):
        path = f"{SHARED}/{PREFIX}-mute-{i}.md"
        cmd(role, "fileop.inject", timeout=45,
            op={"type": "modify", "path": path, "content": f"b59 mute probe {i} v2\n"},
            settleMs=120)
        time.sleep(gap)
    return {"created": made}


def cleanup(role: str, n: int) -> list[str]:
    left = []
    for i in range(n):
        path = f"{SHARED}/{PREFIX}-mute-{i}.md"
        cmd(role, "fileop.inject", timeout=45,
            op={"type": "delete", "path": path}, settleMs=200)
    for r in VAULTS:
        for i in range(n):
            p = vpath(r, f"{SHARED}/{PREFIX}-mute-{i}.md")
            if p.exists():
                try:
                    p.unlink()
                except OSError:
                    left.append(f"{r}:{p.name}")
    return left


def main() -> int:
    if not gate("ARM 2 — WP93 AC4, the mute-release ceiling", NEEDED):
        say("\nREFUSING TO MEASURE — the gate did not pass.")
        return 2
    h, g = host_role(), guest_role()
    say(f"  HOST = {h}   GUEST = {g}   (asked, not assumed)")
    clamp_report()
    pre_tree = snapshot_shared()
    w = waiter()

    out: dict = {"roles": dict(ls_b59.ROLES), "host": h, "guest": g}
    say("")
    say("  rule-15 control, BEFORE anything is driven:")
    hh = w.history_hits(OVERRUN_SIG)
    say(f"    history_hits({OVERRUN_SIG!r}) over the retained log = {hh}")
    say("    (>0 means the signature is PROVEN able to match this product's output,")
    say("     so a later silence is admissible. =0 means it is not, and no absence")
    say("     claim over it may be made — which is exactly where B56 had to stop.)")
    out["overrun_signature_history_hits"] = hh

    say("")
    say("  ---- Q1/Q3: does the reader MOVE, and does the right CLASS move? ----")
    before = {r: stats(r) for r in VAULTS}
    for r in VAULTS:
        say(f"    {r} before: {json.dumps(before[r])}")
    out["before"] = before

    mark = w.mark("arm2")
    n, gap = 8, 0.4
    out["drive_host"] = drive(h, n, gap)

    def moved() -> bool:
        return total_releases(stats(h)) >= total_releases(before[h]) + n

    got, t = await_state(f"{h}'s release counter advances by at least {n}", moved, 90)
    say(f"    counter advanced by >= {n}: {got} after {t:.1f}s")

    after_drive = {r: stats(r) for r in VAULTS}
    for r in VAULTS:
        say(f"    {r} after drive: {json.dumps(after_drive[r])}")
    out["after_drive"] = after_drive
    out["reader_moved"] = got

    d_total = total_releases(after_drive[h]) - total_releases(before[h])
    d_text = (after_drive[h].get("overrunsByClass", {}).get("text", 0)
              - before[h].get("overrunsByClass", {}).get("text", 0))
    d_over = after_drive[h].get("overruns", 0) - before[h].get("overruns", 0)
    d_event = after_drive[h].get("releasedByEvent", 0) - before[h].get("releasedByEvent", 0)
    d_ceil = after_drive[h].get("releasedByCeiling", 0) - before[h].get("releasedByCeiling", 0)
    say("")
    say(f"    Q1 releases  on {h}: +{d_total}  (drove {2 * n} ops)")
    say(f"    Q2 overruns  on {h}: +{d_over}  worst now "
        f"{after_drive[h].get('worstOverrunMs')}ms")
    say(f"    Q3 class 'text' overruns on {h}: +{d_text}   "
        f"(the ops driven were .md, so 'text' is the class that had to move)")
    say(f"    Q4 releasedByEvent on {h}: +{d_event}   releasedByCeiling: +{d_ceil}")
    out["deltas"] = {"releases": d_total, "overruns": d_over, "text_overruns": d_text,
                     "releasedByEvent": d_event, "releasedByCeiling": d_ceil,
                     "ops_driven": 2 * n}

    say("")
    say("  ---- a CONTENDED burst: the same ops with no gap at all ----")
    burst_before = stats(h)
    t0 = time.time()
    for i in range(12):
        cmd(h, "fileop.inject", timeout=45,
            op={"type": "create", "path": f"{SHARED}/{PREFIX}-burst-{i}.md",
                "content": f"burst {i}\n"}, settleMs=0)
    say(f"    12 ops issued back-to-back in {time.time() - t0:.1f}s")
    settled, ts = await_state(
        "every armed release on the host has completed (pending == 0)",
        lambda: stats(h).get("pending") == 0, 120)
    burst_after = stats(h)
    say(f"    pending drained: {settled} after {ts:.1f}s")
    say(f"    burst before: {json.dumps(burst_before)}")
    say(f"    burst after : {json.dumps(burst_after)}")
    out["burst"] = {"before": burst_before, "after": burst_after,
                    "pending_drained": settled, "drain_s": round(ts, 1)}
    for i in range(12):
        cmd(h, "fileop.inject", timeout=45,
            op={"type": "delete", "path": f"{SHARED}/{PREFIX}-burst-{i}.md"}, settleMs=100)

    say("")
    say("  ---- Q2 continued: the held-time census over the emitter's OWN number ----")
    for r in VAULTS:
        c = held_census(r)
        say(f"    {r}: {json.dumps(c)}")
        out.setdefault("held_census", {})[r] = c
        cw = held_census(r, since=mark.t_start)
        say(f"    {r} (this arm's window only): {json.dumps(cw)}")
        out.setdefault("held_census_window", {})[r] = cw

    left = cleanup(h, n)
    for r in VAULTS:
        for i in range(12):
            p = vpath(r, f"{SHARED}/{PREFIX}-burst-{i}.md")
            if p.exists():
                try:
                    p.unlink()
                except OSError:
                    left.append(f"{r}:{p.name}")
    say(f"  cleanup leftovers: {left}")
    out["cleanup_leftovers"] = left

    ev = w.collect(mark, ls_b59.RECEIPTS, timeout_s=60)
    say("")
    say(ev.summary())
    out["rule15"] = rule15(ev)
    out["overrun_lines_in_window"] = [ln.strip()[:200] for ln in ev.hits(OVERRUN_SIG)][:20]
    say(f"  {OVERRUN_SIG!r} lines inside this arm's window: "
        f"{len(out['overrun_lines_in_window'])}")
    for ln in out["overrun_lines_in_window"][:10]:
        say(f"    {ln}")

    post = snapshot_shared()
    say("")
    for r in VAULTS:
        added = sorted(set(post[r]) - set(pre_tree[r]))
        removed = sorted(set(pre_tree[r]) - set(post[r]))
        say(f"    tree {r}: added={added} removed={removed}")
        out.setdefault("tree_delta", {})[r] = {"added": added, "removed": removed}
    dump("arm2_wp93ac4", out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
