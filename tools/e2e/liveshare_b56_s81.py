"""B56 / W4 — S81: the arm where RE-DERIVATION CANNOT RESCUE WP90.

THE PROBLEM
-----------
B50 showed the withhold surviving a restart and then said, correctly, that the
demonstration was worthless as evidence FOR WP90: every session re-derived the
verdict from the host seed (`the stored set is re-derived, not restored`). The
`restored N standing refusal(s)` branch has never fired in this project's
history, so what was shown live is WP63's re-derivation — which already worked
before WP90 existed.

WHY THE BRANCH HAS NEVER FIRED — read from the source, then measured
--------------------------------------------------------------------
`SeedRefusalLedger.note()` — the ONLY writer of a refusal — has exactly two
callers, and each calls `reset()` first, which sets `seededThisSession = true`:

    canvas-sync.ts:3946        applyCanvasToYMaps    — the HOST seed. Guarded by
                               `role === "host"` AND the local file existing.
    canvas-persistence.ts:739  seedDocFromCanvasData — the COLD-OPEN seed. Runs
                               only when the doc is EMPTY at cold open.

`hydrateDurableRefusals` (canvas-persistence.ts:641) restores from the store
only when `hasSeededThisSession` is FALSE. Therefore, on any one path:

    A SESSION THAT CAN RECORD A REFUSAL IS EXACTLY A SESSION THAT CANNOT
    RESTORE ONE, AND VICE VERSA.

On a host with the file present the seed runs every session, so the host can
never take the restore branch. That is the structural reason S81 has stood.
The branch is reachable only across a change of role (or of doc-emptiness)
between the recording session and the restoring one.

THE ARM — three sessions, and the role assignment is the instrument
-------------------------------------------------------------------
  step1  X is HOST, the malformed board is on disk in both vaults.
         X's host seed refuses the bad edge and X's OWN durable store is
         written. (Also reproduces B50 §2.3 on this bundle: the guest replicates
         the file, cold-opens `doc-wins` and DESTROYS its copy of the record.)
  step2  a fresh room is provisioned with the OTHER vault as host, so X comes
         back as a GUEST holding a store entry its own seed wrote — and X's copy
         of the board is removed while X is down, so WP79's mirror pass
         MATERIALISES it and X gets a `CanvasPersistence` WITH NO LEAF OPEN.
         X's doc arrives non-empty from the new host, so cold open takes
         `doc-wins` — NO SEED RUNS ON X AT ALL. Re-derivation is impossible. If
         the write is withheld, only `restore()` can be holding it.
  step3  THE CONTROL. Byte-identical to step2 with ONE difference: X's durable
         entry for this path is deleted while the process is down. `doc-wins`
         FLUSHES, so the projection must now land. Without this arm "no file
         appeared" is unfalsifiable — it is also what "nothing happened" looks
         like.

S80, MEASURED AND WIDENED HERE. The withhold is consulted only from
`flushToDisk`, so it needs an attached `CanvasPersistence`. The attach routes
are exactly two: WP79's mirror pass and WP85's per-open-leaf consultation. And
`decideCanvasMirror` (canvas-mirror-decision.ts:109-126) materialises for a
GUEST ONLY WHEN THE LOCAL FILE IS ABSENT — `localFileExists !== false` yields
SKIP_LOCAL_FILE, and the module states the reason in its own words: *"the pass
only ever touches paths with no user file to destroy"*. The host arm returns
PUBLISH without materialising (C79 AC4).

So there is NO leaf-less configuration in which the withhold guards a file that
ALREADY EXISTS, on either role. Step 1 measured that: 150 s as host with no leaf
produced no store entry and no `SEED REFUSAL STORE:` line at all; opening one
leaf produced both within 2 s. Step 2 therefore takes the one leaf-less attach
the product has — the guest materialise — which necessarily means the file is
ABSENT, so what the withhold protects here is the WRITE, not existing bytes.

USAGE
    python liveshare_b56_s81.py step1 [A|B]   # which vault RECORDS (as host)
    python liveshare_b56_s81.py step2
    python liveshare_b56_s81.py step3
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, r"H:\tmp")
import ls_b56  # noqa: E402
from ls_b56 import (  # noqa: E402
    BUNDLES,
    RUN,
    SHARED,
    VAULTS,
    await_state,
    bundle_digest,
    clamp_report,
    cmd,
    doc_ids,
    dump,
    eids,
    gate,
    guest_role,
    host_role,
    log_path,
    nids,
    read_canvas,
    read_store,
    restart,
    rule15,
    say,
    sha_file,
    snapshot_shared,
    store_entry,
    store_path,
    vpath,
    wait_connected,
    waiter,
    write_canvas_raw,
)

STATE = Path(r"H:\tmp\b56_s81_state.json")
PROVISION = r"H:\tmp\liveshare_b56_provision.py"
BAD = "BADEDGE"
NEEDED = ("session.info", "canvas.state", "canvas.file", "sync.waitQuiescent")


def rel_for(tag: str) -> str:
    return f"{SHARED}/b56-s81-{tag}.canvas"


def malformed(tag: str) -> dict:
    """Two valid nodes and ONE edge with `fromNode` and NO `toNode`.

    `MISSING_TO` — canvas-ingest-schema.ts:289. The nodes are valid so the
    refused set is exactly one record and `describe()` stays readable.
    """
    n1, n2 = f"b56-s81-{tag}-N1", f"b56-s81-{tag}-N2"
    return {
        "nodes": [
            {"id": n1, "type": "text", "text": n1, "x": 0, "y": 0, "width": 200, "height": 100},
            {"id": n2, "type": "text", "text": n2, "x": 400, "y": 0, "width": 200, "height": 100},
        ],
        "edges": [{"id": f"b56-s81-{tag}-{BAD}", "fromNode": n1, "fromSide": "right"}],
    }


def bad_on_disk(role: str, rel: str) -> bool:
    doc = read_canvas(role, rel)
    return bool(doc) and any(BAD in str(e.get("id", ""))
                             for e in doc.get("edges", []) if isinstance(e, dict))


def describe(role: str, rel: str) -> dict:
    doc = read_canvas(role, rel)
    return {"exists": vpath(role, rel).exists(), "sha256": sha_file(role, rel),
            "nodes": sorted(i for i in nids(doc) if i),
            "edges": sorted(i for i in eids(doc) if i),
            "bad_edge_on_disk": bad_on_disk(role, rel)}


def kill_obsidian() -> None:
    subprocess.run(["taskkill", "/F", "/IM", "Obsidian.exe"], capture_output=True, text=True)
    for _ in range(25):
        time.sleep(1)
        out = subprocess.run(["tasklist"], capture_output=True, text=True, timeout=30).stdout
        if not any("obsidian.exe" in ln.lower() for ln in out.splitlines()):
            say("  Obsidian stopped")
            return
    say("  !! Obsidian still running")


def session_lines(role: str, needles: tuple[str, ...]) -> list[str]:
    p = log_path(role)
    if not p.exists():
        return []
    txt = p.read_text(encoding="utf-8", errors="replace")
    return [ln for ln in txt.splitlines() if any(n in ln for n in needles)]


def save(d: dict) -> None:
    STATE.write_text(json.dumps(d, indent=2, default=str), encoding="utf-8")


def load() -> dict:
    return json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else {}


def relaunch(digest: str, note: str) -> bool:
    if not restart(digest, note):
        return False
    return wait_connected()


# =========================================================================== #
def step1() -> int:
    recorder = (sys.argv[2] if len(sys.argv) > 2 else "A").upper()
    other = "B" if recorder == "A" else "A"
    tag = RUN
    rel = rel_for(tag)
    digest = bundle_digest("A")[0]

    say("=" * 78)
    say(f"B56 / W4 — S81 step 1 — {recorder} RECORDS (as host)   board {rel}")
    say("=" * 78)
    say("  The board is planted while Obsidian is DOWN, because a file created")
    say("  externally into a running vault is not noticed (measured this run: an")
    say("  external CREATE produced zero receipts over 90 s while an external")
    say("  MODIFY of a shared canvas reached both docs in 2.0 s).")

    say(f"  provisioning a room with HOST={recorder}")
    p = subprocess.run([sys.executable, PROVISION, recorder],
                       capture_output=True, text=True, timeout=600)
    for ln in (p.stdout or "").splitlines():
        say(f"    | {ln}")
    if p.returncode != 0:
        say(f"    !! provisioner exited {p.returncode}: {(p.stderr or '')[:400]}")
        return 2

    kill_obsidian()
    for r in VAULTS:
        write_canvas_raw(r, malformed(tag), rel)
        say(f"  planted the malformed board in {r}:{rel} sha256={sha_file(r, rel)}")

    if not relaunch(digest, "S81 step 1"):
        return 2
    if not gate("S81 step 1 — the recording session", NEEDED, probe_canvas=rel):
        return 2
    h, g = host_role(), guest_role()
    say(f"  HOST = {h}   GUEST = {g}   (asked, not assumed)")
    if h != recorder:
        say(f"  !! the relay did NOT designate {recorder} as host — the arm needs it to")
        return 1
    clamp_report()

    # S80, MEASURED AND WIDENED THIS RUN. The host seed refuses in memory, but
    # the durable SINK is assigned only by `hydrateDurableRefusals`, which runs
    # from `CanvasPersistence.coldOpen` — and on a HOST the mirror pass returns
    # PUBLISH without materialising (C79 AC4), so the only remaining attach
    # route is WP85's per-open-leaf consultation. Measured here: 150 s with no
    # leaf produced NO store entry and NO `SEED REFUSAL STORE:` line; the leaf
    # produced both within 2 s. `canvas.open` is NOT used (S45).
    say("  opening a real leaf on the host with canvas.typeInNode{open:true} (S45)")
    lr = cmd(h, "canvas.typeInNode", path=rel, nodeId=f"b56-s81-{tag}-N1", open=True, text="")
    say(f"    typeInNode -> {json.dumps(lr)[:240]}")

    got_store, t_store = await_state(
        f"{h}'s durable store holds an entry for this path",
        lambda: isinstance(store_entry(h, rel), list) and len(store_entry(h, rel)) > 0, 150)
    entry = store_entry(h, rel)
    say(f"  {h} (host) store entry after {t_store:.1f}s: {json.dumps(entry)}")

    got_doc, t_doc = await_state(
        f"{h}'s doc holds the two valid nodes and NOT the bad edge",
        lambda: len([i for i in doc_ids(h, rel)[0] if i]) == 2
        and not any(BAD in str(i) for i in doc_ids(h, rel)[1]), 150)
    say(f"  {h} doc after {t_doc:.1f}s: nodes={sorted(i for i in doc_ids(h, rel)[0] if i)} "
        f"edges={sorted(i for i in doc_ids(h, rel)[1] if i)}")

    # B50 §2.3 reproduction: the guest replicates and destroys its copy.
    lost, t_lost = await_state(
        f"the GUEST {g} loses the malformed record from its own disk (B50 §2.3)",
        lambda: vpath(g, rel).exists() and not bad_on_disk(g, rel), 150)

    hits = {r: session_lines(r, (tag,)) for r in VAULTS}
    say("")
    say("  ---- lines naming this board ----")
    for r in VAULTS:
        say(f"    [{r}] {len(hits[r])} lines")
        for ln in hits[r][:12]:
            say(f"        {ln.strip()[:210]}")

    files = {r: describe(r, rel) for r in VAULTS}
    for r in VAULTS:
        say(f"  {r} file: {json.dumps(files[r])}")

    st = {"tag": tag, "rel": rel, "recorder": recorder, "other": other,
          "roles_step1": dict(ls_b56.ROLES), "bundle": dict(BUNDLES),
          "step1": {
              "store_entry_recorded": bool(got_store and entry),
              "store_entry": entry,
              "host_doc_refused_edge": bool(got_doc),
              "guest_copy_destroyed": bool(lost),
              "guest_destroyed_after_s": t_lost if lost else None,
              "files": files,
              "store_host": read_store(h), "store_guest": read_store(g),
              "log_lines": {r: hits[r][:40] for r in VAULTS},
          }}
    save(st)
    say("")
    say(f"  STEP 1: store_entry_recorded={st['step1']['store_entry_recorded']}  "
        f"host_kept_bad_edge={files[h]['bad_edge_on_disk']}  "
        f"guest_copy_destroyed={st['step1']['guest_copy_destroyed']}")
    dump("s81_step1", st)
    return 0 if st["step1"]["store_entry_recorded"] else 1


# =========================================================================== #
def step2() -> int:
    """The RESTORE arm: the recorder returns as a LEAF-LESS guest with no file."""
    st = load()
    if not st:
        say("no state - run step1 first")
        return 2
    rel, tag, recorder, other = st["rel"], st["tag"], st["recorder"], st["other"]
    digest = bundle_digest("A")[0]

    say("=" * 78)
    say(f"B56 / W4 - S81 step 2 - {recorder} returns as a LEAF-LESS GUEST")
    say("=" * 78)
    for r in VAULTS:
        say(f"  {r} file before: {json.dumps(describe(r, rel))}")
        say(f"  {r} store entry before: {json.dumps(store_entry(r, rel))}")

    entry = store_entry(recorder, rel)
    if not isinstance(entry, list) or not entry:
        say(f"  !! {recorder} has no durable entry for {rel} - the arm has no subject")
        return 1
    say(f"  the subject: {recorder}'s own seed wrote {json.dumps(entry)}")

    say(f"  provisioning a room with HOST={other} so {recorder} comes back a GUEST")
    p = subprocess.run([sys.executable, PROVISION, other],
                       capture_output=True, text=True, timeout=600)
    for ln in (p.stdout or "").splitlines():
        say(f"    | {ln}")
    if p.returncode != 0:
        say(f"    !! provisioner exited {p.returncode}: {(p.stderr or '')[:400]}")
        return 2

    kill_obsidian()
    # The ONE structural move: remove the recorder's copy so WP79's mirror pass
    # is admitted (SKIP_LOCAL_FILE otherwise) and attaches the writer with NO
    # leaf open. The durable entry is left exactly as the product wrote it.
    removed = vpath(recorder, rel)
    if removed.exists():
        removed.unlink()
    say(f"  removed {recorder}:{rel} so the guest mirror pass can materialise it")
    say(f"  {recorder} store entry still present: {json.dumps(store_entry(recorder, rel))}")

    if not relaunch(digest, "S81 step 2"):
        return 2
    if not gate("S81 step 2 - the RESTORE arm", NEEDED, probe_canvas=rel):
        return 2
    h, g = host_role(), guest_role()
    say(f"  HOST = {h}   GUEST = {g}   (asked, not assumed)")
    if g != recorder:
        say(f"  !! {recorder} is NOT the guest this session - the arm cannot run")
        return 1
    clamp_report()

    # No leaf is opened on the guest in this arm. That is the point.
    got_doc, t_doc = await_state(
        f"{g}'s doc holds the board (subscribe + mirror + cold open have run)",
        lambda: len([i for i in doc_ids(g, rel)[0] if i]) >= 1, 180)
    say(f"  {g} doc after {t_doc:.1f}s: nodes={sorted(i for i in doc_ids(g, rel)[0] if i)}")

    # WAIT ON THE OBSERVABLE: if the file appears, the withhold did NOT hold,
    # and that is the answer rather than a timeout.
    landed, t_land = await_state(
        f"the projection LANDS on {g}'s disk (i.e. the withhold FAILED)",
        lambda: vpath(g, rel).exists(), 120)

    short = rel.split("/")[-1]
    restored = [ln for ln in session_lines(g, ("restored",))
                if "standing" in ln and short in ln]
    adopted = [ln for ln in session_lines(g, ("adopted this session's seed verdict",))
               if short in ln]
    withheld = [ln for ln in session_lines(g, ("SEED REFUSED:",)) if short in ln]
    coldseed = [ln for ln in session_lines(g, ("boundary=cold-open-seed",)) if tag in ln]
    hostseed = [ln for ln in session_lines(g, ("boundary=host-seed",)) if tag in ln]
    writer = [ln for ln in session_lines(g, ("CANVAS WRITER:",)) if short in ln]
    mirror = [ln for ln in session_lines(g, ("CANVAS MIRROR:",))][-3:]

    say("")
    say(f"  ---- THE DECIDING LINES, on {g} (the recorder, now a leaf-less guest) ----")
    for label, lines in (("restored N standing", restored),
                         ("adopted (re-derived)", adopted),
                         ("SEED REFUSED / withheld", withheld),
                         ("cold-open-seed refusal", coldseed),
                         ("host-seed refusal", hostseed),
                         ("CANVAS WRITER attach", writer),
                         ("CANVAS MIRROR (last 3)", mirror)):
        say(f"    {label:26} : {len(lines)}")
        for ln in lines[:4]:
            say(f"        {ln.strip()[:215]}")

    w = waiter()
    mark = w.mark("s81-step2")
    mark.close()
    ev = w.collect(mark, tuple(ls_b56.RECEIPTS), timeout_s=150)
    table = rule15(ev)

    files = {r: describe(r, rel) for r in VAULTS}
    for r in VAULTS:
        say(f"  {r} file after: {json.dumps(files[r])}")

    v = {"guest": g, "host": h, "roles": dict(ls_b56.ROLES),
         "restored_branch_fired": len(restored) > 0,
         "adopted_branch_fired": len(adopted) > 0,
         "cold_open_seed_ran": len(coldseed) > 0,
         "host_seed_ran_on_recorder": len(hostseed) > 0,
         "withhold_lines": len(withheld),
         "writer_attached": len(writer) > 0,
         "projection_landed": bool(landed),
         "landed_after_s": t_land if landed else None,
         "file_absent_on_recorder": not files[g]["exists"],
         "restored_lines": restored[:6], "adopted_lines": adopted[:6],
         "withheld_lines": withheld[:6], "writer_lines": writer[:6],
         "mirror_lines": mirror, "files": files,
         "store_entry_guest": store_entry(g, rel), "rule15": table}
    st["step2"] = v
    save(st)
    say("")
    say(f"  STEP 2 VERDICT: restored_branch_fired={v['restored_branch_fired']}  "
        f"adopted={v['adopted_branch_fired']}  cold_open_seed_ran={v['cold_open_seed_ran']}  "
        f"writer_attached={v['writer_attached']}  "
        f"projection_landed={v['projection_landed']}")
    dump("s81_step2", st)
    return 0


# =========================================================================== #
def step3() -> int:
    """THE CONTROL: step 2 with the durable entry deleted, nothing else."""
    st = load()
    if not st:
        say("no state - run step1/step2 first")
        return 2
    rel, tag, recorder = st["rel"], st["tag"], st["recorder"]
    digest = bundle_digest("A")[0]

    say("=" * 78)
    say("B56 / W4 - S81 step 3 - THE CONTROL: same session, durable entry deleted")
    say("=" * 78)
    say("  Step 2 minus ONE thing. Same roles, same room, same absent file on the")
    say("  recorder - only its durable entry for this path is removed while the")
    say("  process is down. If the projection lands here and was withheld there,")
    say("  the durable store is the only difference and therefore the cause.")

    kill_obsidian()
    f = vpath(recorder, rel)
    if f.exists():
        f.unlink()
        say(f"  removed {recorder}:{rel} again, so the mirror pass is admitted")

    cleared = {}
    for r in VAULTS:
        pth = store_path(r)
        if not pth.exists():
            cleared[r] = "store absent"
            continue
        root = json.loads(pth.read_text(encoding="utf-8"))
        had = (root.get("paths") or {}).pop(rel, None)
        pth.write_text(json.dumps(root, indent=2) + "\n", encoding="utf-8")
        cleared[r] = f"removed {json.dumps(had)}"
        say(f"  {r}: {cleared[r]}")

    if not relaunch(digest, "S81 step 3 CONTROL"):
        return 2
    if not gate("S81 step 3 - the control", NEEDED, probe_canvas=rel):
        return 2
    h, g = host_role(), guest_role()
    say(f"  HOST = {h}   GUEST = {g}   (asked, not assumed)")
    clamp_report()

    await_state(f"{g}'s doc holds the board again",
                lambda: len([i for i in doc_ids(g, rel)[0] if i]) >= 1, 180)
    landed, t_land = await_state(
        f"the projection LANDS on {g}'s disk (the doc-wins flush)",
        lambda: vpath(g, rel).exists(), 120)

    short = rel.split("/")[-1]
    restored = [ln for ln in session_lines(g, ("restored",))
                if "standing" in ln and short in ln]
    withheld = [ln for ln in session_lines(g, ("SEED REFUSED:",)) if short in ln]
    writer = [ln for ln in session_lines(g, ("CANVAS WRITER:",)) if short in ln]
    say("")
    say(f"  ---- THE CONTROL'S LINES on {g} ----")
    say(f"    restored N standing : {len(restored)}")
    say(f"    SEED REFUSED        : {len(withheld)}")
    say(f"    CANVAS WRITER       : {len(writer)}")
    for ln in writer[:4]:
        say(f"        {ln.strip()[:215]}")

    w = waiter()
    mark = w.mark("s81-step3")
    mark.close()
    ev = w.collect(mark, tuple(ls_b56.RECEIPTS), timeout_s=150)
    table = rule15(ev)

    files = {r: describe(r, rel) for r in VAULTS}
    for r in VAULTS:
        say(f"  {r} file after: {json.dumps(files[r])}")

    v = {"guest": g, "host": h, "roles": dict(ls_b56.ROLES), "store_cleared": cleared,
         "restored_branch_fired": len(restored) > 0,
         "withhold_lines": len(withheld), "writer_attached": len(writer) > 0,
         "projection_landed": bool(landed),
         "landed_after_s": t_land if landed else None,
         "files": files, "rule15": table}
    st["step3"] = v
    save(st)
    say("")
    say(f"  STEP 3 (CONTROL) VERDICT: projection_landed={v['projection_landed']}  "
        f"restored_branch_fired={v['restored_branch_fired']}")
    dump("s81_step3", st)
    return 0


def main() -> int:
    what = sys.argv[1] if len(sys.argv) > 1 else "step1"
    return {"step1": step1, "step2": step2, "step3": step3}.get(
        what, lambda: (say(f"unknown step {what!r}"), 2)[1])()


if __name__ == "__main__":
    sys.exit(main())
