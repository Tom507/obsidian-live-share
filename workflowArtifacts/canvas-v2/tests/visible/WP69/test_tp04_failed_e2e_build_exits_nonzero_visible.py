# WP69 / AC1 + AC3 — a FAILED e2e build exits non-zero, and the rig treats a
# non-zero exit as a refusal rather than as a bundle.
#
# Two layers, both needed:
#   ├── node level  — the config file itself must not swallow a build error into
#   │                 exit 0. Driven through the injected fake esbuild, whose
#   │                 rebuild() is told to throw.
#   └── python seam — `install.build_e2e_bundle(..., runner=...)` must raise a
#                     named E2EBuildFailed when the runner reports non-zero, even
#                     when a perfectly good, fully marked main.js is sitting at the
#                     outfile from a previous build. "A file is there" proves
#                     nothing (AC3).
#
# No real `npm run build:e2e` is spawned anywhere in this file.
#
# Run: .venv\Scripts\python.exe -m pytest <this file>   (from the AgenticWorkspace root)

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import uuid
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

CONFIG = _REPO / "plugin" / "esbuild.config.mjs"

_STUB_PKG = (
    '{"name":"esbuild","version":"0.0.0-stub","type":"module",'
    '"main":"./index.mjs","exports":{".":"./index.mjs"}}'
)

_STUB_INDEX = r"""
import fs from "node:fs";
import process from "node:process";
const LOG = process.env.LS_STUB_LOG;
const FAIL = process.env.LS_STUB_FAIL_ON || "";
const rec = (o) => fs.appendFileSync(LOG, JSON.stringify(o) + "\n");
process.on("beforeExit", () => rec({ event: "beforeExit" }));
process.on("exit", (code) => rec({ event: "exit", code }));
async function context(options) {
  rec({ event: "context", options });
  return {
    rebuild: async () => {
      rec({ event: "rebuild" });
      if (FAIL === "rebuild") throw new Error("stub build failure");
      return { errors: [], warnings: [] };
    },
    watch: async () => { rec({ event: "watch" }); },
    dispose: async () => { rec({ event: "dispose" }); },
  };
}
export default { context };
export { context };
"""


def node_exe() -> str:
    exe = shutil.which("node")
    if exe is None:  # a skip here would be a green that cannot fail
        raise RuntimeError("node is not on PATH; the AC1 build-mode tests cannot run")
    return exe


def make_harness(tmp_path: Path) -> Path:
    root = tmp_path / "esbuild-harness"
    stub = root / "node_modules" / "esbuild"
    stub.mkdir(parents=True)
    (stub / "package.json").write_text(_STUB_PKG, encoding="utf-8")
    (stub / "index.mjs").write_text(_STUB_INDEX, encoding="utf-8")
    shutil.copyfile(CONFIG, root / "esbuild.config.mjs")
    return root


def run_mode(root: Path, *argv: str, fail_on: str = "") -> tuple[int, list[str]]:
    log = root / f"log-{uuid.uuid4().hex}.jsonl"
    log.write_bytes(b"")
    env = dict(os.environ, LS_STUB_LOG=str(log), LS_STUB_FAIL_ON=fail_on)
    proc = subprocess.run(  # noqa: S603 - fixed argv, fake esbuild, always terminates
        [node_exe(), str(root / "esbuild.config.mjs"), *argv],
        cwd=str(root),
        env=env,
        capture_output=True,
        text=True,
        timeout=120,  # safety net only — never an assertion
        check=False,
    )
    events = [
        json.loads(line)["event"]
        for line in log.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    return proc.returncode, events


def e2e_bytes() -> bytes:
    body = b"// synthetic e2e bundle\nconst __LS_E2E__ = true;\n"
    for marker in constants.E2E_BUILD_MARKERS:
        body += b'"' + marker.encode("utf-8") + b'",\n'
    return body


@pytest.fixture()
def plugin_dir(tmp_path: Path) -> Path:
    d = tmp_path / "plugin"
    d.mkdir()
    return d


def test_a_failing_e2e_build_exits_non_zero(tmp_path: Path) -> None:
    root = make_harness(tmp_path)
    code, events = run_mode(root, constants.E2E_BUILD_ARGV, fail_on="rebuild")
    assert code != 0
    assert "rebuild" in events


def test_a_succeeding_e2e_build_exits_zero(tmp_path: Path) -> None:
    """Counterweight: the non-zero above must come from the failure, not the mode."""
    root = make_harness(tmp_path)
    code, events = run_mode(root, constants.E2E_BUILD_ARGV)
    assert code == 0
    assert "rebuild" in events


def test_the_seam_refuses_a_non_zero_exit(plugin_dir: Path) -> None:
    (plugin_dir / "main.js").write_bytes(e2e_bytes())  # a perfectly good previous bundle

    def failing_runner(command, cwd) -> int:  # noqa: ANN001, ARG001
        return 1

    with pytest.raises(install.E2EBuildFailed) as excinfo:
        install.build_e2e_bundle(plugin_dir, runner=failing_runner)
    assert excinfo.value.reason == constants.E2E_BUILD_FAILED


def test_the_previous_bundle_is_left_in_place_after_a_failed_build(
    plugin_dir: Path,
) -> None:
    previous = e2e_bytes()
    (plugin_dir / "main.js").write_bytes(previous)

    def failing_runner(command, cwd) -> int:  # noqa: ANN001, ARG001
        return 1

    with pytest.raises(install.E2EBuildFailed):
        install.build_e2e_bundle(plugin_dir, runner=failing_runner)
    assert (plugin_dir / "main.js").read_bytes() == previous


def test_the_seam_accepts_a_zero_exit_with_a_capable_bundle(plugin_dir: Path) -> None:
    """The refusals above must not be an unconditional raise."""

    def good_runner(command, cwd) -> int:  # noqa: ANN001, ARG001
        (Path(cwd) / "main.js").write_bytes(e2e_bytes())
        return 0

    result = install.build_e2e_bundle(plugin_dir, runner=good_runner)
    assert result.exit_status == 0
    assert result.e2e_capable is True
    assert tuple(result.markers_found) == tuple(constants.E2E_BUILD_MARKERS)
    assert tuple(result.markers_missing) == ()


def test_the_runner_is_handed_the_recorded_build_command(plugin_dir: Path) -> None:
    seen: list[tuple] = []

    def recording_runner(command, cwd) -> int:  # noqa: ANN001
        seen.append(tuple(command))
        (Path(cwd) / "main.js").write_bytes(e2e_bytes())
        return 0

    result = install.build_e2e_bundle(plugin_dir, runner=recording_runner)
    assert len(seen) == 1
    # C7 AC1 needs the exact command reproducible in the run record.
    assert tuple(result.command) == seen[0]
    assert constants.E2E_BUILD_SCRIPT in seen[0]
