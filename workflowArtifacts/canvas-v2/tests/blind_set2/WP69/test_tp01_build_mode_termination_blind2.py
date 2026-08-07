# WP69 / AC1 — blind 2. Same subject (which mode terminates), different angle:
# **call multiplicity and the pairing of termination with exit code**, over a matrix
# of (mode × build outcome).
#
# The visible test reads the event sequence; blind 1 varies the argv token. Neither
# would notice a branch that calls `ctx.rebuild()` twice, that creates two contexts,
# that calls `rebuild()` inside the watch branch "to prime the output", or that
# exits 0 after a build the stub reported as failed. Each of those is a plausible
# hand-edit of five lines of config, and each is a different production defect:
# double work, a duplicated define, a watcher that also ships a bundle, a red build
# reported green.
#
# Same fake-esbuild seam. No real build, no sleeps.
#
# Run: .venv\Scripts\python.exe -m pytest <this file>   (from the AgenticWorkspace root)

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import uuid
from collections import Counter
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

from obsidian_e2e import constants  # noqa: E402

CONFIG = _REPO / "plugin" / "esbuild.config.mjs"

_STUB_PKG = (
    '{"name":"esbuild","version":"0.0.0-stub","type":"module",'
    '"main":"./index.mjs","exports":{".":"./index.mjs"}}'
)

_STUB_INDEX = r"""
import fs from "node:fs";
import process from "node:process";
const rec = (o) => fs.appendFileSync(process.env.LS_STUB_LOG, JSON.stringify(o) + "\n");
process.on("beforeExit", () => rec({ event: "beforeExit" }));
process.on("exit", (code) => rec({ event: "exit", code }));
async function context() {
  rec({ event: "context" });
  return {
    rebuild: async () => {
      rec({ event: "rebuild" });
      if (process.env.LS_STUB_FAIL_ON === "rebuild") throw new Error("stub build failure");
      return { errors: [], warnings: [] };
    },
    watch: async () => {
      rec({ event: "watch" });
      if (process.env.LS_STUB_FAIL_ON === "watch") throw new Error("stub watch failure");
    },
    dispose: async () => { rec({ event: "dispose" }); },
  };
}
export default { context };
export { context };
"""

TERMINATING = ("production", constants.E2E_BUILD_ARGV)


def node_exe() -> str:
    exe = shutil.which("node")
    if exe is None:  # a skip here would be a green that cannot fail
        raise RuntimeError("node is not on PATH; the AC1 build-mode tests cannot run")
    return exe


@pytest.fixture()
def root(tmp_path: Path) -> Path:
    r = tmp_path / "esb"
    stub = r / "node_modules" / "esbuild"
    stub.mkdir(parents=True)
    (stub / "package.json").write_text(_STUB_PKG, encoding="utf-8")
    (stub / "index.mjs").write_text(_STUB_INDEX, encoding="utf-8")
    shutil.copyfile(CONFIG, r / "esbuild.config.mjs")
    return r


def invoke(root: Path, argv: tuple[str, ...], fail_on: str = "") -> tuple[int, Counter]:
    log = root / f"{uuid.uuid4().hex}.jsonl"
    log.write_bytes(b"")
    proc = subprocess.run(  # noqa: S603 - fixed argv, fake esbuild, always terminates
        [node_exe(), str(root / "esbuild.config.mjs"), *argv],
        cwd=str(root),
        env=dict(os.environ, LS_STUB_LOG=str(log), LS_STUB_FAIL_ON=fail_on),
        capture_output=True,
        text=True,
        timeout=120,  # safety net only — never an assertion
        check=False,
    )
    counts = Counter(
        json.loads(line)["event"]
        for line in log.read_text(encoding="utf-8").splitlines()
        if line.strip()
    )
    return proc.returncode, counts


@pytest.mark.parametrize("mode", TERMINATING)
def test_a_terminating_mode_builds_exactly_once(root: Path, mode: str) -> None:
    code, counts = invoke(root, (mode,))
    assert code == 0
    assert counts["context"] == 1
    assert counts["rebuild"] == 1
    assert counts["watch"] == 0
    assert counts["beforeExit"] == 0  # ended by process.exit(), not by the loop


def test_the_watch_mode_never_performs_a_one_shot_build(root: Path) -> None:
    code, counts = invoke(root, ())
    assert code == 0
    assert counts["context"] == 1
    assert counts["watch"] == 1
    assert counts["rebuild"] == 0
    assert counts["beforeExit"] == 1  # control was handed to the loop


@pytest.mark.parametrize("mode", TERMINATING)
def test_a_terminating_mode_never_exits_zero_on_a_failed_build(
    root: Path, mode: str
) -> None:
    code, counts = invoke(root, (mode,), fail_on="rebuild")
    assert counts["rebuild"] == 1
    assert code != 0, f"{mode!r} reported a failed build as success"


def test_no_mode_calls_both_rebuild_and_watch(root: Path) -> None:
    for argv in ((), ("production",), (constants.E2E_BUILD_ARGV,), ("nonsense",)):
        _, counts = invoke(root, argv)
        assert counts["rebuild"] * counts["watch"] == 0, f"argv={argv!r} did both"


def test_exactly_one_build_context_is_created_per_invocation(root: Path) -> None:
    for argv in ((), ("production",), (constants.E2E_BUILD_ARGV,)):
        _, counts = invoke(root, argv)
        assert counts["context"] == 1, f"argv={argv!r} created {counts['context']} contexts"


def test_repeating_an_invocation_is_deterministic(root: Path) -> None:
    first = invoke(root, (constants.E2E_BUILD_ARGV,))
    second = invoke(root, (constants.E2E_BUILD_ARGV,))
    assert first == second


def test_the_watch_branch_still_surfaces_its_own_failure(root: Path) -> None:
    """Unchanged in behaviour (AC1): a watch that cannot start is still an error."""
    code, counts = invoke(root, (), fail_on="watch")
    assert counts["watch"] == 1
    assert code != 0
