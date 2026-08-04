# WP69 / AC1 + AC3 — blind 1. Same subject (a failed build must not be mistaken
# for a bundle), different angle: the failure happens **with a perfectly good
# bundle already sitting at the outfile**, and the runner is varied across the
# whole space of "did not succeed".
#
# This is the shape the pre-flight warned about. `plugin/main.js` is git-ignored and
# survives between runs, so on any developer machine a previous build's output is
# already there. An implementation that verifies markers but forgets the exit status
# passes every marker test and installs a stale bundle — a green that cannot fail.
#
# Angles the visible test does not use: a runner that raises instead of returning; a
# runner that returns 0 but writes nothing; and the assertion that the pre-existing
# bundle's bytes are still exactly what they were afterwards.
#
# Run: .venv\Scripts\python.exe -m pytest <this file>   (from the AgenticWorkspace root)

from __future__ import annotations

import hashlib
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
const rec = (o) => fs.appendFileSync(process.env.LS_STUB_LOG, JSON.stringify(o) + "\n");
process.on("exit", (code) => rec({ event: "exit", code }));
async function context(options) {
  rec({ event: "context", options });
  return {
    rebuild: async () => {
      rec({ event: "rebuild" });
      if (process.env.LS_STUB_FAIL_ON === "rebuild") {
        const e = new Error("stub build failure");
        e.errors = [{ text: "synthetic" }];
        throw e;
      }
      return { errors: [], warnings: [] };
    },
    watch: async () => { rec({ event: "watch" }); },
    dispose: async () => { rec({ event: "dispose" }); },
  };
}
export default { context };
export { context };
"""

STALE_BUNDLE = (
    b'"use strict";var __LS_E2E__=true;// left over from an earlier run\n'
    + b"".join(b'"' + m.encode("utf-8") + b'",\n' for m in constants.E2E_BUILD_MARKERS)
)
STALE_SHA = hashlib.sha256(STALE_BUNDLE).hexdigest()


def node_exe() -> str:
    exe = shutil.which("node")
    if exe is None:  # a skip here would be a green that cannot fail
        raise RuntimeError("node is not on PATH; the AC1 build-mode tests cannot run")
    return exe


def node_exit_code(tmp_path: Path, token: str, *, fail: bool) -> int:
    root = tmp_path / f"esb-{uuid.uuid4().hex}"
    stub = root / "node_modules" / "esbuild"
    stub.mkdir(parents=True)
    (stub / "package.json").write_text(_STUB_PKG, encoding="utf-8")
    (stub / "index.mjs").write_text(_STUB_INDEX, encoding="utf-8")
    shutil.copyfile(CONFIG, root / "esbuild.config.mjs")
    log = root / "log.jsonl"
    log.write_bytes(b"")
    env = dict(
        os.environ,
        LS_STUB_LOG=str(log),
        LS_STUB_FAIL_ON="rebuild" if fail else "",
    )
    proc = subprocess.run(  # noqa: S603 - fixed argv, fake esbuild, always terminates
        [node_exe(), str(root / "esbuild.config.mjs"), token],
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
    assert "rebuild" in events, "the mode under test did not attempt a one-shot build"
    return proc.returncode


@pytest.fixture()
def plugin_dir(tmp_path: Path) -> Path:
    d = tmp_path / "plugin"
    d.mkdir()
    (d / "main.js").write_bytes(STALE_BUNDLE)
    return d


def test_the_e2e_mode_propagates_a_build_error_as_a_non_zero_exit(
    tmp_path: Path,
) -> None:
    assert node_exit_code(tmp_path, constants.E2E_BUILD_ARGV, fail=True) != 0


def test_the_e2e_mode_exits_zero_when_the_build_succeeds(tmp_path: Path) -> None:
    assert node_exit_code(tmp_path, constants.E2E_BUILD_ARGV, fail=False) == 0


def test_production_still_propagates_a_build_error_the_same_way(
    tmp_path: Path,
) -> None:
    """The existing branch's behaviour is unchanged (AC1)."""
    assert node_exit_code(tmp_path, "production", fail=True) != 0


@pytest.mark.parametrize("status", [1, 2, 3, 127, 255])
def test_every_non_zero_status_is_a_refusal_despite_the_stale_bundle(
    plugin_dir: Path, status: int
) -> None:
    def runner(command, cwd) -> int:  # noqa: ANN001, ARG001
        return status

    with pytest.raises(install.E2EBuildFailed) as excinfo:
        install.build_e2e_bundle(plugin_dir, runner=runner)
    assert excinfo.value.reason == constants.E2E_BUILD_FAILED
    assert hashlib.sha256((plugin_dir / "main.js").read_bytes()).hexdigest() == STALE_SHA


def test_a_runner_that_raises_is_a_refusal_not_a_success(plugin_dir: Path) -> None:
    def exploding_runner(command, cwd):  # noqa: ANN001, ANN202, ARG001
        raise OSError("npm is not installed")

    with pytest.raises((install.InstallError, OSError)):
        install.build_e2e_bundle(plugin_dir, runner=exploding_runner)
    assert hashlib.sha256((plugin_dir / "main.js").read_bytes()).hexdigest() == STALE_SHA


def test_a_zero_status_that_emitted_nothing_new_is_still_judged_on_the_bytes(
    tmp_path: Path,
) -> None:
    """Exit 0 and no emitted bundle at all: a refusal, not a crash and not a pass."""
    empty = tmp_path / "empty-plugin"
    empty.mkdir()

    def silent_runner(command, cwd) -> int:  # noqa: ANN001, ARG001
        return 0

    with pytest.raises(install.InstallError):
        install.build_e2e_bundle(empty, runner=silent_runner)


def test_a_real_success_still_returns_a_capable_result(plugin_dir: Path) -> None:
    fresh = STALE_BUNDLE + b"// rebuilt\n"

    def runner(command, cwd) -> int:  # noqa: ANN001
        (Path(cwd) / "main.js").write_bytes(fresh)
        return 0

    result = install.build_e2e_bundle(plugin_dir, runner=runner)
    assert result.e2e_capable is True
    assert result.sha256 == hashlib.sha256(fresh).hexdigest()
    assert result.size == len(fresh)
