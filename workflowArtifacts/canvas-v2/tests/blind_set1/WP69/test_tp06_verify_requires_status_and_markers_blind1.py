# WP69 / AC3 — blind 1. Same subject (what decides that a bundle is usable),
# different angle: the whole test is written from the **rejected alternative's**
# point of view.
#
# BUILD_SPEC C69 rejected "fire and forget `npm run dev`, poll main.js, kill the
# watcher" because mtime moves when a write BEGINS and a killed watcher can leave a
# truncated bundle. Each case below reproduces one of those observations and asserts
# that the module is not fooled by it:
#
#   ├── the file exists, is fresh, is complete — and the build failed
#   ├── the file's mtime advanced during a failing build
#   ├── the file grew during a failing build
#   └── the file is a prefix of a good bundle (killed mid-write) on a clean exit
#
# No sleeps: mtimes are set with os.utime, never waited for.
#
# Run: .venv\Scripts\python.exe -m pytest <this file>   (from the AgenticWorkspace root)

from __future__ import annotations

import hashlib
import os
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

GOOD = (
    b'"use strict";var __LS_E2E__=true;\n'
    + b"".join(b"const k=" + m.encode("utf-8") + b";\n" for m in constants.E2E_BUILD_MARKERS)
    + b"//# sourceMappingURL=data:application/json;base64,AAAA\n"
)


@pytest.fixture()
def plugin_dir(tmp_path: Path) -> Path:
    d = tmp_path / "plugin"
    d.mkdir()
    return d


def test_a_fresh_complete_bundle_plus_a_failed_build_is_refused(
    plugin_dir: Path,
) -> None:
    def runner(command, cwd) -> int:  # noqa: ANN001
        (Path(cwd) / "main.js").write_bytes(GOOD)  # written, complete, correct
        return 1  # …and the build reported failure

    with pytest.raises(install.E2EBuildFailed):
        install.build_e2e_bundle(plugin_dir, runner=runner)


def test_an_advancing_mtime_during_a_failing_build_is_refused(
    plugin_dir: Path,
) -> None:
    target = plugin_dir / "main.js"
    target.write_bytes(GOOD)
    stamp = target.stat().st_mtime_ns

    def runner(command, cwd) -> int:  # noqa: ANN001
        path = Path(cwd) / "main.js"
        os.utime(path, ns=(stamp + 5_000_000_000, stamp + 5_000_000_000))
        return 3

    with pytest.raises(install.E2EBuildFailed):
        install.build_e2e_bundle(plugin_dir, runner=runner)
    assert target.stat().st_mtime_ns != stamp  # the bait really did move


def test_a_growing_file_during_a_failing_build_is_refused(plugin_dir: Path) -> None:
    target = plugin_dir / "main.js"
    target.write_bytes(GOOD[:20])

    def runner(command, cwd) -> int:  # noqa: ANN001
        (Path(cwd) / "main.js").write_bytes(GOOD)
        return 1

    with pytest.raises(install.E2EBuildFailed):
        install.build_e2e_bundle(plugin_dir, runner=runner)


def test_a_bundle_killed_mid_write_is_refused_on_a_clean_exit(
    plugin_dir: Path,
) -> None:
    """Exit 0, plausible size, and the tail of the module never made it."""
    cut = GOOD.find(constants.E2E_BUILD_MARKERS[-1].encode("utf-8"))
    assert cut > 0
    truncated = GOOD[:cut]

    def runner(command, cwd) -> int:  # noqa: ANN001
        (Path(cwd) / "main.js").write_bytes(truncated)
        return 0

    with pytest.raises(install.BundleNotE2ECapable) as excinfo:
        install.build_e2e_bundle(plugin_dir, runner=runner)
    assert excinfo.value.reason == constants.BUNDLE_NOT_E2E_CAPABLE


def test_one_present_marker_is_not_enough(plugin_dir: Path) -> None:
    kept = constants.E2E_BUILD_MARKERS[0]
    partial = b"only " + kept.encode("utf-8") + b" here\n"
    path = plugin_dir / "main.js"
    path.write_bytes(partial)

    # The bundle genuinely carries one of the three — so a refusal here cannot be
    # "nothing matched".
    counts = install.count_build_markers(partial)
    assert counts[kept] == 1
    assert sum(counts[m] for m in constants.E2E_BUILD_MARKERS) == 1

    with pytest.raises(install.BundleNotE2ECapable):
        install.verify_e2e_bundle(path, exit_status=0)


def test_a_zero_exit_with_every_marker_is_accepted(plugin_dir: Path) -> None:
    """None of the refusals above may be unconditional."""

    def runner(command, cwd) -> int:  # noqa: ANN001
        (Path(cwd) / "main.js").write_bytes(GOOD)
        return 0

    result = install.build_e2e_bundle(plugin_dir, runner=runner)
    assert result.e2e_capable is True
    assert result.exit_status == 0
    assert result.sha256 == hashlib.sha256(GOOD).hexdigest()
    assert result.size == len(GOOD)


def test_the_recorded_size_is_the_emitted_bundles_size(plugin_dir: Path) -> None:
    """AC3 requires the size to be recorded so the inline-sourcemap growth over the
    626 711-byte production bundle is never read as corruption."""
    padded = GOOD + b"/* inline sourcemap payload */" * 5000

    def runner(command, cwd) -> int:  # noqa: ANN001
        (Path(cwd) / "main.js").write_bytes(padded)
        return 0

    result = install.build_e2e_bundle(plugin_dir, runner=runner)
    assert result.size == len(padded)
    assert result.size == (plugin_dir / "main.js").stat().st_size
