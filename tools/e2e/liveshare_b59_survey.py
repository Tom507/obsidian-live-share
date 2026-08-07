"""B59 / W4 — the gate plus a board survey, run ONCE before the six arms.

This is the provisioning step the batch pays for once: it establishes WHICH code
is running (marker census, not file date), WHICH instance is host (asked, never
assumed), and for every shared canvas WHICH regime it is in — leaf open or not,
doc subscribed or not. The arms then pick their fixtures from the survey instead
of each rediscovering the rig.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ls_b59  # noqa: E402
from ls_b59 import (  # noqa: E402
    SHARED,
    VAULTS,
    clamp_report,
    cmd,
    dump,
    gate,
    guest_role,
    host_role,
    read_canvas,
    say,
    snapshot_shared,
    vpath,
)

NEEDED = ("session.info", "canvas.state", "canvas.file", "sync.waitQuiescent",
          "canvas.editingSignal", "fileop.inject", "fileop.muteStats",
          "fileop.protectedRefusals")


def main() -> int:
    if not gate("SURVEY (the one provisioning step for six arms)", NEEDED):
        say("\nREFUSING TO MEASURE — the gate did not pass.")
        dump("survey_FAILED", {"roles": dict(ls_b59.ROLES)})
        return 2
    h, g = host_role(), guest_role()
    say(f"  HOST = {h}   GUEST = {g}   (asked, not assumed)")
    clamp_report()

    out = {"roles": dict(ls_b59.ROLES), "host": h, "guest": g,
           "bundles": dict(ls_b59.BUNDLES), "pinned": ls_b59.pinned()}

    say("")
    say("  ---- board survey: which regime is each shared canvas in? ----")
    boards: dict[str, dict] = {}
    names = sorted({f.name for r in VAULTS for f in vpath(r, SHARED).iterdir()
                    if f.is_file() and f.name.endswith(".canvas")})
    for name in names:
        rel = f"{SHARED}/{name}"
        row: dict = {"rel": rel}
        for role in VAULTS:
            sig = (cmd(role, "canvas.editingSignal", path=rel).get("result") or {})
            st = cmd(role, "canvas.state", path=rel)
            disk = read_canvas(role, rel)
            row[role] = {
                "on_disk": vpath(role, rel).exists(),
                "disk_nodes": None if disk is None else len(disk.get("nodes", [])),
                "hasAdapter": sig.get("hasAdapter"),
                "hasWriter": sig.get("hasWriter"),
                "adapterAvailable": sig.get("adapterAvailable"),
                "doc_ok": bool(st.get("ok")),
                "doc_nodes": len(((st.get("result") or {}).get("nodes") or []))
                if st.get("ok") else None,
            }
        boards[name] = row
        say(f"    {name}")
        for role in VAULTS:
            d = row[role]
            say(f"      {role} ({ls_b59.ROLES[role]:5}): disk={d['on_disk']} "
                f"disk_nodes={d['disk_nodes']} hasAdapter={d['hasAdapter']} "
                f"hasWriter={d['hasWriter']} doc_ok={d['doc_ok']} "
                f"doc_nodes={d['doc_nodes']}")
    out["boards"] = boards
    out["pre_tree"] = snapshot_shared()

    say("")
    say("  ---- baseline counters (both instances) ----")
    for role in VAULTS:
        ms = cmd(role, "fileop.muteStats").get("result")
        pr = cmd(role, "fileop.protectedRefusals").get("result")
        say(f"    {role}: muteStats={ms}")
        say(f"    {role}: protectedRefusals={pr}")
        out.setdefault("baseline", {})[role] = {"muteStats": ms, "protectedRefusals": pr}

    dump("survey", out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
