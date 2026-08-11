"""Read-only paint/model census for every mounted authorized Canvas leaf."""

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


def summarize_leaf(leaf: dict) -> dict:
    paint = leaf.get("paint") or {}
    label = paint.get("label") or {}
    detail = label.get("nodesDetail") or {}
    style_divergent = sorted(
        node_id
        for node_id, reading in detail.items()
        if isinstance(reading, dict) and reading.get("styleVerdict") == "DIVERGENT"
    )
    return {
        "leafId": leaf.get("leafId"),
        "runtimeLeafId": leaf.get("runtimeLeafId"),
        "ordinal": leaf.get("workspaceOrdinal"),
        "active": leaf.get("active"),
        "deferred": leaf.get("deferred"),
        "modelCount": (leaf.get("model") or {}).get("count"),
        "paintCount": paint.get("count"),
        # `divergentNodes` also includes the known S198 bounding-rect coordinate
        # bias. The user's defect is a stale card transform, so P5's RED oracle
        # is the exact inline-style/model split only.
        "styleDivergent": style_divergent,
        "rectOrStyleDivergent": list(label.get("divergentNodes") or []),
        "unpainted": list(label.get("unpaintedNodes") or []),
        "detached": list(label.get("detachedNodes") or []),
    }


def main() -> int:
    readings = []
    try:
        for port in PORTS:
            body = post(port)
            result = body.get("result") if body.get("ok") is True else None
            if not isinstance(result, dict):
                raise RuntimeError(f"port {port} returned no diagnostic result")
            if result.get("diagProto", 0) < 4:
                raise RuntimeError(
                    f"port {port} exposes diagProto {result.get('diagProto')}; leaf census requires 4"
                )
            census = result.get("leafCensus")
            if not isinstance(census, dict) or census.get("available") is not True:
                reason = census.get("reason") if isinstance(census, dict) else "missing leafCensus"
                raise RuntimeError(f"port {port} leaf census unavailable: {reason}")
            leaves = census.get("leaves") or []
            if not isinstance(leaves, list):
                raise RuntimeError(f"port {port} leaf census returned non-list leaves")
            for leaf in leaves:
                if not isinstance(leaf, dict) or (leaf.get("paint") or {}).get("available") is not True:
                    raise RuntimeError(f"port {port} has a matching leaf without a readable paint plane")
            readings.append(
                {
                    "port": port,
                    "registryMounted": PATH in (result.get("mountedPaths") or []),
                    "leafCount": census.get("count"),
                    "duplicate": census.get("duplicate"),
                    "leaves": [summarize_leaf(leaf) for leaf in leaves],
                }
            )
    except (OSError, ValueError, RuntimeError, urllib.error.URLError) as error:
        print(f"HARNESS_SKIP LIVE_LEAF_RIG_UNAVAILABLE {error}")
        return 2

    if not any(reading["leafCount"] for reading in readings):
        print(f"HARNESS_SKIP LIVE_LEAF_PATH_NOT_MOUNTED {json.dumps(readings, sort_keys=True)}")
        return 2
    bad = [
        {"port": reading["port"], "leaf": leaf}
        for reading in readings
        for leaf in reading["leaves"]
        if leaf["styleDivergent"] or leaf["unpainted"]
    ]
    if bad:
        print(f"LIVE_LEAF_PAINT_MODEL_RED {json.dumps(bad, sort_keys=True)}")
        return 1
    print(f"LIVE_LEAF_PAINT_MODEL_CLEAR {json.dumps(readings, sort_keys=True)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
