"""B56 / W4 — provision a fresh relay room WITH A CHOSEN ROLE ASSIGNMENT.

B44's `liveshare_b44_reprovision_room.py` hard-codes A = host. B56's S81 arm
needs the OPPOSITE at will: the instance that RECORDED a seed refusal has to
come back as the GUEST, because that is the only configuration in which the
durable store can possibly be load-bearing (a session that can record cannot
restore, and vice versa — see `liveshare_b56_s81.py`'s header).

    python liveshare_b56_provision.py A     # A = host, B = guest
    python liveshare_b56_provision.py B     # B = host, A = guest

Same guards as B44's, none relaxed:
  * Obsidian is stopped first — `data.json` is rewritten on quit.
  * the shared trees are snapshotted before anything (D1/D2/D3: a room swap
    makes the host publish a fresh manifest and a guest that reads a partial
    one TRASHES files).
  * the crypto material is proved IDENTICAL across the vaults by sha256 of the
    bytes, never by value — a new room over mismatched material yields a rig
    that connects and never decrypts, which reads exactly like a product bug.
  * `sharedFolder` is asserted `_liveshare-test` BEFORE and AFTER the write.

SECRET DISCIPLINE: no value of `token`, `serverPassword`, `encryptionPassphrase`
or `encryptionSalt` is printed, logged, or passed on a command line. The token is
written into data.json and reported only as a sha256 prefix.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

VAULTS = {
    "A": Path(r"H:\Developement\_NeuralAngels\ObsidianOrga"),
    "B": Path(r"H:\Developement\_NeuralAngels\ObsidianOrga - Kopie"),
}
PLUGIN_REL = Path(".obsidian/plugins/live-share")
SHARED = "_liveshare-test"
SNAP = Path(r"H:\tmp\b56_room_snapshot")


def dj(role: str) -> Path:
    return VAULTS[role] / PLUGIN_REL / "data.json"


def digest(value: str) -> str:
    return hashlib.sha256(str(value).encode("utf-8")).hexdigest()[:12]


def obsidian_running() -> int:
    out = subprocess.run(["tasklist"], capture_output=True, text=True, timeout=30).stdout
    return sum(1 for line in out.splitlines() if "obsidian.exe" in line.lower())


def post(url: str, body: dict, headers: dict) -> tuple[int, dict]:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", **headers})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, {"error": raw[:200]}


def main() -> int:
    host_vault = (sys.argv[1] if len(sys.argv) > 1 else "A").upper()
    if host_vault not in VAULTS:
        print(f"usage: {sys.argv[0]} <A|B>   (which vault is to be the HOST)")
        return 2
    guest_vault = "B" if host_vault == "A" else "A"
    print(f"provisioning a room with HOST={host_vault}  GUEST={guest_vault}")

    if obsidian_running():
        print("stopping Obsidian — data.json is rewritten on quit")
        subprocess.run(["taskkill", "/F", "/IM", "Obsidian.exe"], capture_output=True, text=True)
        for _ in range(20):
            time.sleep(1)
            if obsidian_running() == 0:
                break
        print(f"  processes now: {obsidian_running()}")

    stamp = time.strftime("%Y%m%d_%H%M%S")
    for role, vault in VAULTS.items():
        src = vault / SHARED
        if src.is_dir():
            dst = SNAP / stamp / role
            shutil.copytree(src, dst)
            print(f"snapshot {role}: {len(list(dst.rglob('*')))} entries -> {dst}")

    cfgs = {r: json.loads(dj(r).read_text(encoding="utf-8")) for r in VAULTS}
    for key in ("encryptionPassphrase", "encryptionSalt", "serverPassword"):
        da, db = digest(cfgs["A"].get(key, "")), digest(cfgs["B"].get(key, ""))
        print(f"  {key}: A={da} B={db} match={da == db}")
        if da != db:
            print(f"ABORT: {key} differs between the vaults.")
            return 1
    for role in VAULTS:
        if cfgs[role].get("sharedFolder") != SHARED:
            print(f"ABORT: vault {role} sharedFolder={cfgs[role].get('sharedFolder')!r}")
            return 1
    print(f"  sharedFolder: both {SHARED!r}")
    print(f"  old room {cfgs['A']['roomId']}")

    base = cfgs["A"]["serverUrl"].rstrip("/")
    pw = cfgs["A"].get("serverPassword") or ""
    hcfg = cfgs[host_vault]

    status, body = post(f"{base}/rooms",
                        {"hostUserId": hcfg.get("githubUserId") or hcfg["clientId"],
                         "requireApproval": hcfg.get("requireApproval", False),
                         "readOnlyPatterns": hcfg.get("readOnlyPatterns", [])},
                        {"X-Server-Password": pw} if pw else {})
    if status >= 400 or not body.get("id"):
        safe = {k: v for k, v in body.items() if k != "token"}
        print(f"ABORT: POST /rooms -> {status} {json.dumps(safe)[:200]}")
        return 1
    room_id, token = body["id"], body["token"]
    print(f"  created room {room_id}  token sha256={digest(token)}")

    status, body = post(f"{base}/rooms/{room_id}/join", {"token": token},
                        {"X-Server-Password": pw} if pw else {})
    if status >= 400:
        print(f"ABORT: join -> {status} {json.dumps(body)[:200]}")
        return 1
    print(f"  guest join accepted ({status})")

    for role, want in ((host_vault, "host"), (guest_vault, "guest")):
        p = dj(role)
        backup = p.with_suffix(".json.pre-v2-smoke-b56")
        if not backup.exists():
            shutil.copy2(p, backup)
        cfg = cfgs[role]
        cfg["roomId"] = room_id
        cfg["token"] = token
        cfg["role"] = want
        p.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
        back = json.loads(p.read_text(encoding="utf-8"))
        assert back["roomId"] == room_id and back["token"] == token
        if back.get("sharedFolder") != SHARED:
            print(f"ABORT AFTER WRITE: vault {role} sharedFolder={back.get('sharedFolder')!r}")
            return 1
        print(f"vault {role}: role={want} room={room_id} "
              f"sharedFolder={back['sharedFolder']!r} port={back['e2eControlPort']}")
    print("\nroom provisioned.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
