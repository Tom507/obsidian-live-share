# WP69 / AC3 (+ the AC2 helper allowance) — blind 2. Same subject (the marker
# counter), different angle: **algebraic properties over a table of bundle shapes**,
# rather than hand-picked assertions.
#
# Two properties pin the counter without naming any particular blob:
#   ├── additivity — counting a concatenation equals summing the counts, when the
#   │   join cannot manufacture or destroy a match. A counter that stops at the
#   │   first hit, that reads only the head of the file, or that samples fails this.
#   └── discrimination — over a table of shapes, "all three present" partitions
#       exactly the instrumented ones from the production ones. A counter that is
#       secretly a constant passes every single-case assertion and fails this.
#
# Run: .venv\Scripts\python.exe -m pytest <this file>   (from the AgenticWorkspace root)

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# --- repo bootstrap (T3 shared contract §0.2): <repo>/tools on sys.path, top-level pkg ---
for _parent in Path(__file__).resolve().parents:
    if (_parent / "tools").is_dir() and (_parent / "plugin").is_dir():
        _REPO = _parent
        _TOOLS = _parent / "tools"
        break
else:  # pragma: no cover - only fires if the file is moved outside the repo
    raise RuntimeError(f"obsidian-live-share repo root not found from {__file__}")
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from obsidian_e2e import constants, install  # noqa: E402

MARKERS = tuple(constants.E2E_BUILD_MARKERS)
SEP = b"\n/* --- */\n"


def blob(*markers: str, pad: int = 0) -> bytes:
    body = b"".join(b"<<" + m.encode("utf-8") + b">>" + SEP for m in markers)
    return b"q" * pad + body + b"z" * pad


#: (label, bytes, expected "all three present")
TABLE = [
    ("empty", b"", False),
    ("production-like", b'"use strict";var a=1;module.exports={};\n', False),
    ("flag only", b"var __LS_E2E__=true;\n", False),
    ("one marker", blob(MARKERS[0]), False),
    ("two markers", blob(MARKERS[0], MARKERS[1]), False),
    ("other two markers", blob(MARKERS[1], MARKERS[2]), False),
    ("all three", blob(*MARKERS), True),
    ("all three, padded", blob(*MARKERS, pad=50_000), True),
    ("all three, reversed order", blob(*reversed(MARKERS)), True),
    ("all three, duplicated", blob(*MARKERS) + blob(*MARKERS), True),
]


def all_present(data: bytes) -> bool:
    counts = install.count_build_markers(data)
    return all(counts[m] >= 1 for m in MARKERS)


@pytest.mark.parametrize(("label", "data", "expected"), TABLE, ids=[t[0] for t in TABLE])
def test_the_counter_discriminates_across_the_table(
    label: str, data: bytes, expected: bool
) -> None:
    assert all_present(data) is expected, label


def test_the_table_partitions_into_both_classes() -> None:
    """A counter that always answers the same way cannot pass the parametrisation
    above — this asserts the table really contains both answers."""
    outcomes = {expected for _, _, expected in TABLE}
    assert outcomes == {True, False}


@pytest.mark.parametrize("left_label", [t[0] for t in TABLE])
def test_counting_is_additive_over_concatenation(left_label: str) -> None:
    left = next(data for label, data, _ in TABLE if label == left_label)
    right = blob(MARKERS[0], MARKERS[2], pad=7)
    joined = left + SEP + right

    lc = install.count_build_markers(left)
    rc = install.count_build_markers(right)
    jc = install.count_build_markers(joined)
    for marker in MARKERS:
        assert jc[marker] == lc[marker] + rc[marker], marker


def test_the_result_keys_are_stable_regardless_of_content() -> None:
    keys = [set(install.count_build_markers(data)) for _, data, _ in TABLE]
    assert all(k == keys[0] for k in keys)
    assert set(MARKERS) <= keys[0]


def test_counting_a_marker_alone_yields_exactly_one() -> None:
    for marker in MARKERS:
        assert install.count_build_markers(marker.encode("utf-8"))[marker] == 1


def test_a_bundle_of_only_padding_yields_zero_for_every_marker() -> None:
    counts = install.count_build_markers(b"q" * 500_000)
    assert all(counts[m] == 0 for m in MARKERS)
    assert counts["__LS_E2E__"] == 0
