# WP69 / AC3 (+ the AC2 helper allowance) — blind 1. Same subject (the marker
# counter), different angle: **adversarial byte layouts**.
#
# A real `main.js` is 600–800 KB of minified JavaScript with an inline sourcemap
# glued to the end. A counter written with `.decode()`, a line loop, a chunked read
# or a case-insensitive compare all pass a happy-path unit and then misreport a real
# bundle. Misreporting in the false-negative direction blocks a good build;
# misreporting in the false-positive direction is worse — it is how a production
# bundle gets certified as instrumented, and it is what AC2's zero-count is for.
#
# Nothing here is a real credential and nothing here is a real bundle.
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

M0, M1, M2 = (m.encode("utf-8") for m in constants.E2E_BUILD_MARKERS)


def test_a_marker_straddling_a_64_kib_boundary_is_still_found() -> None:
    """A chunked reader that does not overlap its window loses exactly this."""
    chunk = 64 * 1024
    filler = b"x" * (chunk - len(M0) // 2)
    blob = filler + M0 + b"y" * 128
    assert install.count_build_markers(blob)[constants.E2E_BUILD_MARKERS[0]] == 1


def test_a_marker_at_the_very_first_and_very_last_byte_is_found() -> None:
    assert install.count_build_markers(M1)[constants.E2E_BUILD_MARKERS[1]] == 1
    assert install.count_build_markers(b"z" * 4096 + M1)[
        constants.E2E_BUILD_MARKERS[1]
    ] == 1
    assert install.count_build_markers(M1 + b"z" * 4096)[
        constants.E2E_BUILD_MARKERS[1]
    ] == 1


def test_counting_is_case_sensitive() -> None:
    """`LIVESHARE_E2E` and `liveshare_e2e` are different identifiers in a bundle."""
    for marker in constants.E2E_BUILD_MARKERS:
        swapped = marker.swapcase().encode("utf-8")
        if swapped == marker.encode("utf-8"):
            continue
        counts = install.count_build_markers(swapped)
        assert counts[marker] == 0, f"{marker!r} matched its case-swapped form"


def test_undecodable_bytes_around_a_marker_do_not_hide_it() -> None:
    """An inline sourcemap plus minified output is not valid text in any codec."""
    noise = bytes(range(256)) * 4
    blob = noise + M2 + noise
    assert install.count_build_markers(blob)[constants.E2E_BUILD_MARKERS[2]] == 1


def test_a_bundle_without_line_breaks_is_handled() -> None:
    """esbuild's production output is effectively one enormous line."""
    blob = b"a" * 200_000 + M0 + b"b" * 200_000 + M1 + b"c" * 200_000 + M2
    counts = install.count_build_markers(blob)
    assert all(counts[m] == 1 for m in constants.E2E_BUILD_MARKERS)


def test_an_empty_bundle_counts_zero_and_does_not_raise() -> None:
    counts = install.count_build_markers(b"")
    assert set(constants.E2E_BUILD_MARKERS) <= set(counts)
    assert all(counts[m] == 0 for m in constants.E2E_BUILD_MARKERS)


def test_a_partial_marker_set_is_reported_per_marker_not_as_a_verdict() -> None:
    blob = b"head " + M0 + b" tail " + M2 + b" end"
    counts = install.count_build_markers(blob)
    assert counts[constants.E2E_BUILD_MARKERS[0]] == 1
    assert counts[constants.E2E_BUILD_MARKERS[1]] == 0
    assert counts[constants.E2E_BUILD_MARKERS[2]] == 1


@pytest.mark.parametrize("repeats", [1, 2, 17])
def test_overlapping_free_repeats_are_all_counted(repeats: int) -> None:
    blob = (M0 + b"|") * repeats
    assert install.count_build_markers(blob)[constants.E2E_BUILD_MARKERS[0]] == repeats


def test_the_flag_name_is_counted_alongside_the_three_markers() -> None:
    """AC2's recorded measurement quotes this count for the production bundle."""
    assert install.count_build_markers(b"var __LS_E2E__=true;")["__LS_E2E__"] == 1
    assert install.count_build_markers(b"var live=1;")["__LS_E2E__"] == 0
