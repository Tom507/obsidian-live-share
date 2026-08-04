# WP69 / AC1 + AC3 — blind 2. Same subject (a build that did not succeed is not a
# bundle), different angle: **what the runner is asked to do, and how often**.
#
# Cases the other two do not cover:
#   ├── the runner is invoked exactly once — a failed build is not silently retried,
#   │   and a retry against a watch build is how this host acquires an orphan process
#   ├── the runner is invoked in the PLUGIN directory — the workspace rule is that
#   │   every plugin command runs from `plugin/`, never the repo root
#   ├── the recorded command names the pinned npm script and never `dev`
#   └── exit 0 with a PRODUCTION-signature bundle is a refusal, not a pass: this is
#       what a regressed `define` looks like from the rig's side, and it is exactly
#       the state both vaults are in today (`PLUGIN_NOT_E2E_CAPABLE`).
#
# No real build is ever spawned.
#
# Run: .venv\Scripts\python.exe -m pytest <this file>   (from the AgenticWorkspace root)

from __future__ import annotations

import hashlib
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

E2E_BYTES = (
    b"var __LS_E2E__=true;\n"
    + b"".join(b"@" + m.encode("utf-8") + b"@\n" for m in constants.E2E_BUILD_MARKERS)
)
#: The measured production signature: no flag, no marker, `src/testing/` shaken out.
PRODUCTION_BYTES = b'"use strict";var CanvasBinding=1;module.exports={CanvasBinding};\n'


@pytest.fixture()
def plugin_dir(tmp_path: Path) -> Path:
    d = tmp_path / "plugin"
    d.mkdir()
    return d


def test_a_failed_build_invokes_the_runner_exactly_once(plugin_dir: Path) -> None:
    calls: list[tuple] = []

    def runner(command, cwd) -> int:  # noqa: ANN001
        calls.append((tuple(command), Path(cwd)))
        return 1

    with pytest.raises(install.E2EBuildFailed):
        install.build_e2e_bundle(plugin_dir, runner=runner)
    assert len(calls) == 1, "a failed build must not be retried"


def test_a_successful_build_invokes_the_runner_exactly_once(plugin_dir: Path) -> None:
    calls: list[tuple] = []

    def runner(command, cwd) -> int:  # noqa: ANN001
        calls.append((tuple(command), Path(cwd)))
        (Path(cwd) / "main.js").write_bytes(E2E_BYTES)
        return 0

    install.build_e2e_bundle(plugin_dir, runner=runner)
    assert len(calls) == 1


def test_the_runner_is_invoked_in_the_plugin_directory(plugin_dir: Path) -> None:
    seen: list[Path] = []

    def runner(command, cwd) -> int:  # noqa: ANN001, ARG001
        seen.append(Path(cwd).resolve())
        (Path(cwd) / "main.js").write_bytes(E2E_BYTES)
        return 0

    install.build_e2e_bundle(plugin_dir, runner=runner)
    assert seen == [plugin_dir.resolve()]


def test_the_recorded_command_names_the_pinned_script_and_not_dev(
    plugin_dir: Path,
) -> None:
    def runner(command, cwd) -> int:  # noqa: ANN001, ARG001
        (Path(cwd) / "main.js").write_bytes(E2E_BYTES)
        return 0

    result = install.build_e2e_bundle(plugin_dir, runner=runner)
    command = tuple(result.command)
    assert constants.E2E_BUILD_SCRIPT in command
    # `npm run dev` never returns — it must not appear anywhere in this path.
    assert "dev" not in command
    assert "production" not in command


def test_a_production_signature_bundle_on_a_clean_exit_is_refused(
    plugin_dir: Path,
) -> None:
    """The build succeeded and emitted a bundle that cannot host the control server.

    This is not hypothetical: it is precisely what both vaults carry today, and the
    reason `readiness.py` has a `PLUGIN_NOT_E2E_CAPABLE` state at all.
    """

    def runner(command, cwd) -> int:  # noqa: ANN001, ARG001
        (Path(cwd) / "main.js").write_bytes(PRODUCTION_BYTES)
        return 0

    with pytest.raises(install.BundleNotE2ECapable) as excinfo:
        install.build_e2e_bundle(plugin_dir, runner=runner)
    assert excinfo.value.reason == constants.BUNDLE_NOT_E2E_CAPABLE
    # the emitted file is genuinely a production bundle, not an empty one
    counts = install.count_build_markers((plugin_dir / "main.js").read_bytes())
    assert all(counts[m] == 0 for m in constants.E2E_BUILD_MARKERS)


def test_the_refusals_are_not_unconditional(plugin_dir: Path) -> None:
    def runner(command, cwd) -> int:  # noqa: ANN001, ARG001
        (Path(cwd) / "main.js").write_bytes(E2E_BYTES)
        return 0

    result = install.build_e2e_bundle(plugin_dir, runner=runner)
    assert result.e2e_capable is True
    assert result.exit_status == 0
    assert result.sha256 == hashlib.sha256(E2E_BYTES).hexdigest()


def test_a_negative_exit_status_is_treated_as_failure(plugin_dir: Path) -> None:
    """A process killed by a signal reports a negative returncode on POSIX and a
    large unsigned one on Windows. Neither is success."""
    for status in (-9, -1, 3221225786):

        def runner(command, cwd, _status=status) -> int:  # noqa: ANN001, ARG001
            (Path(cwd) / "main.js").write_bytes(E2E_BYTES)
            return _status

        with pytest.raises(install.E2EBuildFailed):
            install.build_e2e_bundle(plugin_dir, runner=runner)
