#!/usr/bin/env python3
"""Verify the persisted N=3 owner-handover live GREEN artifacts."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path


EVIDENCE = Path(__file__).resolve().parents[1] / "evidence" / "p6_owner_fix_green_n3"


def one_payload(path: Path) -> dict:
    lines = [line for line in path.read_text(encoding="utf-8").splitlines() if line.startswith("{")]
    assert len(lines) == 1, f"{path.name}: expected one JSON payload, got {len(lines)}"
    return json.loads(lines[0])


def assert_green(point: dict, expected_x: int, leaf_id: str, label: str) -> None:
    assert point["leafId"] == leaf_id, f"{label}: leaf changed"
    assert point["attachment"] == "attached", f"{label}: leaf detached"
    assert point["modelX"] == expected_x, f"{label}: wrong model x"
    assert point["paintX"] == expected_x, f"{label}: paint/model split"
    assert point["styleVerdict"] == "agree", f"{label}: non-GREEN verdict"


def main() -> None:
    summaries = []
    cross_run_leaf = None
    for index in range(1, 4):
        path = EVIDENCE / f"run{index}.console.log"
        payload = one_payload(path)
        leaf_id = payload["baseline"]["leafId"]
        cross_run_leaf = cross_run_leaf or leaf_id
        assert leaf_id == cross_run_leaf, f"run{index}: survivor changed across repetitions"
        original_x = payload["originalX"]
        assert_green(payload["baseline"], original_x, leaf_id, f"run{index} baseline")
        assert_green(payload["prime"]["arrival"], original_x + 30, leaf_id, f"run{index} ordinary arrival")
        assert_green(payload["prime"]["after3s"], original_x + 30, leaf_id, f"run{index} ordinary +3s")
        assert_green(payload["arrival"], original_x + 60, leaf_id, f"run{index} structural arrival")
        assert_green(payload["after3s"], original_x + 60, leaf_id, f"run{index} structural +3s")
        assert_green(payload["afterActivateA"], original_x + 60, leaf_id, f"run{index} activation")

        raw_points = (
            payload["rawArm"],
            payload["prime"]["rawArrival"],
            payload["prime"]["rawAfter3s"],
            payload["rawArrival"],
            payload["rawAfter3s"],
            payload["rawAfterActivateA"],
            payload["restoration"]["raw"],
        )
        assert all(point["diagProto"] == 4 for point in raw_points), f"run{index}: non-proto4 sample"
        assert payload["arrivalCounterDelta"]["structuralChangedIds"] == 1
        assert payload["arrivalCounterDelta"]["sources"]["structuralSeam"]["attempts"] == 1
        assert payload["arrivalCounterDelta"]["sources"]["structuralSeam"]["repairs"] == 1
        assert payload["occlusionSettledMs"] == 10_000
        window = payload["occludedWindowState"]
        assert window["aValid"] and window["cValid"] and window["aMaximized"] and window["cMaximized"]
        assert window["foregroundHwnd"] == 789580

        restoration = payload["restoration"]
        assert restoration["complete"]
        assert restoration["exactRecordA"] and restoration["exactRecordC"]
        assert restoration["exactTextA"] and restoration["exactTextC"]
        assert restoration["geometry"]["original"] == restoration["geometry"]["restoredA"]
        assert restoration["geometry"]["original"] == restoration["geometry"]["restoredC"]
        assert_green(restoration["green"], original_x, leaf_id, f"run{index} restoration")

        summaries.append(
            {
                "run": index,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "leafId": leaf_id,
                "originalX": original_x,
                "ordinaryX": original_x + 30,
                "structuralX": original_x + 60,
                "ordinaryArrivalMs": payload["prime"]["arrivalMs"],
                "structuralArrivalMs": payload["arrivalMs"],
                "restorationMs": restoration["recoveryMs"],
            }
        )

    print(json.dumps({"verdict": "GREEN", "repetitions": 3, "runs": summaries}, sort_keys=True))


if __name__ == "__main__":
    main()
