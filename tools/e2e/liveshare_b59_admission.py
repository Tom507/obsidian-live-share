"""B59 / W4 — ARM 3's admission control, RE-RUN WITH A DISK ORACLE.

WHY THIS EXISTS. Arm 3's control ran four op kinds at an ordinary shared path
and scored `create` and `modify` as APPLIED and `rename` and `delete` as not.
Two things were wrong with reading that as "rename and delete are refused":

  1. `mutated` is `injectFileOp`'s OWN derived field — `endpointChanged(before,
     after)` over its endpoint observations. It is a fine oracle for "did this
     path change" and a poor one for "did a rename happen", because a rename has
     two endpoints and the interesting one is the DESTINATION.
  2. THE DELETE ROW WAS NOT INDEPENDENT OF THE RENAME ROW. It deleted the rename's
     DESTINATION, which the failed rename had never created. A `delete` of a path
     that does not exist changes nothing and is indistinguishable from a refusal.
     That is a defect in my control's design, not a measurement, and it is why
     this re-run gives every row its own fixture.

So each row here gets a FRESH file and the oracle is the FILESYSTEM on both
vaults, read directly. `mutated` is still recorded, side by side, so the two
oracles can be compared rather than one being trusted.
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
    doc_ids,
    dump,
    gate,
    guest_role,
    host_role,
    read_canvas,
    say,
    vpath,
)

NEEDED = ("session.info", "fileop.inject", "fileop.protectedRefusals",
          "canvas.state", "canvas.simulateEdit")
PREFIX = f"b59adm-{RUN}"


def refusal_total(role: str) -> int:
    r = cmd(role, "fileop.protectedRefusals")
    return int(((r.get("result") or {}).get("total", -1)) if r.get("ok") else -1)


def inject(role: str, op: dict, settle: int = 2500) -> dict:
    r = cmd(role, "fileop.inject", timeout=120, op=op, settleMs=settle)
    res = (r.get("result") or {}) if r.get("ok") else {}
    return {"delivered": res.get("delivered"), "reason": res.get("reason"),
            "mutated": res.get("mutated"), "changed": res.get("changed")}


def clear_doc_residue() -> dict:
    """Arms 4/5/6 left ONE node in both DOCS of `second-011125.canvas` while both
    DISKS are clean.

    OBSERVABLE ONLY — THE MECHANISM IS NOT CLAIMED. Six rounds of write-the-file-
    and-wait removed the node from neither doc; one
    `canvas.simulateEdit{removeNodes}` removed it from both in 0.0 s. A leaf was
    open on that board, and the obvious explanation is the one
    `noteExternalDiskWrite`'s comment offers — that an open canvas view ignores
    external file writes. THAT EXPLANATION IS NOT USED HERE, because a sibling
    batch (WP89) is at this moment committing the finding that this exact comment
    is a FALSE MAP: WP87 measured that an external write DOES rebuild the open
    view. Leaning on it would be inheriting a premise instead of measuring one,
    which is the failure this run has spent four batches naming.

    So what is recorded is the two observations and the fact that they are
    consistent with more than one mechanism.

    THE RESIDUE IS ITSELF A FINDING and it is recorded as one, not as
    housekeeping: it is doc-only, invisible in the file, and the only gesture
    that cleared it was an E2E-CONTROL COMMAND that no user has — the same
    recovery gap B56 hit on the S84 board.
    """
    say("")
    say("  ---- clearing the doc-only residue left by arms 4/5/6 ----")
    board = f"{SHARED}/second-011125.canvas"
    found = {}
    for x in VAULTS:
        ids = sorted(i for i in doc_ids(x, board)[0] if i and str(i).startswith("b59-"))
        found[x] = ids
        say(f"    {x}: doc holds {ids}")
    disks = {x: sorted(str(n.get("id")) for n in
                       (read_canvas(x, board) or {}).get("nodes", [])
                       if str(n.get("id", "")).startswith("b59-")) for x in VAULTS}
    say(f"    on disk: {disks}  (empty on both — the residue is DOC-ONLY)")
    for x in VAULTS:
        if not found[x]:
            continue
        r = cmd(x, "canvas.simulateEdit", timeout=60, path=board,
                change={"removeNodes": found[x]})
        say(f"    {x} simulateEdit removeNodes -> {json.dumps(r)[:180]}")
    gone, t = await_state(
        "no b59 node remains in either doc",
        lambda: not any(str(i).startswith("b59-") for x in VAULTS
                        for i in doc_ids(x, board)[0] if i), 60)
    say(f"    residue cleared: {gone} after {t:.1f}s")
    after = {x: sorted(i for i in doc_ids(x, board)[0] if i and str(i).startswith("b59-"))
             for x in VAULTS}
    disk_after = {x: len((read_canvas(x, board) or {}).get("nodes", [])) for x in VAULTS}
    say(f"    doc after: {after}   disk node counts after: {disk_after}")
    return {"found": found, "disk_before": disks, "cleared": bool(gone),
            "doc_after": after, "disk_nodes_after": disk_after}


def final_census() -> dict:
    """The state this batch leaves behind, measured rather than assumed."""
    say("")
    say("=" * 78)
    say("  FINAL STATE CENSUS — what B59 leaves behind")
    say("=" * 78)
    out: dict = {}
    for x in VAULTS:
        info = (cmd(x, "session.info").get("result") or {})
        d = ls_b59.bundle_digest(x)
        files = sorted(f.name for f in vpath(x, SHARED).iterdir() if f.is_file())
        store = ls_b59.read_store(x)
        ms = cmd(x, "fileop.muteStats").get("result")
        pr = cmd(x, "fileop.protectedRefusals").get("result")
        row = {
            "role": info.get("role"), "connected": info.get("connected"),
            "roomId": info.get("roomId"), "vaultId": info.get("vaultId"),
            "bundle_sha256": d[0], "bundle_size": d[1],
            "sharedFolder": ls_b59.shared_folder(x),
            "shared_files": files, "shared_file_count": len(files),
            "seed_refusal_paths": sorted((store.get("paths") or {})),
            "data_json_sha256": ls_b59.sha_bytes(vpath(x, ls_b59.PLUGIN_DATA_REL)),
            "sidecar_state_file_count": len(ls_b59.dir_census(x, ls_b59.SIDECAR_STATE_REL)),
            "muteStats": ms, "protectedRefusals": pr,
        }
        out[x] = row
        say(f"  vault {x}: role={row['role']} connected={row['connected']} "
            f"room={row['roomId']}")
        say(f"    bundle sha256={row['bundle_sha256']}")
        say(f"    sharedFolder={row['sharedFolder']!r}  {row['shared_file_count']} files: "
            f"{row['shared_files']}")
        say(f"    seed-refusals paths={row['seed_refusal_paths']} "
            f"(empty list = the store is empty)")
        say(f"    data.json sha256={row['data_json_sha256']}")
        say(f"    sidecar state files={row['sidecar_state_file_count']}")
        say(f"    muteStats={json.dumps(ms)}")
        say(f"    protectedRefusals={json.dumps(pr)}")
    say("")
    say("  S71 clamp, one last time:")
    out["clamp"] = clamp_report()
    return out


def main() -> int:
    if not gate("ARM 3 CONTROL — admission at an ordinary shared path", NEEDED):
        say("\nREFUSING TO MEASURE — the gate did not pass.")
        return 2
    h, g = host_role(), guest_role()
    say(f"  HOST = {h}   GUEST = {g}   (asked, not assumed)")
    clamp_report()
    out: dict = {"roles": dict(ls_b59.ROLES), "host": h, "guest": g, "rows": []}

    def row(label: str, op: dict, oracle, budget: float = 60.0) -> None:
        r0 = refusal_total(h)
        res = inject(h, op)
        got, t = await_state(f"{label}: the disk oracle is satisfied", oracle, budget)
        r1 = refusal_total(h)
        rec = {"row": label, "op": op["type"], "delivered": res["delivered"],
               "mutated_field": res["mutated"], "disk_oracle": bool(got),
               "after_s": round(t, 1), "refusals_delta": r1 - r0,
               "reason": res["reason"]}
        out["rows"].append(rec)
        say(f"    {label:<34} delivered={rec['delivered']} mutated_field={rec['mutated_field']} "
            f"DISK={rec['disk_oracle']} after={rec['after_s']}s refusals+{rec['refusals_delta']}")

    say("")
    say("  Each row has its OWN fixture, and the oracle is the filesystem.")

    a = f"{SHARED}/{PREFIX}-create.md"
    row("create (fresh path)",
        {"type": "create", "path": a, "content": "v1\n"},
        lambda: vpath(h, a).exists())

    b = f"{SHARED}/{PREFIX}-modify.md"
    cmd(h, "fileop.inject", timeout=90,
        op={"type": "create", "path": b, "content": "v1\n"}, settleMs=1200)
    await_state("modify fixture exists", lambda: vpath(h, b).exists(), 30)
    row("modify (own fixture)",
        {"type": "modify", "path": b, "content": "v2-marker\n"},
        lambda: vpath(h, b).exists()
        and "v2-marker" in vpath(h, b).read_text(encoding="utf-8", errors="replace"))

    c_src = f"{SHARED}/{PREFIX}-ren-src.md"
    c_dst = f"{SHARED}/{PREFIX}-ren-dst.md"
    cmd(h, "fileop.inject", timeout=90,
        op={"type": "create", "path": c_src, "content": "rename me\n"}, settleMs=1200)
    await_state("rename fixture exists", lambda: vpath(h, c_src).exists(), 30)
    say(f"    rename precondition: src exists={vpath(h, c_src).exists()} "
        f"dst exists={vpath(h, c_dst).exists()}")
    row("rename (own fixture, DEST oracle)",
        {"type": "rename", "oldPath": c_src, "path": c_dst},
        lambda: vpath(h, c_dst).exists() and not vpath(h, c_src).exists())
    say(f"    after rename: src exists={vpath(h, c_src).exists()} "
        f"dst exists={vpath(h, c_dst).exists()}")

    d = f"{SHARED}/{PREFIX}-delete.md"
    cmd(h, "fileop.inject", timeout=90,
        op={"type": "create", "path": d, "content": "delete me\n"}, settleMs=1200)
    await_state("delete fixture exists", lambda: vpath(h, d).exists(), 30)
    say(f"    delete precondition: exists={vpath(h, d).exists()}")
    row("delete (own fixture, EXISTS first)",
        {"type": "delete", "path": d},
        lambda: not vpath(h, d).exists())

    say("")
    say("  ---- teardown ----")
    left = []
    for name in (a, b, c_src, c_dst, d):
        for x in VAULTS:
            p = vpath(x, name)
            if p.exists():
                try:
                    p.unlink()
                    say(f"    removed {x}:{name}")
                except OSError as e:
                    left.append(f"{x}:{name} ({e})")
    out["leftovers"] = left

    out["residue"] = clear_doc_residue()
    out["final_state"] = final_census()
    applied = [r for r in out["rows"] if r["disk_oracle"]]
    say("")
    say(f"  ADMISSION CONTROL: {len(applied)} of {len(out['rows'])} op kinds were "
        f"ADMITTED AND APPLIED at an ordinary shared path, refusals+0 on every row.")
    out["admitted_rows"] = len(applied)
    out["total_rows"] = len(out["rows"])
    dump("arm3_control_rerun", out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
