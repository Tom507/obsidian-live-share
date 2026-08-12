"""Scratch orientation only (not a probe). Reads live peer state + summarises the
prior session's diag dumps. Read-only."""
from __future__ import annotations
import json, sys, urllib.request, urllib.error
from pathlib import Path

REPO = Path(r"H:/Developement/_NeuralAngels/liveshareCollab/obsidian-live-share")
PORTS = {"A": 39431, "B": 39432, "C": 39433}


def post(port, cmd, args=None, timeout=20.0):
    body = json.dumps({"cmd": cmd, "args": args or {}}).encode()
    req = urllib.request.Request(f"http://127.0.0.1:{port}/command", data=body,
                                headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return {"status": r.status, "body": json.loads(r.read().decode())}
    except urllib.error.HTTPError as e:
        try:
            return {"status": e.code, "body": json.loads(e.read().decode())}
        except Exception:
            return {"status": e.code, "body": None}
    except Exception as e:
        return {"status": 0, "body": None, "transport": f"{type(e).__name__}: {e}"}


print("=" * 70)
print("LIVE PEERS")
for name, port in PORTS.items():
    r = post(port, "session.info")
    print(f"  {name}:{port} -> {r.get('status')} {json.dumps(r.get('body'))[:400]}")

print("=" * 70)
print("PRIOR DIAG DUMPS — paint plane summary")
diag = REPO / "workflowArtifacts" / "canvas-v2" / "diag"
for f in sorted(diag.glob("w5-*.json")):
    try:
        d = json.loads(f.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"  {f.name}: UNREADABLE {e}")
        continue
    res = (((d.get("raw") or {}).get("body") or {}).get("result")) or {}
    cen = res.get("census") or {}
    paint = cen.get("paint") or {}
    lbl = paint.get("label") or {}
    print(f"  {f.name:<48} path={d.get('path')!r:<40} "
          f"avail={paint.get('available')} count={paint.get('count')} "
          f"div={len(lbl.get('divergentNodes') or [])} "
          f"detached={len(lbl.get('detachedNodes') or [])} "
          f"unpainted={len(lbl.get('unpaintedNodes') or [])} "
          f"vp={lbl.get('viewport')}")
