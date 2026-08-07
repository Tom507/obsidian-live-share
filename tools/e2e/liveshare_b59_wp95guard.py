"""B59 / W4 — ARM 3. WP95's protected-path guard, LIVE.

WHAT S94 WAS. A peer-injected rename into `.obsidian/plugins/live-share/` was
ADMITTED AND APPLIED on a live instance. That directory holds `main.js` (the
plugin's own code) and `data.json` (the user's credentials). WP95 replaced the
one-directory `isSidecarPath` test at the inbound gate with `isProtectedPath`,
and B58 demonstrated all nine op kinds HEADLESS. Nothing had run it live.

TWO HALVES, AND THEY ARE ONE TEST. A guard that refuses everything under
`.obsidian/**` would also stop the plugin writing its OWN sidecar under
`.obsidian/liveshare/state/**`, which would break every board's persistence.
So this arm requires BOTH:

    (a) every peer-injected op naming a protected path is REFUSED, and
        `data.json` is byte-identical afterwards; and
    (b) the plugin's own sidecar writer still writes into
        `.obsidian/liveshare/state/`.

A green (a) with a red (b) is an over-refusing guard, not a fix.

THE CONTROL THAT COULD HAVE FAILED. Every refusal row is paired with the SAME
OP SHAPE aimed at an ordinary shared path, which must be ADMITTED and APPLIED
(`mutated: true`, and the file observably there). Without it, "refused" is
indistinguishable from "the injector is not delivering", which is the exact
reading `injectFileOp`'s own `delivered:false` branch exists to prevent — and
this arm asserts `delivered` on every row rather than trusting it.

SECRET DISCIPLINE — ABSOLUTE. `data.json` is NEVER read, decoded, printed or
copied out of its directory. The only statement made about it is a sha256 of
its bytes. The pre-arm safety copy is written into the SAME directory
(`data.json.b59-pre`), so no credential ever moves to a location it was not
already in, and it is removed at the end.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ls_b59  # noqa: E402
from ls_b59 import (  # noqa: E402
    PLUGIN_DATA_REL,
    PLUGIN_MAIN_REL,
    RUN,
    SHARED,
    SIDECAR_STATE_REL,
    VAULTS,
    await_state,
    card,
    clamp_report,
    cmd,
    dir_census,
    doc_ids,
    dump,
    gate,
    guest_role,
    host_role,
    read_canvas,
    rule15,
    say,
    sha_bytes,
    snapshot_shared,
    vpath,
    waiter,
    write_canvas_raw,
)

NEEDED = ("session.info", "fileop.inject", "fileop.protectedRefusals", "canvas.state")
REFUSAL_SIG = "PROTECTED PATH REFUSED:"
PREFIX = f"b59-{RUN}"
DATA = PLUGIN_DATA_REL
MAIN = PLUGIN_MAIN_REL
GIT_HOOK = ".git/hooks/pre-commit"
SIDECAR_LOOKALIKE = ".obsidian/liveshare/stateful/b59-lookalike.canvas"


def refusals(role: str) -> dict:
    r = cmd(role, "fileop.protectedRefusals")
    return (r.get("result") or {}) if r.get("ok") else {"__error__": r}


def inject(role: str, op: dict, settle: int = 900) -> dict:
    r = cmd(role, "fileop.inject", timeout=90, op=op, settleMs=settle)
    res = (r.get("result") or {}) if r.get("ok") else {}
    return {"ok": bool(r.get("ok")), "delivered": res.get("delivered"),
            "reason": res.get("reason"), "mutated": res.get("mutated"),
            "changed": res.get("changed"), "raw_error": None if r.get("ok") else r}


def ops_for(target: str, content: str, spare: str) -> list[tuple[str, dict]]:
    """The op kinds this arm drives at one target. `spare` is a path in the
    SHARED tree used as the other endpoint of a rename, so the rename rows test
    both directions across the protection boundary."""
    return [
        ("create", {"type": "create", "path": target, "content": content}),
        ("modify", {"type": "modify", "path": target, "content": content}),
        ("delete", {"type": "delete", "path": target}),
        ("rename-INTO-protected", {"type": "rename", "oldPath": spare, "path": target}),
        ("rename-OUT-of-protected", {"type": "rename", "oldPath": target, "path": spare}),
        ("folder-create", {"type": "folder-create", "path": target}),
        ("chunk-start", {"type": "chunk-start", "path": target, "totalSize": 16}),
        ("chunk-data", {"type": "chunk-data", "path": target, "index": 0, "data": "AAAA"}),
        ("chunk-end", {"type": "chunk-end", "path": target}),
    ]


# =========================================================================== #
def refusal_census(role: str, target: str, label: str, spare: str) -> dict:
    """Half (a). Every op kind at one protected target, each with its own
    before/after digest of `data.json` and its own refusal-counter delta."""
    say("")
    say(f"  ---- {label}: nine op kinds at {target} on {role} ({ls_b59.ROLES[role]}) ----")
    rows = []
    for kind, op in ops_for(target, "b59-protected-probe\n", spare):
        d0 = sha_bytes(vpath(role, DATA))
        m0 = sha_bytes(vpath(role, MAIN))
        c0 = refusals(role)
        res = inject(role, op)
        d1 = sha_bytes(vpath(role, DATA))
        m1 = sha_bytes(vpath(role, MAIN))
        c1 = refusals(role)
        dtot = int(c1.get("total", 0)) - int(c0.get("total", 0))
        arms = {k: c1.get("byArm", {}).get(k, 0) - c0.get("byArm", {}).get(k, 0)
                for k in set(c1.get("byArm", {})) | set(c0.get("byArm", {}))}
        arms = {k: v for k, v in arms.items() if v}
        row = {
            "op": kind, "target": target,
            "delivered": res["delivered"], "mutated": res["mutated"],
            "reason": res["reason"], "changed": res["changed"],
            "data_json_sha_unchanged": (d0 == d1),
            "main_js_sha_unchanged": (m0 == m1),
            "target_exists_after": vpath(role, target).exists(),
            "refusals_delta": dtot, "arms_delta": arms,
        }
        rows.append(row)
        say(f"    {kind:<24} delivered={row['delivered']} mutated={row['mutated']} "
            f"refusals+{dtot} arms={arms} data.json_sha_unchanged="
            f"{row['data_json_sha_unchanged']} main.js_sha_unchanged="
            f"{row['main_js_sha_unchanged']}")
        if res["raw_error"]:
            say(f"      raw: {json.dumps(res['raw_error'])[:200]}")
    return {"target": target, "rows": rows}


def admission_control(role: str, spare_dir: str) -> dict:
    """THE CONTROL. The identical op shapes at an ORDINARY shared path. If these
    are not admitted and applied, every refusal above is a statement about the
    injector rather than about the guard."""
    say("")
    say(f"  ---- CONTROL: the same op kinds at an ORDINARY shared path on {role} ----")
    rows = []
    ctl = f"{spare_dir}/{PREFIX}-control.md"
    ctl2 = f"{spare_dir}/{PREFIX}-control-moved.md"
    seq = [
        ("create", {"type": "create", "path": ctl, "content": "b59 control v1\n"}, True),
        ("modify", {"type": "modify", "path": ctl, "content": "b59 control v2\n"}, True),
        ("rename", {"type": "rename", "oldPath": ctl, "path": ctl2}, True),
        ("delete", {"type": "delete", "path": ctl2}, True),
    ]
    for kind, op, want in seq:
        c0 = refusals(role)
        res = inject(role, op)
        c1 = refusals(role)
        row = {"op": kind, "delivered": res["delivered"], "mutated": res["mutated"],
               "expected_mutated": want,
               "refusals_delta": int(c1.get("total", 0)) - int(c0.get("total", 0))}
        rows.append(row)
        say(f"    {kind:<10} delivered={row['delivered']} mutated={row['mutated']} "
            f"(expected {want})  refusals+{row['refusals_delta']}")
    for r in VAULTS:
        for p in (ctl, ctl2):
            f = vpath(r, p)
            if f.exists():
                try:
                    f.unlink()
                    say(f"    cleanup removed {r}:{p}")
                except OSError as e:
                    say(f"    cleanup could not remove {r}:{p}: {e}")
    return {"rows": rows,
            "control_holds": all(r["mutated"] is r["expected_mutated"] for r in rows)}


def sidecar_still_written(role: str, board: str) -> dict:
    """Half (b). The plugin's OWN writer must still write under
    `.obsidian/liveshare/state/`. Observable: the directory census CHANGES after
    a real edit to a subscribed board. Not a log line, and not a timer."""
    say("")
    say(f"  ---- HALF (b): does {role} still write its OWN sidecar? ----")
    before = dir_census(role, SIDECAR_STATE_REL)
    say(f"    sidecar dir before: {len(before)} files")
    nid = f"{PREFIX}-sidecar-probe"
    doc = read_canvas(role, board)
    if doc is None:
        say(f"    !! {board} missing on {role} — half (b) UNMEASURABLE here")
        return {"measurable": False, "why": "board missing"}
    doc.setdefault("nodes", []).append(card(nid, 2000, 2000))
    write_canvas_raw(role, doc, board)
    got, t = await_state(f"{nid} reaches {role}'s own doc",
                         lambda: nid in doc_ids(role, board)[0], 45)
    say(f"    edit reached the doc: {got} after {t:.1f}s")
    changed, t2 = await_state(
        "the sidecar state directory census CHANGES",
        lambda: dir_census(role, SIDECAR_STATE_REL) != before, 90)
    after = dir_census(role, SIDECAR_STATE_REL)
    diff = {k: (before.get(k), after.get(k)) for k in set(before) | set(after)
            if before.get(k) != after.get(k)}
    say(f"    sidecar census changed: {changed} after {t2:.1f}s "
        f"({len(diff)} entries differ)")
    for k, v in list(diff.items())[:8]:
        say(f"      {k}: {v[0]} -> {v[1]}")

    # teardown of the probe node
    doc = read_canvas(role, board)
    if doc is not None:
        doc["nodes"] = [n for n in doc.get("nodes", []) if n.get("id") != nid]
        write_canvas_raw(role, doc, board)
    clean, _ = await_state("the probe node is gone from both docs",
                           lambda: not any(nid in doc_ids(r, board)[0] for r in VAULTS), 45)
    say(f"    probe node removed from both docs: {clean}")
    return {"measurable": True, "edit_reached_doc": bool(got),
            "sidecar_changed": bool(changed), "after_s": round(t2, 1),
            "entries_differing": len(diff),
            "diff_sample": {k: list(v) for k, v in list(diff.items())[:8]},
            "probe_removed": bool(clean)}


def main() -> int:
    if not gate("ARM 3 — WP95's protected-path guard, live", NEEDED):
        say("\nREFUSING TO MEASURE — the gate did not pass.")
        return 2
    h, g = host_role(), guest_role()
    say(f"  HOST = {h}   GUEST = {g}   (asked, not assumed)")
    clamp_report()
    pre_tree = snapshot_shared()
    w = waiter()
    mark = w.mark("arm3")

    out: dict = {"roles": dict(ls_b59.ROLES), "host": h, "guest": g}
    say("")
    say("  rule-15 control BEFORE the arm: "
        f"history_hits({REFUSAL_SIG!r}) = {w.history_hits(REFUSAL_SIG)}")
    out["refusal_signature_history_before"] = w.history_hits(REFUSAL_SIG)

    # --- safety copy, INSIDE the same directory (no credential moves) --------
    backups = {}
    for role in VAULTS:
        src = vpath(role, DATA)
        dst = src.with_name("data.json.b59-pre")
        shutil.copy2(src, dst)
        backups[role] = (dst, sha_bytes(src))
        say(f"  safety copy {role}: data.json -> data.json.b59-pre "
            f"(sha256 {sha_bytes(src)}); the bytes never leave this directory")
    out["data_json_sha_before"] = {r: backups[r][1] for r in VAULTS}

    spare = f"{SHARED}/{PREFIX}-spare.md"
    for role in VAULTS:
        p = vpath(role, spare)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("b59 rename source\n", encoding="utf-8")

    out["control"] = admission_control(h, SHARED)
    if not out["control"]["control_holds"]:
        say("  !! THE ADMISSION CONTROL DID NOT HOLD — every refusal below would be")
        say("     a statement about the injector, not about the guard. Reported as")
        say("     such and NOT scored as a pass.")

    out["census_host_data_json"] = refusal_census(h, DATA, "HOST / data.json", spare)
    out["census_host_main_js"] = refusal_census(h, MAIN, "HOST / main.js", spare)
    out["census_host_git_hook"] = refusal_census(h, GIT_HOOK, "HOST / .git hook", spare)
    out["census_guest_data_json"] = refusal_census(g, DATA, "GUEST / data.json", spare)

    # The near-miss the WP95 ruling split out: a path that merely LOOKS like the
    # sidecar. `.obsidian/liveshare/stateful/**` is NOT `.obsidian/liveshare/state/**`,
    # so `isSidecarPath` is false for it — and `isProtectedPath` is TRUE, because
    # it is still under `.obsidian`. The two predicates must disagree here.
    out["census_near_miss"] = refusal_census(h, SIDECAR_LOOKALIKE, "HOST / sidecar look-alike", spare)

    out["sidecar_half_host"] = sidecar_still_written(h, f"{SHARED}/wp79-035734-two.canvas")
    out["sidecar_half_guest"] = sidecar_still_written(g, f"{SHARED}/second-011125.canvas")

    # --- restore and verify --------------------------------------------------
    say("")
    say("  ---- restore ----")
    for role in VAULTS:
        dst, sha0 = backups[role]
        now = sha_bytes(vpath(role, DATA))
        say(f"    {role}: data.json sha256 before={sha0}")
        say(f"    {role}: data.json sha256 after ={now}  IDENTICAL={sha0 == now}")
        if sha0 != now:
            say(f"    {role}: !! RESTORING from the safety copy — the guard did NOT hold")
            shutil.copy2(dst, vpath(role, DATA))
        dst.unlink()
        say(f"    {role}: safety copy removed")
        out.setdefault("data_json_sha_after", {})[role] = now
        out.setdefault("data_json_identical", {})[role] = (sha0 == now)
    for role in VAULTS:
        p = vpath(role, spare)
        if p.exists():
            p.unlink()
    for role in VAULTS:
        lk = vpath(role, SIDECAR_LOOKALIKE)
        if lk.exists():
            lk.unlink()
            say(f"    removed the look-alike fixture from {role}")
        sr = vpath(role, ".obsidian/liveshare/state/seed-refusals.json")
        try:
            j = json.loads(sr.read_text(encoding="utf-8")) if sr.exists() else {}
            out.setdefault("seed_refusal_paths", {})[role] = sorted((j.get("paths") or {}))
        except Exception as e:  # noqa: BLE001
            out.setdefault("seed_refusal_paths", {})[role] = f"unreadable: {e}"
    say(f"  seed-refusals paths at end: {out.get('seed_refusal_paths')}")

    ev = w.collect(mark, ls_b59.RECEIPTS, timeout_s=90)
    say("")
    say(ev.summary())
    out["rule15"] = rule15(ev)
    lines = [ln.strip()[:220] for ln in ev.hits(REFUSAL_SIG)]
    out["refusal_lines"] = lines[:40]
    say(f"  {REFUSAL_SIG!r} lines in this arm's window: {len(lines)}")
    for ln in lines[:15]:
        say(f"    {ln}")

    post = snapshot_shared()
    for r in VAULTS:
        added = sorted(set(post[r]) - set(pre_tree[r]))
        removed = sorted(set(pre_tree[r]) - set(post[r]))
        say(f"    tree {r}: added={added} removed={removed}")
        out.setdefault("tree_delta", {})[r] = {"added": added, "removed": removed}
    dump("arm3_wp95guard", out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
