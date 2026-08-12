"""Scratch analysis of the P4 evidence (not a probe). Read-only."""
from __future__ import annotations
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
data = json.loads((HERE / "evidence" / "P4-paint-vs-model.json").read_text(encoding="utf-8"))

for peer, blob in data.items():
    result = ((blob.get("resp") or {}).get("body") or {}).get("result") or {}
    census = result.get("census") or {}
    paint = census.get("paint") or {}
    label = paint.get("label") or {}
    detail = label.get("nodesDetail") or {}
    print("=" * 100)
    print(f"PEER {peer}  viewport={label.get('viewport')} primarySource={label.get('primarySource')} "
          f"tol={label.get('rectToleranceCanvasUnits')}")
    print(f"{'node':<20}{'verdict':<12}{'model x,y,w,h':<34}{'style x,y':<20}{'rect x,y':<26}dy(rect-model)")
    rows = []
    for node, d in detail.items():
        m = d.get("model") or {}
        s = d.get("styleTransform") or {}
        r = d.get("rect") or {}
        dy = (r.get("y") - m.get("y")) if isinstance(r.get("y"), (int, float)) and isinstance(m.get("y"), (int, float)) else None
        rows.append((m.get("y") if isinstance(m.get("y"), (int, float)) else 0, node, d, m, s, r, dy))
    for _, node, d, m, s, r, dy in sorted(rows):
        print(f"{node[:18]:<20}{str(d.get('verdict')):<12}"
              f"{f'{m.get(chr(120))},{m.get(chr(121))},{m.get('width')},{m.get('height')}':<34}"
              f"{f'{s.get(chr(120))},{s.get(chr(121))}':<20}"
              f"{f'{round(r.get(chr(120)),1) if isinstance(r.get(chr(120)),(int,float)) else None},{round(r.get(chr(121)),1) if isinstance(r.get(chr(121)),(int,float)) else None}':<26}"
              f"{round(dy,2) if dy is not None else '-'}")
    aw = result.get("awareness") or {}
    print(f"AWARENESS available={aw.get('available')} lockMeta={aw.get('lockMeta')}")
    for p in aw.get("peers") or []:
        print(f"   client={p.get('clientId')} nodeId={p.get('nodeId')} locks={sorted((p.get('lockedNodes') or {}).keys())}")
