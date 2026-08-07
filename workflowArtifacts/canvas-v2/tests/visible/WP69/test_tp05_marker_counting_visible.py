# WP69 / AC3 (and the AC2 helper allowance) — the marker counter over bundle bytes.
#
# AC3's oracle is "all three E2E build markers found in the emitted main.js"; AC2's
# recorded measurement is "zero occurrences of __LS_E2E__ and zero of each marker in
# the production bundle". Both consult one helper, and this is its unit.
#
# AC2 itself stays a measurement recorded in the implementation report — nothing
# here pretends to perform the before/after byte comparison of a real production
# build. What is tested is the counter that measurement will quote.
#
# The counter reads BYTES. `main.js` is a bundle, not text: it may hold any byte
# sequence, and a helper that decodes it as UTF-8 will die on a real one.
#
# Run: .venv\Scripts\python.exe -m pytest <this file>   (from the AgenticWorkspace root)

from __future__ import annotations

import sys
from pathlib import Path

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

#: A bundle that never mentions the flag or any marker — the measured production
#: signature (T3_PREFLIGHT: zero `__LS_E2E__` occurrences, `src/testing/` shaken out).
PRODUCTION_LIKE = (
    b'"use strict";var Q=Object.create;var live=1;\n'
    b'class CanvasBinding{constructor(){this.docs=new Map()}}\n'
    b'module.exports={CanvasBinding};\n'
)

#: A bundle carrying the instrumentation — the e2e signature.
E2E_LIKE = (
    b'"use strict";var __LS_E2E__=true;\n'
    b'const port=this.settings["e2eControlPort"];\n'
    b'const env=process.env.LIVESHARE_E2E;\n'
    b'await import("./testing/e2e-control");\n'
)


def test_the_production_signature_counts_zero_everywhere() -> None:
    counts = install.count_build_markers(PRODUCTION_LIKE)
    for marker in constants.E2E_BUILD_MARKERS:
        assert counts[marker] == 0, f"{marker!r} must not appear in a production bundle"
    assert counts["__LS_E2E__"] == 0


def test_the_e2e_signature_counts_at_least_one_of_each() -> None:
    counts = install.count_build_markers(E2E_LIKE)
    for marker in constants.E2E_BUILD_MARKERS:
        assert counts[marker] >= 1, f"{marker!r} missing from an e2e bundle"
    assert counts["__LS_E2E__"] >= 1


def test_every_pinned_marker_is_a_key_of_the_result() -> None:
    counts = install.count_build_markers(b"")
    assert set(constants.E2E_BUILD_MARKERS) <= set(counts)
    assert all(counts[m] == 0 for m in constants.E2E_BUILD_MARKERS)


def test_each_marker_is_counted_independently() -> None:
    """A counter that ORs the three together would pass the two tests above."""
    for marker in constants.E2E_BUILD_MARKERS:
        blob = b"prefix " + marker.encode("utf-8") + b" suffix"
        counts = install.count_build_markers(blob)
        assert counts[marker] == 1
        for other in constants.E2E_BUILD_MARKERS:
            if other != marker and other not in marker and marker not in other:
                assert counts[other] == 0


def test_the_counter_reads_bytes_not_decoded_text() -> None:
    """A real bundle contains bytes no codec has to accept."""
    blob = b"\xff\xfe\x00binary\x80" + constants.E2E_BUILD_MARKERS[0].encode("utf-8")
    counts = install.count_build_markers(blob)
    assert counts[constants.E2E_BUILD_MARKERS[0]] == 1


def test_occurrences_are_counted_not_merely_detected() -> None:
    marker = constants.E2E_BUILD_MARKERS[1].encode("utf-8")
    counts = install.count_build_markers(marker + b"|" + marker + b"|" + marker)
    assert counts[constants.E2E_BUILD_MARKERS[1]] == 3
