"""B59 / Worker 4 — shared harness for the SIX live arms of one bunched batch.

Derived from B56's `ls_b56.py` (same rules, none relaxed) with three additions
the B59 arms need:

  * the S57 gate ROUTES the two commands WP95 added (`fileop.muteStats`,
    `fileop.protectedRefusals`). Those commands are also the MARKER CENSUS by
    which the installed bundle is established: a 400 on either means the vault
    is running a pre-WP95 bundle, whatever its file date says.
  * `PROTECTED PATH REFUSED:` and `DELETE WITHHELD:` join the receipt set.
  * `sha_bytes` / `dir_census` so an arm can compare a credential file WITHOUT
    reading it.

RULES OBEYED (each named where it bites)
----------------------------------------
  S45   `canvas.open` is NEVER called. A leaf is opened only with
        `canvas.typeInNode{open:true}`.
  S46   both installed bundles' sha256 printed before every arm.
  S57   every command an arm depends on is ROUTED once before it measures.
  S65   every log read goes through `ls_logwait`; a zero-line read raises
        `FlushNotProven` rather than being reported as an absence.
  S67   the bundle digest is the measurement; the gate refuses two vaults that
        do not hold the same bytes.
  S71   the clamp is measured and printed, never assumed away.
  S85   every settle is `await_state` on an OBSERVABLE.
  S100  the bundle under test is pinned to an explicit commit by `b59_bundle.txt`
        and the gate refuses a vault holding anything else.
  rule 15 every signature carries its historical-hit control.
  secrets  no `data.json` VALUE is ever read except `sharedFolder`,
        `e2eControlPort` and `debugLogPath`. Everything else is compared as
        sha256-of-bytes or not at all.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any, Callable, Optional

sys.path.insert(0, r"H:\tmp")
from ls_logwait import (  # noqa: E402
    ABSENT,
    PRESENT,
    UNINFORMATIVE,
    FlushNotProven,
    LogWaiter,
    newest_stamp,
)

VAULTS: dict[str, tuple[Path, int]] = {
    "A": (Path(os.environ.get("LIVESHARE_E2E_VAULT_A", Path.home() / "ObsidianVaults" / "LiveShare-E2E-A")), 39431),
    "B": (Path(os.environ.get("LIVESHARE_E2E_VAULT_B", Path.home() / "ObsidianVaults" / "LiveShare-E2E-B")), 39432),
}
SHARED = "_liveshare-test"
REQUIRED_SHARED_FOLDER = "_liveshare-test"
SEED_STORE_REL = ".obsidian/liveshare/state/seed-refusals.json"
SIDECAR_STATE_REL = ".obsidian/liveshare/state"
PLUGIN_DATA_REL = ".obsidian/plugins/live-share/data.json"
PLUGIN_MAIN_REL = ".obsidian/plugins/live-share/main.js"
INSTALLER = r"H:\tmp\liveshare_e2e_install.py"
PIN_FILE = Path(r"H:\tmp\b59_bundle.txt")

RUN = time.strftime("%H%M%S")

RECEIPTS = (
    "CANVAS WRITER:",
    "CAPTURE DECLINED:",
    "local modify ",
    "SEED REFUSED:",
    "SEED RESTORED:",
    "SEED REFUSAL STORE:",
    "INGEST REJECTED",
    "MUTE OVERRUN:",
    "AWARENESS GAP:",
    "refused remote rename",
    "PROTECTED PATH REFUSED:",
    "DELETE WITHHELD:",
)

OUT: list[str] = []
ROLES: dict[str, str] = {}
BUNDLES: dict[str, str] = {}


def say(m: str = "") -> None:
    print(m, flush=True)
    OUT.append(m)


def flush_log(name: str) -> None:
    Path(rf"H:\tmp\b59_{name}_{RUN}.log").write_text("\n".join(OUT), encoding="utf-8")


def dump(name: str, payload: dict) -> None:
    Path(rf"H:\tmp\b59_{name}_{RUN}.json").write_text(
        json.dumps(payload, indent=2, default=str), encoding="utf-8")
    flush_log(name)
    say(f"  machine-readable: H:\\tmp\\b59_{name}_{RUN}.json")


# --------------------------------------------------------------------------- #
# control surface
# --------------------------------------------------------------------------- #
def cmd(role: str, name: str, timeout: float = 30.0, **args: Any) -> dict:
    _, port = VAULTS[role]
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/command",
        data=json.dumps({"cmd": name, "args": args}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}


def vpath(role: str, rel: str) -> Path:
    return VAULTS[role][0] / rel


def read_canvas(role: str, rel: str) -> Optional[dict]:
    p = vpath(role, rel)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return None


def write_canvas_raw(role: str, data: dict, rel: str) -> None:
    p = vpath(role, rel)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, indent=2), encoding="utf-8")


def nids(d: Optional[dict]) -> set:
    """Node ids from the record's OWN id field — never a substring search."""
    return {n.get("id") for n in (d or {}).get("nodes", []) if isinstance(n, dict)}


def eids(d: Optional[dict]) -> set:
    return {e.get("id") for e in (d or {}).get("edges", []) if isinstance(e, dict)}


def doc_ids(role: str, rel: str) -> tuple[set, set]:
    r = cmd(role, "canvas.state", path=rel)
    if not r.get("ok"):
        return set(), set()
    st = r.get("result") or {}
    return (
        {n.get("id") for n in st.get("nodes", []) if isinstance(n, dict)},
        {e.get("id") for e in st.get("edges", []) if isinstance(e, dict)},
    )


def card(nid: str, x: int, y: int) -> dict:
    return {"id": nid, "type": "text", "text": nid, "x": x, "y": y,
            "width": 160, "height": 80}


def sha_file(role: str, rel: str) -> Optional[str]:
    p = vpath(role, rel)
    if not p.exists():
        return None
    return hashlib.sha256(p.read_bytes()).hexdigest()


def sha_bytes(p: Path) -> Optional[str]:
    """sha256 of a file's bytes. The ONLY way this batch ever looks at
    `data.json` content — the bytes are never decoded, printed or stored."""
    if not p.exists():
        return None
    return hashlib.sha256(p.read_bytes()).hexdigest()


def dir_census(role: str, rel: str, suffix: str = "") -> dict[str, int]:
    """name -> size for a directory, so an arm can prove a WRITE happened
    without reading anything."""
    d = vpath(role, rel)
    if not d.is_dir():
        return {}
    return {f.name: f.stat().st_size for f in sorted(d.iterdir())
            if f.is_file() and (not suffix or f.name.endswith(suffix))}


def bundle_digest(role: str) -> tuple[str, int]:
    p = vpath(role, PLUGIN_MAIN_REL)
    return hashlib.sha256(p.read_bytes()).hexdigest(), p.stat().st_size


def _settings(role: str) -> dict:
    return json.loads(vpath(role, PLUGIN_DATA_REL).read_text(encoding="utf-8"))


def shared_folder(role: str) -> str:
    """The ONLY data.json value this harness reads besides port/log path."""
    return str(_settings(role).get("sharedFolder"))


def log_path(role: str) -> Path:
    raw = _settings(role).get("debugLogPath") or ".obsidian/live-share-debug.md"
    p = Path(raw)
    return p if p.is_absolute() else vpath(role, raw)


def waiter() -> LogWaiter:
    return LogWaiter({r: log_path(r) for r in VAULTS})


# --------------------------------------------------------------------------- #
# the seed-refusal store
# --------------------------------------------------------------------------- #
def store_path(role: str) -> Path:
    return vpath(role, SEED_STORE_REL)


def read_store(role: str) -> dict:
    p = store_path(role)
    if not p.exists():
        return {"__absent__": True}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        return {"__unreadable__": str(e)}


def store_entry(role: str, canvas_rel: str) -> Any:
    root = read_store(role)
    return (root.get("paths") or {}).get(canvas_rel)


# --------------------------------------------------------------------------- #
# waits — every one of them on STATE (S85)
# --------------------------------------------------------------------------- #
def await_state(label: str, pred: Callable[[], bool], budget: float,
                interval: float = 0.25) -> tuple[bool, float]:
    t0 = time.monotonic()
    dl = t0 + budget
    while time.monotonic() < dl:
        try:
            if pred():
                return True, time.monotonic() - t0
        except Exception:  # noqa: BLE001
            pass
        time.sleep(min(interval, max(0.0, dl - time.monotonic())))
    try:
        if pred():
            return True, time.monotonic() - t0
    except Exception:  # noqa: BLE001
        pass
    say(f"      !! WAIT TIMED OUT after {budget:.1f}s waiting for: {label}")
    return False, time.monotonic() - t0


# --------------------------------------------------------------------------- #
# gate
# --------------------------------------------------------------------------- #
MARKER_COMMANDS = ("fileop.muteStats", "fileop.protectedRefusals")


def pinned() -> tuple[str, str]:
    d, p = PIN_FILE.read_text(encoding="utf-8").split()
    return d, p


def gate(title: str, needed: tuple[str, ...] = ("session.info",),
         probe_canvas: Optional[str] = None) -> bool:
    say("=" * 78)
    say(f"B59 / W4 — {title}   run {RUN}   {time.strftime('%Y-%m-%d %H:%M:%S')}")
    say("=" * 78)
    ok = True

    want_digest, want_commit = pinned()
    say(f"  PINNED bundle {want_digest}")
    say(f"  PINNED commit {want_commit}")
    for role in VAULTS:
        d, n = bundle_digest(role)
        BUNDLES[role] = d
        say(f"  bundle {role}: sha256={d}  size={n}")
    if len(set(BUNDLES.values())) != 1:
        say("  !! THE TWO VAULTS HOLD DIFFERENT BUNDLES — refusing to measure (S67)")
        ok = False
    if set(BUNDLES.values()) != {want_digest}:
        say("  !! the installed bundle is NOT the pinned one — refusing to measure (S100)")
        ok = False

    # MARKER CENSUS, not file date: these two commands exist only in a bundle
    # that carries WP95. A 400 here is the only trustworthy statement about
    # WHICH CODE is running, and it is asked of both vaults.
    say("  MARKER CENSUS — commands that exist only in the bundle under test:")
    for role in VAULTS:
        for name in MARKER_COMMANDS:
            r = cmd(role, name)
            good = r.get("ok") is True and "result" in r
            say(f"    {role} {name}: {'ROUTED' if good else 'ABSENT'} "
                f"{json.dumps(r)[:150]}")
            if not good:
                say("    !! marker absent — this vault is NOT running the bundle "
                    "under test, whatever its file date says")
                ok = False

    for role in VAULTS:
        sf = shared_folder(role)
        say(f"  sharedFolder {role} = {sf!r}")
        if sf != REQUIRED_SHARED_FOLDER:
            say("  !! sharedFolder is wrong — ABORT, a guest would trash the vault")
            ok = False

    for role in VAULTS:
        r = cmd(role, "session.info")
        info = (r.get("result") or {}) if r.get("ok") else {}
        ROLES[role] = str(info.get("role"))
        say(f"  {role}: role={info.get('role')} connected={info.get('connected')} "
            f"vaultId={info.get('vaultId')} build={info.get('pluginBuild')}")
        if info.get("connected") is not True:
            ok = False
    say(f"  LIVE ROLE ASSIGNMENT: {', '.join(f'{r}={ROLES[r]}' for r in sorted(ROLES))}")
    if sorted(ROLES.values()) != ["guest", "host"]:
        say("  !! the room does not have exactly one host and one guest")
        ok = False

    for role in VAULTS:
        for name in needed:
            if name == "session.info":
                r = cmd(role, name)
            elif name in ("canvas.state", "canvas.file"):
                r = cmd(role, name, path=probe_canvas or f"{SHARED}/smoke.canvas")
            elif name == "sync.waitQuiescent":
                r = cmd(role, name, path=probe_canvas or f"{SHARED}/smoke.canvas",
                        timeoutMs=1500)
            elif name == "canvas.editingSignal":
                r = cmd(role, name, path=probe_canvas or f"{SHARED}/smoke.canvas")
            elif name == "canvas.simulateEdit":
                # ROUTED, not exercised: an EMPTY change. It reaches the host
                # method and applies nothing — there is no `removeNodes` and no
                # `nodes` in it, so no record is touched and nothing has to be
                # undone. What is established is that the COMMAND is routed on
                # this build, which is the S57 question.
                r = cmd(role, name, path=probe_canvas or f"{SHARED}/smoke.canvas",
                        change={})
            elif name == "fileop.inject":
                # ROUTED, not exercised: a `delete` op naming a path that exists
                # nowhere. It carries a valid `type`, so it reaches the handler
                # and is dropped by the ordinary not-shared test — no vault call,
                # nothing to undo.
                r = cmd(role, name, op={"type": "delete",
                                        "path": f"{SHARED}/b59-route-probe-{RUN}.md"},
                        settleMs=200)
            else:
                r = cmd(role, name)
            blob = json.dumps(r)
            if not (r.get("ok") is True and "unknown cmd" not in blob and "result" in r):
                say(f"  !! S57 GATE: {role} did not route {name}: {blob[:200]}")
                ok = False
    if ok:
        say(f"  S57 gate: both ports ROUTED all {len(needed)} commands")
    return ok


def clamp_report() -> dict:
    """S71 — measure the clamp instead of assuming it away."""
    now = time.time()
    out = {}
    say("  S71 — host wake-up clamp, measured now:")
    for role in VAULTS:
        wm = newest_stamp(log_path(role))
        lag = None if wm is None else now - wm
        out[role] = lag
        say(f"    {role}: newest on-disk log stamp is "
            f"{('%.1fs' % lag) if lag is not None else 'n/a'} behind wall clock")
    return out


def rule15(ev, extra: tuple[str, ...] = ()) -> dict:
    say("")
    say("  RULE 15 — every signature, with the control that proves it can match.")
    say("  TOOL: Python `substring in line` over the plugin's own debug log; every")
    say("        pattern is a LITERAL (no regex, no metacharacter).")
    table = {}
    for sig in tuple(RECEIPTS) + tuple(extra):
        c = ev.controls.get(sig, {})
        try:
            v = ev.verdict(sig)
        except FlushNotProven:
            v = "FLUSH-NOT-PROVEN"
        n = len(ev.hits(sig))
        table[sig] = {"window_hits": n, "verdict": v,
                      "history_hits": c.get("history_hits", 0),
                      "matcher_ok": c.get("matcher_ok")}
        say(f"    {sig!r:28} window_hits={n:<5} verdict={v:<18} "
            f"history_hits={c.get('history_hits', 0):<6} matcher_ok={c.get('matcher_ok')}")
        if v == UNINFORMATIVE:
            say("        ^^ UNINFORMATIVE: no absence claim is admissible here.")
    return table


# --------------------------------------------------------------------------- #
# restart
# --------------------------------------------------------------------------- #
def restart(expect_digest: str, note: str = "") -> bool:
    say("")
    say(f"  ---- RESTART both instances{(' — ' + note) if note else ''} ----")
    env = dict(os.environ)
    env["LS_EXPECT_SHA256"] = expect_digest
    p = subprocess.run([sys.executable, INSTALLER], capture_output=True, text=True,
                       timeout=900, env=env)
    for line in (p.stdout or "").splitlines():
        say(f"    | {line}")
    if p.returncode != 0:
        say(f"    !! installer exited {p.returncode}")
        say((p.stderr or "")[:800])
        return False
    return True


def wait_connected(budget: float = 120.0) -> bool:
    def both() -> bool:
        for role in VAULTS:
            r = cmd(role, "session.info", timeout=6)
            if not (r.get("ok") and (r.get("result") or {}).get("connected") is True):
                return False
        return True
    got, s = await_state("both instances connected to the relay", both, budget)
    if got:
        for role in VAULTS:
            ROLES[role] = str(((cmd(role, "session.info").get("result")) or {}).get("role"))
        say(f"  both connected after {s:.1f}s — roles now "
            f"{', '.join(f'{r}={ROLES[r]}' for r in sorted(ROLES))}")
    return got


def host_role() -> str:
    return next(r for r in VAULTS if ROLES.get(r) == "host")


def guest_role() -> str:
    return next(r for r in VAULTS if ROLES.get(r) == "guest")


# --------------------------------------------------------------------------- #
# teardown — removes only records THIS run made
# --------------------------------------------------------------------------- #
def drop_canvas(rel: str) -> None:
    say(f"  ---- teardown {rel} ----")
    for role in VAULTS:
        p = vpath(role, rel)
        if p.exists():
            try:
                p.unlink()
                say(f"    removed {role}:{rel}")
            except OSError as e:
                say(f"    could not remove {role}:{rel}: {e}")


def snapshot_shared() -> dict:
    out = {}
    for role in VAULTS:
        d = vpath(role, SHARED)
        if d.is_dir():
            out[role] = {f.name: (f.stat().st_size, hashlib.sha256(f.read_bytes()).hexdigest())
                         for f in sorted(d.iterdir()) if f.is_file()}
        else:
            out[role] = {}
    return out
