"""B50 — attribute WP68's observed peer-file loss.

THE OBSERVATION: a rename whose destination is a SIDECAR path is refused (the
peer's `.obsidian/**` is untouched, which is the security property WP68 exists
for) — but the peer's copy at the OLD shared path DISAPPEARS. C68 AC3 says it
must not: "Divergence — the peer keeps its copy at `oldPath` while the local
vault has moved its own — is the ACCEPTED outcome; deletion is an abort
criterion."

THE QUESTION THIS FILE ANSWERS, and it is the difference between an AC3 failure
and a mis-attribution: is the loss caused by the SIDECAR refusal, or by the
generic "the file left the shared tree" behaviour that any out-of-tree rename
would produce?

THE CONTROL: the identical rename to a destination that is NOT a sidecar path
and NOT in the shared folder (the vault root). WP68's guard cannot fire for it.

  * peer keeps its copy  → the ordinary out-of-tree rename is non-destructive,
                           so the sidecar arm destroying is WP68's and AC3 fails.
  * peer loses it too    → the loss is the generic behaviour, WP68's refusal is
                           not the cause, and the finding belongs elsewhere.

A third arm renames INSIDE the shared tree, which must keep the peer's copy at
the NEW path — that is the positive control proving renames are observable at
all in this run.
"""

from __future__ import annotations

import hashlib
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, r"H:\tmp")
from liveshare_b50 import (  # noqa: E402
    SHARED,
    VAULTS,
    await_state,
    cmd,
    say,
    shared_folder,
    vpath,
)

RUN = time.strftime("%H%M%S")


def put(role: str, rel: str, text: str) -> None:
    p = vpath(role, rel)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


def ex(role: str, rel: str) -> bool:
    return vpath(role, rel).exists()


def dg(role: str, rel: str):
    p = vpath(role, rel)
    return hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None


def arm(name: str, dest_rel: str, note: str) -> dict:
    src = f"{SHARED}/wp68a-{RUN}-{name}.md"
    dst = dest_rel
    say("")
    say(f"  ---- ARM {name}: {src} -> {dst} ----")
    say(f"       {note}")
    put("A", src, f"b50 wp68 attribution {name} {RUN}\n")
    there, _ = await_state(f"{src} to reach B", lambda: ex("B", src), 30)
    say(f"    peer received the source: {there}")
    if not there:
        say("    ARM INVALID — the source never replicated, so nothing below is a "
            "measurement of a rename.")
        return {"arm": name, "valid": False}
    before = dg("A", src)
    vpath("A", dst).parent.mkdir(parents=True, exist_ok=True)
    vpath("A", src).rename(vpath("A", dst))
    time.sleep(22.0)
    out = {
        "arm": name, "valid": True, "src": src, "dst": dst,
        "A_dst_exists": ex("A", dst),
        "A_dst_bytes_unchanged": dg("A", dst) == before,
        "peer_src_kept": ex("B", src),
        "peer_dst_exists": ex("B", dst),
    }
    say(f"    A holds the moved file at the destination: {out['A_dst_exists']} "
        f"(bytes unchanged: {out['A_dst_bytes_unchanged']})")
    say(f"    PEER KEPT ITS COPY AT THE OLD PATH: {out['peer_src_kept']}")
    say(f"    peer has something at the destination:  {out['peer_dst_exists']}")
    return out


def main() -> int:
    say("=" * 78)
    say(f"B50 — WP68 peer-file-loss ATTRIBUTION   run {RUN}")
    say("=" * 78)
    for r in VAULTS:
        info = (cmd(r, "session.info").get("result") or {})
        say(f"  {r}: role={info.get('role')} connected={info.get('connected')}")
        say(f"  sharedFolder {r} = {shared_folder(r)!r}")
        mj = vpath(r, ".obsidian/plugins/live-share/main.js")
        say(f"  bundle {r}: sha256={hashlib.sha256(mj.read_bytes()).hexdigest()}")

    rows = [
        arm("inside", f"{SHARED}/wp68a-{RUN}-inside-moved.md",
            "shared -> shared. POSITIVE CONTROL: the peer must follow the rename."),
        arm("root", f"wp68a-{RUN}-root.md",
            "shared -> VAULT ROOT. Not a sidecar path, so WP68's guard cannot fire. "
            "This is the generic out-of-tree rename."),
        arm("sidecar", f".obsidian/liveshare/state/wp68a-{RUN}-sidecar.md",
            "shared -> SIDECAR. WP68's guard fires here and only here."),
    ]

    say("")
    say("=" * 78)
    say("  ATTRIBUTION")
    say("=" * 78)
    say(f"  {'arm':10} {'peer kept old':14} {'peer has dest':14} {'A moved ok':10}")
    for r in rows:
        if not r.get("valid"):
            say(f"  {r['arm']:10} INVALID")
            continue
        say(f"  {r['arm']:10} {str(r['peer_src_kept']):14} "
            f"{str(r['peer_dst_exists']):14} {str(r['A_dst_exists']):10}")

    by = {r["arm"]: r for r in rows if r.get("valid")}
    say("")
    if "root" in by and "sidecar" in by:
        if by["root"]["peer_src_kept"] and not by["sidecar"]["peer_src_kept"]:
            say("  VERDICT: the loss is SPECIFIC TO THE SIDECAR ARM. An ordinary")
            say("  out-of-tree rename leaves the peer's copy alone and the sidecar")
            say("  rename does not. C68 AC3 — 'a refusal costs no file, at either")
            say("  end' — FAILS, and the refusal is what costs it.")
        elif not by["root"]["peer_src_kept"] and not by["sidecar"]["peer_src_kept"]:
            say("  VERDICT: the loss is GENERIC, not WP68's. Any rename out of the")
            say("  shared tree removes the peer's copy, sidecar destination or not.")
            say("  WP68's refusal is NOT the cause; the destructive step is upstream")
            say("  of it and belongs to whatever turns 'left the shared tree' into a")
            say("  deletion on the peer. WP68's own security property still holds:")
            say("  nothing was written into the peer's .obsidian/**.")
        elif by["root"]["peer_src_kept"] and by["sidecar"]["peer_src_kept"]:
            say("  VERDICT: neither arm lost the peer's copy in this run. The earlier")
            say("  observation is NOT REPRODUCED here and must not be reported as a")
            say("  standing failure without a repeat that does reproduce it.")
        else:
            say("  VERDICT: the sidecar arm kept the file and the ordinary one did")
            say("  not — the opposite of the hypothesis. Reported as-is.")
    else:
        say("  VERDICT: NOT DETERMINED — an arm was invalid.")

    say("")
    say("  ---- teardown ----")
    for r in rows:
        for role in VAULTS:
            for rel in (r.get("src"), r.get("dst")):
                if not rel:
                    continue
                p = vpath(role, rel)
                if p.exists():
                    try:
                        p.unlink()
                        say(f"    removed {role}:{rel}")
                    except OSError as e:
                        say(f"    could not remove {role}:{rel}: {e}")
    for r in VAULTS:
        say(f"  sharedFolder {r} after the run = {shared_folder(r)!r}")

    Path(rf"H:\tmp\b50_wp68attrib_{RUN}.json").write_text(
        json.dumps({"run": RUN, "rows": rows}, indent=2), encoding="utf-8")
    say(f"  machine-readable: H:\\tmp\\b50_wp68attrib_{RUN}.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
