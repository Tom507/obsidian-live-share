# WP69 / AC1 — the three build modes, and which of them TERMINATES.
#
# The measured blocker: `esbuild.config.mjs:4` branches on argv[2] === "production";
# every other invocation calls ctx.watch() and NEVER RETURNS. AC1 adds a third
# mode, `e2e`, that rebuilds once and process.exit(0)s, and leaves the other two
# branches unchanged in behaviour.
#
# How this is decided without running a real build (BUILD_SPEC: `npm run dev` never
# returns and would hang the suite to timeout): the real config file is executed by
# node against an **injected fake esbuild** — a stub package resolved from a
# temp-dir node_modules. The stub records every call, so `rebuild` vs `watch` is
# observed, not inferred from the file's text.
#
# The termination oracle is node's own `beforeExit` event, which fires when the
# event loop drains naturally and does NOT fire when process.exit() is called.
#   ├── terminating branch  → context, rebuild, exit          (no beforeExit)
#   └── watch branch        → context, watch, beforeExit, exit
# No sleeps, no timeouts as an oracle, no polling.
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

from obsidian_e2e import constants  # noqa: E402

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
    """A temp dir holding the REAL config file plus a fake `esbuild` package."""
    root = tmp_path / "esbuild-harness"
    stub = root / "node_modules" / "esbuild"
    stub.mkdir(parents=True)
    (stub / "package.json").write_text(_STUB_PKG, encoding="utf-8")
    (stub / "index.mjs").write_text(_STUB_INDEX, encoding="utf-8")
    shutil.copyfile(CONFIG, root / "esbuild.config.mjs")
    return root


def run_mode(root: Path, *argv: str, fail_on: str = "") -> tuple[int, list[dict]]:
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
    )
    events = [
        json.loads(line)
        for line in log.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    return proc.returncode, events


def names(events: list[dict]) -> list[str]:
    return [e["event"] for e in events]


@pytest.fixture()
def harness(tmp_path: Path) -> Path:
    return make_harness(tmp_path)


def test_the_e2e_mode_builds_once_and_exits_zero(harness: Path) -> None:
    code, events = run_mode(harness, constants.E2E_BUILD_ARGV)
    assert code == 0
    assert names(events) == ["context", "rebuild", "exit"]
    # beforeExit absent ⇒ the process was ended by process.exit(), not by the loop
    # draining after a watch() that returned.
    assert "beforeExit" not in names(events)
    assert "watch" not in names(events)


def test_production_still_rebuilds_once_folds_the_flag_false_and_exits_zero(
    harness: Path,
) -> None:
    code, events = run_mode(harness, "production")
    assert code == 0
    assert names(events) == ["context", "rebuild", "exit"]
    options = next(e for e in events if e["event"] == "context")["options"]
    assert options["define"]["__LS_E2E__"] == "false"
    assert options["sourcemap"] is False


def test_no_argv_still_enters_watch_and_does_not_terminate_the_process_itself(
    harness: Path,
) -> None:
    code, events = run_mode(harness)
    assert code == 0
    assert names(events) == ["context", "watch", "beforeExit", "exit"]
    # `rebuild` never called, and the exit came from the loop draining — i.e. the
    # branch handed control to the watcher rather than exiting on its own.
    assert "rebuild" not in names(events)


def test_an_unknown_argv_token_still_enters_watch(harness: Path) -> None:
    code, events = run_mode(harness, "banana")
    assert code == 0
    assert names(events) == ["context", "watch", "beforeExit", "exit"]


def test_the_three_modes_are_distinguished_only_by_argv2(harness: Path) -> None:
    """Three invocations, three distinct outcomes — one file, one branch point."""
    _, prod = run_mode(harness, "production")
    _, e2e = run_mode(harness, constants.E2E_BUILD_ARGV)
    _, watch = run_mode(harness)

    assert names(prod) == names(e2e) == ["context", "rebuild", "exit"]
    assert names(watch) == ["context", "watch", "beforeExit", "exit"]

    prod_opts = next(e for e in prod if e["event"] == "context")["options"]
    e2e_opts = next(e for e in e2e if e["event"] == "context")["options"]
    # Same termination shape as production, opposite instrumentation — that pair is
    # the whole point of the mode.
    assert prod_opts["define"]["__LS_E2E__"] == "false"
    assert e2e_opts["define"]["__LS_E2E__"] == "true"
