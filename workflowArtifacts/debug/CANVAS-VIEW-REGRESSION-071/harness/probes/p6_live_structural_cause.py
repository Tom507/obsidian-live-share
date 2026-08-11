"""One reversible live structural reconcile with repaint-counter attribution.

This probe is intentionally diagnostic-only. It mutates only the authorized
test Canvas through the existing control endpoint, never prints node text, and
restores the exact source record in a finally block.
"""

from __future__ import annotations

import copy
import ctypes
import json
import time
import urllib.request


PATH = "_liveshare-test/SyncTesting.canvas"
NODE_ID = "15dd9e620b7b6805"
A_PORT = 39431
C_PORT = 39433
A_HWND = 264764
C_HWND = 789580
OCCLUSION_SETTLE_SECONDS = 10.0


def post(port: int, cmd: str, args: dict) -> dict:
    payload = json.dumps({"cmd": cmd, "args": args}).encode("utf-8")
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/command",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=5.0) as response:
        body = json.loads(response.read().decode("utf-8"))
    if body.get("ok") is not True or not isinstance(body.get("result"), dict):
        raise RuntimeError(f"port {port} command {cmd} failed")
    return body["result"]


def state_node(port: int) -> dict:
    state = post(port, "canvas.state", {"path": PATH})
    nodes = state.get("nodes") or []
    records = nodes.values() if isinstance(nodes, dict) else nodes
    for record in records:
        if isinstance(record, dict) and record.get("id") == NODE_ID:
            return record
    raise RuntimeError(f"node {NODE_ID} absent on port {port}")


def read_diag(result: dict) -> tuple[dict, dict]:
    if result.get("diagProto") != 4:
        raise RuntimeError(f"expected diagnostic protocol 4, got {result.get('diagProto')}")
    repaint = ((result.get("census") or {}).get("repaint") or {})
    if repaint.get("available") is not True:
        raise RuntimeError(f"repaint census unavailable: {repaint.get('reason')}")
    leaves = ((result.get("leafCensus") or {}).get("leaves") or [])
    matches: list[tuple[dict, dict]] = []
    for leaf in leaves:
        detail = (
            (((leaf.get("paint") or {}).get("label") or {}).get("nodesDetail") or {}).get(NODE_ID)
        )
        if isinstance(detail, dict):
            matches.append((leaf, detail))
    if len(matches) != 1:
        raise RuntimeError(f"expected exactly one matching live leaf, got {len(matches)}")
    leaf, detail = matches[0]
    reading = {
        "leafId": leaf.get("leafId"),
        "active": leaf.get("active"),
        "attachment": detail.get("attachment"),
        "styleVerdict": detail.get("styleVerdict"),
        "modelX": (detail.get("model") or {}).get("x"),
        "paintX": (detail.get("styleTransform") or {}).get("x"),
    }
    return repaint["counters"], reading


def diag(op: str) -> tuple[dict, dict, dict]:
    result = post(A_PORT, "canvas.diag", {"op": op, "path": PATH})
    counters, reading = read_diag(result)
    # This is the exact protocol subtree used by the verdict. It deliberately
    # excludes doc/file node records so Canvas text never enters an artifact.
    raw = {
        "diagProto": result.get("diagProto"),
        "path": result.get("path") or PATH,
        "mountedPaths": result.get("mountedPaths"),
        "repaintCounters": counters,
        "targetLeaf": reading,
    }
    return counters, reading, raw


def census() -> tuple[dict, dict]:
    counters, reading, _ = diag("census")
    return counters, reading


def numeric_delta(before: dict, after: dict) -> dict:
    out: dict = {}
    for key, value in after.items():
        old = before.get(key)
        if isinstance(value, dict) and isinstance(old, dict):
            child = numeric_delta(old, value)
            if child:
                out[key] = child
        elif isinstance(value, (int, float)) and not isinstance(value, bool):
            if isinstance(old, (int, float)) and not isinstance(old, bool) and value != old:
                out[key] = value - old
    return out


def wait_model(target_x: float, timeout: float = 5.0) -> tuple[dict, dict, int]:
    start = time.monotonic()
    last: tuple[dict, dict] | None = None
    while time.monotonic() - start < timeout:
        last = census()
        if last[1]["modelX"] == target_x:
            return last[0], last[1], round((time.monotonic() - start) * 1000)
        time.sleep(0.05)
    raise RuntimeError(f"model did not reach target x={target_x}; last={last[1] if last else None}")


def wait_green(target_x: float, timeout: float = 5.0) -> tuple[dict, dict, int]:
    start = time.monotonic()
    last: tuple[dict, dict] | None = None
    while time.monotonic() - start < timeout:
        last = census()
        r = last[1]
        if r["modelX"] == target_x and r["paintX"] == target_x and r["styleVerdict"] == "agree":
            return last[0], r, round((time.monotonic() - start) * 1000)
        time.sleep(0.05)
    raise RuntimeError(f"paint did not recover at x={target_x}; last={last[1] if last else None}")


def foreground(hwnd: int) -> None:
    user32 = ctypes.windll.user32
    user32.ShowWindow(hwnd, 3)  # SW_MAXIMIZE; use an already-owned test window only.
    user32.SetForegroundWindow(hwnd)
    time.sleep(0.5)


def window_state() -> dict:
    user32 = ctypes.windll.user32
    return {
        "foregroundHwnd": user32.GetForegroundWindow(),
        "aValid": bool(user32.IsWindow(A_HWND)),
        "aMaximized": bool(user32.IsZoomed(A_HWND)),
        "cValid": bool(user32.IsWindow(C_HWND)),
        "cMaximized": bool(user32.IsZoomed(C_HWND)),
    }


def main() -> int:
    original = copy.deepcopy(state_node(C_PORT))
    original_x = original.get("x")
    original_text = original.get("text")
    if not isinstance(original_x, (int, float)) or not isinstance(original_text, str):
        raise RuntimeError("authorized node lacks numeric x or string text")
    target_x = original_x + 60
    changed = copy.deepcopy(original)
    changed["x"] = target_x
    changed["text"] = original_text + " "
    prime = copy.deepcopy(original)
    prime["x"] = original_x + 30
    result: dict = {
        "order": "structural-setData-while-A-occluded-then-activate-A",
        "targetX": target_x,
        "originalX": original_x,
    }
    restored = False
    try:
        foreground(C_HWND)
        before_counters, before_reading, raw_arm = diag("arm")
        time.sleep(OCCLUSION_SETTLE_SECONDS)
        occluded_state = window_state()
        if (
            occluded_state["foregroundHwnd"] != C_HWND
            or not occluded_state["cValid"]
            or not occluded_state["cMaximized"]
        ):
            raise RuntimeError(f"receiver A is not proven occluded: {occluded_state}")
        if before_reading["modelX"] != original_x or before_reading["paintX"] != original_x:
            raise RuntimeError(f"baseline is not green: {before_reading}")
        # Recreate the exact measured precursor: after the tracked same-path
        # leaf is closed, an ordinary remote geometry update reaches the
        # surviving leaf while the registry adapter may still own detached
        # nodes. Preserve this phase rather than assuming it is a green control.
        prime_sent_at = round(time.time() * 1000)
        post(C_PORT, "canvas.simulateEdit", {"path": PATH, "change": {"nodes": [prime]}})
        _, _, prime_arrival_ms = wait_model(original_x + 30)
        prime_arrival_counters, prime_arrival, raw_prime_arrival = diag("dump")
        time.sleep(3.0)
        prime_settled_counters, prime_settled, raw_prime_settled = diag("dump")

        source_sent_at = round(time.time() * 1000)
        post(C_PORT, "canvas.simulateEdit", {"path": PATH, "change": {"nodes": [changed]}})
        _, _, arrival_ms = wait_model(target_x)
        arrival_counters, arrival, raw_arrival = diag("dump")
        time.sleep(3.0)
        settled_counters, settled, raw_settled = diag("dump")
        result.update(
            {
                "baseline": before_reading,
                "arrival": arrival,
                "arrivalMs": arrival_ms,
                "after3s": settled,
                "rawArm": raw_arm,
                "rawArrival": raw_arrival,
                "rawAfter3s": raw_settled,
                "prime": {
                    "sentAt": prime_sent_at,
                    "arrivalMs": prime_arrival_ms,
                    "arrival": prime_arrival,
                    "after3s": prime_settled,
                    "rawArrival": raw_prime_arrival,
                    "rawAfter3s": raw_prime_settled,
                    "arrivalCounterDelta": numeric_delta(before_counters, prime_arrival_counters),
                    "after3sCounterDelta": numeric_delta(before_counters, prime_settled_counters),
                },
                "sourceSentAt": source_sent_at,
                "occlusionSettledMs": round(OCCLUSION_SETTLE_SECONDS * 1000),
                "occludedWindowState": occluded_state,
                "arrivalCounterDelta": numeric_delta(prime_settled_counters, arrival_counters),
                "after3sCounterDelta": numeric_delta(prime_settled_counters, settled_counters),
            }
        )

        foreground(A_HWND)
        _, _, activated_ms = wait_green(target_x)
        activated_counters, activated, raw_activated = diag("dump")
        result.update(
            {
                "afterActivateA": activated,
                "activateRecoveryMs": activated_ms,
                "rawAfterActivateA": raw_activated,
                "activateCounterDelta": numeric_delta(settled_counters, activated_counters),
            }
        )
    finally:
        post(C_PORT, "canvas.simulateEdit", {"path": PATH, "change": {"nodes": [original]}})
        _, restored_reading, restore_ms = wait_green(original_x)
        _, _, raw_restored = diag("dump")
        restored_a = state_node(A_PORT)
        restored_c = state_node(C_PORT)
        restored = (
            restored_reading["styleVerdict"] == "agree"
            and restored_a == original
            and restored_c == original
        )
        result["restoration"] = {
            "green": restored_reading,
            "recoveryMs": restore_ms,
            "exactTextA": restored_a.get("text") == original_text,
            "exactTextC": restored_c.get("text") == original_text,
            "exactRecordA": restored_a == original,
            "exactRecordC": restored_c == original,
            "geometry": {
                "original": {key: original.get(key) for key in ("x", "y", "width", "height")},
                "restoredA": {key: restored_a.get(key) for key in ("x", "y", "width", "height")},
                "restoredC": {key: restored_c.get(key) for key in ("x", "y", "width", "height")},
            },
            "raw": raw_restored,
            "complete": restored,
        }
        print(json.dumps(result, sort_keys=True))
    return 0 if restored else 1


if __name__ == "__main__":
    raise SystemExit(main())
