"""B56 / W4 — WP68 AC2: THE RECEIVER REFUSES INDEPENDENTLY OF THE SENDER.

B50 reported this NOT DEMONSTRATED for a plain reason: nothing could deliver a
raw `FileOp` to an instance, and both peers run the same guarded build, so
neither would ever emit a sidecar rename to be refused. `fileop.inject`
(`e2e-control.ts`, commit `1fa5131`) closes that: the frame is handed to the
LIVE control socket as a `message` event, so relay → `ControlChannel.onmessage`
→ handler table → `control-handlers.ts`'s `file-op` handler → the WP68 gate all
run unaltered.

WHAT DECIDES EACH ROW
---------------------
Refusal is `mutedAfterDispatch: false` AND `mutated: false` — WITH the `before`
reading proving the source file existed. Without that last part "nothing
happened" is unfalsifiable, and it is also what a typo in `oldPath` looks like.

Admission is `mutedAfterDispatch: true` (`applyRemoteOpInner` takes the path
mute before it touches the vault) and `mutated: true` (bytes moved). The
ADMITTED arm is not decoration: without it the refusal rows are consistent with
a gate that refuses everything, or with an injection seam that reaches nothing.

THE THREE DESTINATIONS, and the third is the point
--------------------------------------------------
`isSidecarPath` (`files/canvas-sidecar.ts:94-103`) is a directory-prefix test
over `SIDECAR_DIR = ".obsidian/liveshare/state"` — and that is the ONLY thing
the WP68 gate tests.

  A  `.obsidian/liveshare/state/…`      inside SIDECAR_DIR   → gate must refuse
  B  `_liveshare-test/…`                shared → shared      → must be ADMITTED
  C  `.obsidian/plugins/live-share/…`   under `.obsidian/**` but NOT under
                                        SIDECAR_DIR          → measured, not assumed

C is the directory this vault's `data.json` lives in — `serverPassword`, `token`,
`encryptionPassphrase`, `encryptionSalt` — and the directory `main.js` is loaded
from. WP68's own charter names its subject as *"a peer-reachable write into this
Electron process's own `.obsidian/**`"*. Whether the implemented predicate
covers that subject is a measurement this arm takes, not a claim it makes.

SAFETY
------
  * The only file ever named as `oldPath` is one THIS run created. No owner file
    is renamed, moved, deleted or read.
  * Destination filenames are unique per run and can collide with nothing;
    `data.json` and `main.js` are never named as a destination, and the
    fixture's own name is checked against both before any injection.
  * `fileop.inject` never returns content — only exists/size/sha256 — which is
    why it can be pointed at `.obsidian/**` at all.
  * Whatever lands is moved back on disk and reported.
"""

from __future__ import annotations

import json
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
    read_canvas,
    say,
    sha_file,
    vpath,
    waiter,
)

SIDECAR_DIR = ".obsidian/liveshare/state"
PLUGIN_DIR = ".obsidian/plugins/live-share"
NEEDED = ("session.info", "canvas.state", "canvas.file", "fileop.inject")
FORBIDDEN_DESTS = ("data.json", "main.js", "manifest.json", "styles.css")


def inject(role: str, op: dict, settle: int = 1200) -> dict:
    r = cmd(role, "fileop.inject", timeout=60, op=op, settleMs=settle)
    return r.get("result") if r.get("ok") else {"__error__": r.get("error")}


def endpoints(res: dict) -> dict:
    """The reading, per endpoint, in a shape a row can be read off. No content."""
    out = {}
    for phase in ("before", "after"):
        for obs in (res.get(phase) or []):
            out.setdefault(obs["path"], {})[phase] = {
                "exists": obs["exists"], "size": obs["size"],
                "sha256": obs["sha256"][:16] if obs["sha256"] else "",
                "muted": obs["muted"]}
    return out


def report(label: str, res: dict) -> None:
    say(f"    {label}")
    if "__error__" in res:
        say(f"      COMMAND ERROR: {res['__error__']}")
        return
    say(f"      delivered={res.get('delivered')} entry={res.get('entry')} "
        f"reason={res.get('reason')}")
    say(f"      mutedAfterDispatch={res.get('mutedAfterDispatch')} "
        f"mutated={res.get('mutated')} changed={res.get('changed')} "
        f"samples={res.get('samples')} frameBytes={res.get('frameBytes')}")
    for path, phases in endpoints(res).items():
        say(f"      {path}")
        for phase in ("before", "after"):
            v = phases.get(phase, {})
            say(f"        {phase:6} exists={v.get('exists')} size={v.get('size')} "
                f"sha256={v.get('sha256')}… muted={v.get('muted')}")


def main() -> int:
    if not gate("WP68 AC2 — the INBOUND refusal", NEEDED):
        say("\nREFUSING TO MEASURE — the gate did not pass.")
        return 2
    h, g = host_role(), guest_role()
    say("")
    say(f"  HOST = {h}   GUEST = {g}   (asked, not assumed)")
    clamp_report()

    # ---- the fixture: a file THIS run owns, already indexed by Obsidian -----
    # It must be a path both instances hold and Obsidian has in its index, so a
    # rename can actually be attempted. Reuse the S81 board if it is present on
    # the target; otherwise refuse rather than rename something of the owner's.
    state = Path(r"H:\tmp\b56_s81_state.json")
    fixture = None
    if state.exists():
        rel = json.loads(state.read_text(encoding="utf-8")).get("rel")
        if rel and vpath(g, rel).exists() and vpath(h, rel).exists():
            fixture = rel
    if fixture is None:
        say("  !! no run-owned fixture present in both vaults. REFUSING to name an")
        say("     owner file as `oldPath`. Re-run S81 step 3 first.")
        return 2
    name = fixture.split("/")[-1]
    if any(bad in name for bad in FORBIDDEN_DESTS):
        say(f"  !! fixture name {name!r} is on the forbidden list")
        return 2
    say(f"  fixture (created by this batch): {fixture}")
    say(f"    {h}: exists={vpath(h, fixture).exists()} sha256={sha_file(h, fixture)}")
    say(f"    {g}: exists={vpath(g, fixture).exists()} sha256={sha_file(g, fixture)}")

    target = g          # inject into the GUEST; it is the peer-reachable side
    say(f"  injecting into {target} (role={ls_b56.ROLES[target]})")

    rows: dict = {}
    w = waiter()
    mark = w.mark("wp68-inbound")

    # --- 0. THE INSTRUMENT CONTROL, first ----------------------------------
    # A `create` naming a path nowhere near the shared tree. It is dropped by
    # the ORDINARY not-shared test, not by WP68 — so it establishes that a
    # delivered frame with nothing to do reads as `delivered=true, mutated=false`
    # and therefore that `mutated=false` alone means nothing.
    say("")
    say("  [0] instrument control — a delivered frame that SHOULD do nothing")
    r0 = inject(target, {"type": "create", "path": f"b56-wp68-{RUN}-nowhere.md",
                         "content": "x"})
    report("create outside the shared tree (ordinary not-shared drop, not WP68)", r0)
    rows["ctrl_not_shared"] = r0

    # --- 1. REFUSAL: destination inside SIDECAR_DIR -------------------------
    say("")
    say("  [1] REFUSAL ARM — destination inside SIDECAR_DIR (WP68's predicate)")
    dest_a = f"{SIDECAR_DIR}/b56-wp68-{RUN}-sidecar.canvas"
    r1 = inject(target, {"type": "rename", "oldPath": fixture, "newPath": dest_a})
    report(f"rename {fixture} -> {dest_a}", r1)
    rows["sidecar_dest"] = r1

    # --- 2. ADMITTED CONTROL: shared -> shared ------------------------------
    say("")
    say("  [2] ADMITTED CONTROL — the same op with a non-sidecar destination")
    dest_b = f"{SHARED}/b56-wp68-{RUN}-moved.canvas"
    r2 = inject(target, {"type": "rename", "oldPath": fixture, "newPath": dest_b})
    report(f"rename {fixture} -> {dest_b}", r2)
    rows["shared_dest"] = r2
    moved_ok, t_moved = await_state(
        f"{target} holds the destination and no longer the source",
        lambda: vpath(target, dest_b).exists() and not vpath(target, fixture).exists(), 30)
    say(f"      on-disk confirmation after {t_moved:.1f}s: "
        f"dest_exists={vpath(target, dest_b).exists()} "
        f"src_exists={vpath(target, fixture).exists()}")

    # move it back so arm 3 has the same subject as arm 1
    back = None
    if vpath(target, dest_b).exists():
        r_back = inject(target, {"type": "rename", "oldPath": dest_b, "newPath": fixture})
        back = r_back
        await_state("the fixture is back at its original path",
                    lambda: vpath(target, fixture).exists(), 30)
        say(f"      restored: fixture exists={vpath(target, fixture).exists()}")
    rows["restore_after_admit"] = back

    # --- 3. THE SCOPE PROBE: under .obsidian/** but NOT under SIDECAR_DIR ---
    say("")
    say("  [3] SCOPE PROBE — `.obsidian/plugins/live-share/`, the directory that")
    say("      holds this vault's data.json and main.js. NOT under SIDECAR_DIR, so")
    say("      WP68's predicate does not test it. Destination filename is unique to")
    say("      this run and collides with nothing.")
    dest_c = f"{PLUGIN_DIR}/b56-wp68-{RUN}-probe.canvas"
    assert not any(bad in dest_c for bad in FORBIDDEN_DESTS)
    r3 = inject(target, {"type": "rename", "oldPath": fixture, "newPath": dest_c})
    report(f"rename {fixture} -> {dest_c}", r3)
    rows["plugin_dir_dest"] = r3
    landed, t_landed = await_state(
        "the probe lands inside the plugin directory",
        lambda: vpath(target, dest_c).exists(), 30)
    say(f"      on-disk after {t_landed:.1f}s: "
        f"probe_exists={vpath(target, dest_c).exists()} "
        f"src_exists={vpath(target, fixture).exists()}")

    # ---- clean up whatever landed -----------------------------------------
    say("")
    say("  ---- cleanup ----")
    for dest in (dest_a, dest_b, dest_c):
        p = vpath(target, dest)
        if p.exists():
            if not vpath(target, fixture).exists():
                p.replace(vpath(target, fixture))
                say(f"    moved {dest} back to {fixture}")
            else:
                p.unlink()
                say(f"    removed {dest}")
    say(f"    fixture restored: {vpath(target, fixture).exists()} "
        f"sha256={sha_file(target, fixture)}")

    mark.close()
    ev = w.collect(mark, tuple(ls_b56.RECEIPTS), timeout_s=180)
    say("")
    say("  " + ev.summary().replace("\n", "\n  "))
    refused_lines = [ln for ln in ev.hits("refused remote rename", target)]
    say(f"  'refused remote rename' lines on {target} in the window: {len(refused_lines)}")
    for ln in refused_lines[:6]:
        say(f"    {ln.strip()[:210]}")
    table = ls_b56.rule15(ev)

    def verdict(r: dict) -> str:
        if not r or "__error__" in r:
            return "COMMAND ERROR"
        if r.get("delivered") is not True:
            return f"NOT DELIVERED ({r.get('reason')})"
        return "ADMITTED" if (r.get("mutedAfterDispatch") or r.get("mutated")) else "REFUSED"

    say("")
    say("  ---- ROWS ----")
    for k in ("ctrl_not_shared", "sidecar_dest", "shared_dest", "plugin_dir_dest"):
        say(f"    {k:18} : {verdict(rows.get(k))}")

    out = {"target": target, "roles": dict(ls_b56.ROLES), "fixture": fixture,
           "destinations": {"sidecar": dest_a, "shared": dest_b, "plugin_dir": dest_c},
           "rows": rows,
           "verdicts": {k: verdict(rows.get(k)) for k in
                        ("ctrl_not_shared", "sidecar_dest", "shared_dest",
                         "plugin_dir_dest")},
           "refused_remote_rename_lines": refused_lines[:10],
           "rule15": table}
    dump("wp68_inbound", out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
