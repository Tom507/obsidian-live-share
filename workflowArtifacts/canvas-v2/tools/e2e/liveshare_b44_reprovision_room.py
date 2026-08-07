"""B44 — the relay room is gone; provision a new one and repoint both vaults.

WHY THIS IS NEEDED
`liveshare.neuralangels.de` answers, and its `/control/<room>` route answers
`403 Invalid room or token` for THIS room while answering a bare `403 Forbidden`
for a room id that cannot exist. Two different answers from the same route is
what makes the first one mean something: the relay is UP, the ROOM is gone.
The plugin's own log agrees — `SHARING HALTED: cause=never-established`.

WHAT IT DOES
  1. Snapshot both `_liveshare-test` trees (the room swap makes A publish a fresh
     manifest, and a guest that reads a partial manifest TRASHES files — D1/D2/D3.
     The snapshot is the only thing standing between that defect and the fixtures.)
  2. Prove A and B currently share `encryptionPassphrase`, `encryptionSalt` and
     `serverPassword` — BY SHA256 OF THE BYTES, never by value. If they differ,
     abort: a new room with mismatched crypto material would produce a rig that
     connects and never decrypts, which looks exactly like a product defect.
  3. `POST /rooms` as the host, `POST /rooms/<id>/join` as the guest.
  4. Write ONLY `roomId`, `token` and `role` into each data.json. `sharedFolder`
     is asserted to be `_liveshare-test` before AND after — an empty sharedFolder
     shares the whole vault and a guest then trashes it.

SECRET DISCIPLINE: no value of `token`, `serverPassword`, `encryptionPassphrase`
or `encryptionSalt` is printed, logged or passed on a command line. The new token
is written to data.json and reported only as a sha256 prefix.
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
SNAP = Path(r"H:\tmp\b44_shared_snapshot")


def dj(role: str) -> Path:
    return VAULTS[role] / PLUGIN_REL / "data.json"


def digest(value: str) -> str:
    return hashlib.sha256(str(value).encode("utf-8")).hexdigest()[:12]


def obsidian_running() -> int:
    out = subprocess.run(["tasklist"], capture_output=True, text=True, timeout=30).stdout
    return sum(1 for line in out.splitlines() if "obsidian.exe" in line.lower())


def post(url: str, body: dict, headers: dict) -> tuple[int, dict]:
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method="POST",
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
    if obsidian_running():
        print("stopping Obsidian — data.json is rewritten on quit, so it must not be open")
        subprocess.run(["taskkill", "/F", "/IM", "Obsidian.exe"], capture_output=True, text=True)
        for _ in range(20):
            time.sleep(1)
            if obsidian_running() == 0:
                break
        print(f"  processes now: {obsidian_running()}")

    # ---- 1. snapshot -------------------------------------------------------
    stamp = time.strftime("%Y%m%d_%H%M%S")
    for role, vault in VAULTS.items():
        src = vault / SHARED
        if src.is_dir():
            dst = SNAP / stamp / role
            shutil.copytree(src, dst)
            print(f"snapshot {role}: {len(list(dst.rglob('*')))} entries -> {dst}")
        else:
            print(f"snapshot {role}: no {SHARED} directory")

    # ---- 2. crypto material must already match ------------------------------
    cfgs = {r: json.loads(dj(r).read_text(encoding="utf-8")) for r in VAULTS}
    for key in ("encryptionPassphrase", "encryptionSalt", "serverPassword"):
        da, db = digest(cfgs["A"].get(key, "")), digest(cfgs["B"].get(key, ""))
        same = da == db
        print(f"  {key}: A={da} B={db} match={same}")
        if not same:
            print(f"ABORT: {key} differs between the vaults. A new room on top of "
                  f"mismatched crypto material connects and never decrypts.")
            return 1
    for role in VAULTS:
        if cfgs[role].get("sharedFolder") != SHARED:
            print(f"ABORT: vault {role} sharedFolder={cfgs[role].get('sharedFolder')!r}, "
                  f"expected {SHARED!r}. An empty sharedFolder shares the whole vault.")
            return 1
    print(f"  sharedFolder: both {SHARED!r}")
    print(f"  old room {cfgs['A']['roomId']} (A) / {cfgs['B']['roomId']} (B)")

    base = cfgs["A"]["serverUrl"].rstrip("/")
    pw = cfgs["A"].get("serverPassword") or ""

    # ---- 3. create the room as the host ------------------------------------
    status, body = post(f"{base}/rooms",
                        {"hostUserId": cfgs["A"].get("githubUserId") or cfgs["A"]["clientId"],
                         "requireApproval": cfgs["A"].get("requireApproval", False),
                         "readOnlyPatterns": cfgs["A"].get("readOnlyPatterns", [])},
                        {"X-Server-Password": pw} if pw else {})
    if status >= 400 or not body.get("id"):
        print(f"ABORT: POST /rooms -> {status} {json.dumps({k: v for k, v in body.items() if k != 'token'})[:200]}")
        return 1
    room_id, token = body["id"], body["token"]
    print(f"  created room {room_id}  token sha256={digest(token)}")

    # ---- 4. the guest joins it ---------------------------------------------
    status, body = post(f"{base}/rooms/{room_id}/join", {"token": token},
                        {"X-Server-Password": pw} if pw else {})
    if status >= 400:
        print(f"ABORT: POST /rooms/{room_id}/join -> {status} {json.dumps(body)[:200]}")
        return 1
    print(f"  guest join accepted ({status})")

    # ---- 5. write it into both vaults --------------------------------------
    for role, want_role in (("A", "host"), ("B", "guest")):
        p = dj(role)
        backup = p.with_suffix(".json.pre-v2-smoke-b44")
        if not backup.exists():
            shutil.copy2(p, backup)
        cfg = cfgs[role]
        cfg["roomId"] = room_id
        cfg["token"] = token
        cfg["role"] = want_role
        p.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
        back = json.loads(p.read_text(encoding="utf-8"))
        assert back["roomId"] == room_id and back["token"] == token
        if back.get("sharedFolder") != SHARED:
            print(f"ABORT AFTER WRITE: vault {role} sharedFolder is {back.get('sharedFolder')!r}")
            return 1
        print(f"vault {role}: role={want_role} room={room_id} "
              f"sharedFolder={back['sharedFolder']!r} e2eControlPort={back['e2eControlPort']}")

    print("\nroom provisioned. Relaunch with liveshare_launch_vaults.py.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
