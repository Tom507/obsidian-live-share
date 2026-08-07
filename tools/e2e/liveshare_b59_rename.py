"""B59 / W4 — THE INBOUND-RENAME ARM, RE-RUN AT PINNED `e7df354`.

WHY IT IS RE-RUN RATHER THAN READ OFF THE OLD DATA. The Dispatcher asked whether
`mutedAfterDispatch` was already in my retained data. IT IS NOT: my `inject()`
helper kept `delivered`, `reason`, `mutated` and `changed` and DROPPED the rest
of `injectFileOp`'s result before anything was written to disk. I checked the
seven committed JSON files for the string and it does not occur in any of them.
So the reading the Dispatcher wanted for free costs one run, and the reason is a
lossy helper of mine.

⚠ AND I FOUND SOMETHING FIRST, WHICH CHANGES WHAT THIS ARM IS FOR.

`FileRenameOp` (`types.ts:203`) is `{ type, oldPath, newPath }`. THERE IS NO
`path` FIELD. Both of my S105 reproductions injected
`{type:"rename", oldPath: src, path: dst}` — the destination in a key the
product's rename arm never reads. `applyRemoteOpInner` reads `op.newPath`, which
in my frame was `undefined`.

SO THE FIRST QUESTION IS NO LONGER "WHICH BRANCH" BUT "WHOSE DEFECT". This arm
answers both, with the two shapes side by side:

  R1  {oldPath, path}     the malformed shape my two reproductions used
  R2  {oldPath, newPath}  the shape the type declares    <- THE CONTROL

If R2 applies and R1 does not, S105 is MY RIG'S DEFECT and the product's inbound
rename is sound. If R2 also fails, the malformed shape was never the cause and
the branch it names is the product's.

WHY THE RIG COULD NOT SEE MY MISTAKE, and it is the same shape as S109. The
injector's own endpoint reader, `fileOpEndpoints` (`e2e-control.ts:1808`), scans
`["path", "oldPath", "newPath"]` — it is MORE PERMISSIVE than the code it
observes. So a rename with its destination in `path` looked WELL FORMED to every
observation the rig took: `paths` had two entries, `before`/`after` were read for
both, and the protected-path rows in arm 3 refused on exactly that key. A reader
that accepts fields its subject ignores cannot report a malformed op, and mine
did not.

TWO MORE ROWS, AND THEY ARE THE INSTRUMENT PROOF (rule 15). B62's four new
diagnostics have ZERO history on any log in this project — they were merged
today, and until `S104` landed earlier in the same batch `FileOpsManager`'s
logger was `undefined`, so two of them could not have been written even if they
had existed. An unproven signature's silence is inadmissible, so two rows exist
only to make signatures fire before any silence is read:

  R3  {oldPath: ABSENT, newPath}  -> branch 2, `RENAME NOT APPLIED:`
  R4  both endpoints OUTSIDE the shared folder -> branch 1, the gate drop

R4 is also the reference reading for `mutedAfterDispatch=false`: the gate drop is
the one branch that never enters `applyRemoteOp`.

S110 IS OBEYED AT THE GATE, NOT ASSUMED. `plugin.sinkState` is asked of both
instances and `enabled` / `fileLevel` are printed BEFORE any log file is read.
Branch 1 logs at `debug`, so a `fileLevel` above `debug` would silently make
exactly one of the four branches unobservable. No absence claim is made about
any signature unless the sink says it was on and at a level that admits it.

OWNER FILES. `Properties.md` and `Properties 1.md` in vault A and `Properties.md`
in vault B are the OWNER'S. This arm never names them, never moves them and never
uses one as a fixture; it sha256s them before and after and refuses to finish
quietly if either changed. Every fixture is `b59r-<RUN>-*`.
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
    clamp_report,
    cmd,
    dump,
    gate,
    guest_role,
    host_role,
    log_path,
    say,
    sha_bytes,
    vpath,
    waiter,
)

NEEDED = ("session.info", "fileop.inject", "fileop.protectedRefusals", "plugin.sinkState")
PREFIX = f"b59r-{RUN}"

# The four branches, in the order they can be reached, with the exact literal
# each one emits. Taken from the source at the pinned commit, not from memory.
BRANCHES = {
    "1-gate-drop": "rename dropped: no endpoint is a shared path",
    "2-neither-endpoint": "RENAME NOT APPLIED:",
    "3/4-apply-threw": "APPLY FAILED:",
    "legacy-error-channel": "failed to apply remote file-op",
}

# The owner's files. NEVER a fixture, NEVER moved, NEVER deleted.
OWNER_FILES = {
    "A": ["Properties.md", "Properties 1.md"],
    "B": ["Properties.md"],
}


def owner_census() -> dict:
    out = {}
    for role, names in OWNER_FILES.items():
        for n in names:
            p = vpath(role, f"{SHARED}/{n}")
            out[f"{role}:{n}"] = {"exists": p.exists(),
                                  "sha256": sha_bytes(p),
                                  "size": p.stat().st_size if p.exists() else None}
    return out


def sink_state(role: str) -> dict:
    r = cmd(role, "plugin.sinkState")
    return (r.get("result") or {}) if r.get("ok") else {"__error__": r}


def raw_inject(role: str, op: dict, settle: int = 2500) -> dict:
    """The WHOLE result this time. `mutedAfterDispatch` is the field the last
    run threw away, and it is true iff `applyRemoteOp` was entered — which is
    what separates branch 1 from branches 2-4 in a single reading."""
    r = cmd(role, "fileop.inject", timeout=120, op=op, settleMs=settle)
    if not r.get("ok"):
        return {"__error__": r}
    return r.get("result") or {}


def window(role: str, since: float) -> dict[str, list[str]]:
    p = log_path(role)
    hits: dict[str, list[str]] = {k: [] for k in BRANCHES}
    if not p.exists():
        return hits
    for ln in p.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            ts = time.mktime(time.strptime(ln[:19], "%Y-%m-%dT%H:%M:%S")) - time.timezone
        except Exception:  # noqa: BLE001
            continue
        if ts < since - 5:
            continue
        for name, sig in BRANCHES.items():
            if sig in ln:
                hits[name].append(ln.strip()[:240])
    return hits


def row(label: str, role: str, op: dict, src: str | None, dst: str | None,
        expect_note: str) -> dict:
    say("")
    say(f"  ---- {label} ----")
    say(f"    op keys: {sorted(op)}   ({expect_note})")
    pre = {"src_on_host": vpath(role, src).exists() if src else None,
           "dst_on_host": vpath(role, dst).exists() if dst else None}
    say(f"    precondition: src exists={pre['src_on_host']} dst exists={pre['dst_on_host']}")

    t0 = time.time()
    res = raw_inject(role, op)
    applied, t = await_state(
        f"{label}: the DESTINATION exists and the SOURCE is gone, on the host",
        lambda: (dst is not None and vpath(role, dst).exists()
                 and (src is None or not vpath(role, src).exists())), 45)

    # give the flush a chance, then read the branch signatures under S65 rules
    ev_hits = {}
    for _ in range(24):
        ev_hits = window(role, t0)
        if any(ev_hits.values()):
            break
        time.sleep(2.0)

    peer = next(x for x in VAULTS if x != role)
    rec = {
        "row": label,
        "op_keys": sorted(op),
        "delivered": res.get("delivered"),
        "reason": res.get("reason"),
        "mutedAfterDispatch": res.get("mutedAfterDispatch"),
        "mutated": res.get("mutated"),
        "changed": res.get("changed"),
        "endpoints_seen_by_rig": res.get("paths"),
        "samples": res.get("samples"),
        "disk_applied_on_host": bool(applied),
        "after_s": round(t, 1),
        "src_after": vpath(role, src).exists() if src else None,
        "dst_after": vpath(role, dst).exists() if dst else None,
        "dst_on_peer": vpath(peer, dst).exists() if dst else None,
        "branch_lines": {k: v for k, v in ev_hits.items() if v},
    }
    say(f"    delivered={rec['delivered']}  mutedAfterDispatch={rec['mutedAfterDispatch']}"
        f"  mutated={rec['mutated']}")
    say(f"    rig saw endpoints: {rec['endpoints_seen_by_rig']}")
    say(f"    DISK: applied={rec['disk_applied_on_host']} after={rec['after_s']}s  "
        f"src_after={rec['src_after']} dst_after={rec['dst_after']} "
        f"dst_on_peer={rec['dst_on_peer']}")
    fired = [k for k, v in ev_hits.items() if v]
    say(f"    BRANCH FIRED: {fired if fired else 'none announced'}")
    for k in fired:
        for ln in ev_hits[k][:3]:
            say(f"        [{k}] {ln}")
    return rec


def seed(role: str, rel: str) -> bool:
    cmd(role, "fileop.inject", timeout=90,
        op={"type": "create", "path": rel, "content": f"b59 rename fixture {RUN}\n"},
        settleMs=1500)
    got, _ = await_state(f"fixture {rel} exists on {role}",
                         lambda: vpath(role, rel).exists(), 45)
    return got


def main() -> int:
    if not gate("RENAME ARM — which of the four branches fires?", NEEDED):
        say("\nREFUSING TO MEASURE — the gate did not pass.")
        return 2
    h, g = host_role(), guest_role()
    say(f"  HOST = {h}   GUEST = {g}   (asked, not assumed)")
    clamp_report()
    w = waiter()

    out: dict = {"roles": dict(ls_b59.ROLES), "host": h, "guest": g,
                 "pinned": ls_b59.pinned()}

    # ---- S110, BEFORE any log file is opened ------------------------------
    say("")
    say("  ---- S110: the file sink, ASKED (not assumed) before any log is read ----")
    ok_sink = True
    for x in VAULTS:
        st = sink_state(x)
        say(f"    {x}: enabled={st.get('enabled')} fileLevel={st.get('fileLevel')} "
            f"ringLevel={st.get('ringLevel')} linesWritten={st.get('linesWritten')} "
            f"lastWriteOk={st.get('lastWriteOk')} failures={st.get('failureCount')} "
            f"dropped={st.get('linesDropped')}")
        out.setdefault("sink_state", {})[x] = st
        if st.get("enabled") is not True:
            say("    !! debugLogging is OFF on this vault — every line would land in")
            say("       the ring buffer only and NO absence claim over a log signature")
            say("       is admissible. Refusing to read this vault's log as evidence.")
            ok_sink = False
        if st.get("fileLevel") != "debug":
            say(f"    !! fileLevel is {st.get('fileLevel')!r}, above 'debug' — branch 1")
            say("       logs at debug and would be INVISIBLE in the file. Branch 1's")
            say("       silence would say nothing.")
            ok_sink = False
    out["sink_admits_all_four_branches"] = ok_sink
    if not ok_sink:
        say("  !! proceeding, but every branch verdict below is qualified by the above.")

    say("")
    say("  ---- rule 15: the four branch signatures and their history ----")
    for name, sig in BRANCHES.items():
        n = w.history_hits(sig)
        say(f"    {name:<22} {sig!r:<52} history_hits={n}")
        out.setdefault("branch_history_before", {})[name] = n
    say("    (all four are expected to be ZERO: they were merged today, and two of")
    say("     them could not have been written before S104 landed in the same batch.")
    say("     Rows R3 and R4 exist to make them fire before any silence is read.)")

    say("")
    say("  ---- the owner's files, sha256'd BEFORE anything is touched ----")
    owner_before = owner_census()
    for k, v in owner_before.items():
        say(f"    {k}: exists={v['exists']} size={v['size']} sha256={v['sha256']}")
    out["owner_before"] = owner_before

    rows = []

    # R1 — the malformed shape my two S105 reproductions used.
    r1_src, r1_dst = f"{SHARED}/{PREFIX}-r1-src.md", f"{SHARED}/{PREFIX}-r1-dst.md"
    if not seed(h, r1_src):
        say("  !! R1 fixture did not seed — row NOT scored")
        rows.append({"row": "R1", "scored": False})
    else:
        rows.append(row("R1  MALFORMED {oldPath, path} — my original S105 shape",
                        h, {"type": "rename", "oldPath": r1_src, "path": r1_dst},
                        r1_src, r1_dst,
                        "`path` is NOT a field of FileRenameOp"))

    # R2 — THE CONTROL. The shape types.ts declares.
    r2_src, r2_dst = f"{SHARED}/{PREFIX}-r2-src.md", f"{SHARED}/{PREFIX}-r2-dst.md"
    if not seed(h, r2_src):
        say("  !! R2 fixture did not seed — row NOT scored")
        rows.append({"row": "R2", "scored": False})
    else:
        rows.append(row("R2  DECLARED {oldPath, newPath} — THE CONTROL",
                        h, {"type": "rename", "oldPath": r2_src, "newPath": r2_dst},
                        r2_src, r2_dst,
                        "exactly the fields FileRenameOp declares"))

    # R3 — instrument proof for branch 2.
    r3_src = f"{SHARED}/{PREFIX}-r3-absent.md"
    r3_dst = f"{SHARED}/{PREFIX}-r3-dst.md"
    rows.append(row("R3  DECLARED, source ABSENT — instrument proof, branch 2",
                    h, {"type": "rename", "oldPath": r3_src, "newPath": r3_dst},
                    r3_src, r3_dst,
                    "neither endpoint resolves; expect RENAME NOT APPLIED"))

    # R4 — instrument proof for branch 1, and the mutedAfterDispatch=false reference.
    r4_src, r4_dst = f"{PREFIX}-r4-outside-src.md", f"{PREFIX}-r4-outside-dst.md"
    rows.append(row("R4  DECLARED, both endpoints OUTSIDE the shared folder — branch 1",
                    h, {"type": "rename", "oldPath": r4_src, "newPath": r4_dst},
                    r4_src, r4_dst,
                    "vault root, not _liveshare-test; expect the gate drop"))

    out["rows"] = rows

    # ---- the reading -------------------------------------------------------
    say("")
    say("=" * 78)
    say("  THE READING")
    say("=" * 78)
    say(f"    {'row':<8}{'applied':<10}{'mutedAfterDispatch':<22}{'branch announced'}")
    for r in rows:
        if not r.get("scored", True):
            say(f"    {r['row']:<8}NOT SCORED")
            continue
        fired = ", ".join(r["branch_lines"]) or "none"
        say(f"    {r['row'][:6]:<8}{str(r['disk_applied_on_host']):<10}"
            f"{str(r['mutedAfterDispatch']):<22}{fired}")

    scored = [r for r in rows if r.get("scored", True)]
    r1 = next((r for r in scored if r["row"].startswith("R1")), None)
    r2 = next((r for r in scored if r["row"].startswith("R2")), None)
    if r1 and r2:
        say("")
        if r2["disk_applied_on_host"] and not r1["disk_applied_on_host"]:
            say("    R2 APPLIED and R1 DID NOT. The one difference between them is the")
            say("    KEY the destination was carried in. S105 as I reported it is a")
            say("    defect in MY INJECTED OP, not in the product's inbound rename.")
        elif r2["disk_applied_on_host"] and r1["disk_applied_on_host"]:
            say("    BOTH applied — the malformed shape is tolerated somewhere and my")
            say("    original reproduction is not explained by it. Report, do not fix.")
        elif not r2["disk_applied_on_host"]:
            say("    R2 DID NOT APPLY EITHER. The op shape was never the cause and the")
            say("    branch named above is the PRODUCT'S. Stop here and report it.")

    # ---- teardown ----------------------------------------------------------
    say("")
    say("  ---- teardown (this arm's fixtures only; every name starts b59r-) ----")
    left = []
    for name in (r1_src, r1_dst, r2_src, r2_dst, r3_src, r3_dst,
                 f"{SHARED}/{r4_src}", f"{SHARED}/{r4_dst}", r4_src, r4_dst):
        base = Path(name).name
        if not base.startswith("b59r-"):
            say(f"    REFUSING to touch {name!r} — not this arm's fixture")
            continue
        for x in VAULTS:
            p = vpath(x, name)
            if p.exists():
                try:
                    p.unlink()
                    say(f"    removed {x}:{name}")
                except OSError as e:
                    left.append(f"{x}:{name} ({e})")
    out["leftovers"] = left

    say("")
    say("  ---- the owner's files, sha256'd AFTER ----")
    owner_after = owner_census()
    disturbed = []
    for k in sorted(set(owner_before) | set(owner_after)):
        b, a = owner_before.get(k), owner_after.get(k)
        same = b == a
        say(f"    {k}: unchanged={same} exists={a['exists'] if a else None} "
            f"sha256={a['sha256'] if a else None}")
        if not same:
            disturbed.append(k)
    out["owner_after"] = owner_after
    out["owner_disturbed"] = disturbed
    if disturbed:
        say(f"    !! OWNER FILES CHANGED: {disturbed} — say so loudly in the report")
    else:
        say("    every owner file is byte-identical to before this arm ran")

    dump("rename_arm", out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
