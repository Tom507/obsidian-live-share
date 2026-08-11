"""Read-only paint/model census against the existing safe A/C Obsidian rig."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request


PATH = os.environ.get("CANVAS_E2E_PATH", "_liveshare-test/SyncTesting.canvas")
PORTS = [int(value) for value in os.environ.get("CANVAS_E2E_PORTS", "39431,39433").split(",")]


def post(port: int) -> dict:
    payload = json.dumps(
        {"cmd": "canvas.diag", "args": {"op": "census", "path": PATH}}
    ).encode("utf-8")
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/command",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=2.0) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> int:
    readings = []
    try:
        for port in PORTS:
            body = post(port)
            result = body.get("result") if body.get("ok") is True else None
            if not isinstance(result, dict):
                raise RuntimeError(f"port {port} returned no diagnostic result")
            paint = ((result.get("census") or {}).get("paint") or {})
            if result.get("diagProto", 0) < 3 or paint.get("available") is not True:
                raise RuntimeError(f"port {port} has no trustworthy paint plane")
            detail = (paint.get("label") or {})
            nodes_detail = detail.get("nodesDetail") or {}
            style_divergent = sorted(
                node_id
                for node_id, node_detail in nodes_detail.items()
                if node_detail.get("styleVerdict") == "DIVERGENT"
            )
            readings.append(
                {
                    "port": port,
                    "mounted": PATH in (result.get("mountedPaths") or []),
                    "styleDivergent": style_divergent,
                    "unpainted": list(detail.get("unpaintedNodes") or []),
                }
            )
    except (OSError, ValueError, RuntimeError, urllib.error.URLError) as error:
        print(f"HARNESS_SKIP LIVE_RIG_UNAVAILABLE {error}")
        return 2

    bad = [
        reading
        for reading in readings
        if reading["mounted"] and (reading["styleDivergent"] or reading["unpainted"])
    ]
    if bad:
        print(f"LIVE_PAINT_MODEL_RED {json.dumps(bad, sort_keys=True)}")
        return 1
    if not any(reading["mounted"] for reading in readings):
        print(f"HARNESS_SKIP LIVE_PATH_NOT_MOUNTED {json.dumps(readings, sort_keys=True)}")
        return 2
    print(f"LIVE_PAINT_MODEL_CLEAR {json.dumps(readings, sort_keys=True)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
