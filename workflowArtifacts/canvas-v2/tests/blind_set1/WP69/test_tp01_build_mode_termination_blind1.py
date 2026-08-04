# WP69 / AC1 — blind 1. Same subject as the visible test (which mode terminates),
# different angle: **near-miss argv tokens**.
#
# AC1 says the mode is selected by `process.argv[2] === "e2e"` and that an
# invocation "with any other value" still enters watch mode. A branch written with
# `startsWith`, `includes`, a case-insensitive compare or a regex would satisfy the
# visible test and quietly turn `--e2e`, `E2E` or `e2e-mode` into a terminating
# build — which, on this host, is how a watcher gets started by accident and how a
# gate run inherits a bundle nobody asked for.
#
# Same fake-esbuild seam, same beforeExit oracle (fires on a natural drain, never on
# process.exit). No real build, no sleeps.
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
const rec = (o) => fs.appendFileSync(LOG, JSON.stringify(o) + "\n");
process.on("beforeExit", () => rec({ event: "beforeExit" }));
process.on("exit", (code) => rec({ event: "exit", code }));
async function context(options) {
  rec({ event: "context", options });
  return {
    rebuild: async () => { rec({ event: "rebuild" }); return { errors: [], warnings: [] }; },
    watch: async () => { rec({ event: "watch" }); },
    dispose: async () => { rec({ event: "dispose" }); },
  };
}
export default { context };
export { context };
"""

#: Every one of these is NOT the pinned token, so every one of them must watch.
NEAR_MISSES = (
    "E2E",
    "e2E",
    "E2e",
    "e2e-mode",
    "e2ee",
    "xe2e",
    "--e2e",
    "prod",
    "Production",
    "PRODUCTION",
    "production2",
    "watch",
    "true",
    "0",
)


def node_exe() -> str:
    exe = shutil.which("node")
    if exe is None:  # a skip here would be a green that cannot fail
        raise RuntimeError("node is not on PATH; the AC1 build-mode tests cannot run")
    return exe


def harness_root(tmp_path: Path) -> Path:
    root = tmp_path / "esb"
    stub = root / "node_modules" / "esbuild"
    stub.mkdir(parents=True)
    (stub / "package.json").write_text(_STUB_PKG, encoding="utf-8")
    (stub / "index.mjs").write_text(_STUB_INDEX, encoding="utf-8")
    shutil.copyfile(CONFIG, root / "esbuild.config.mjs")
    return root


def trace(root: Path, *argv: str) -> tuple[int, list[str], dict]:
    log = root / f"{uuid.uuid4().hex}.jsonl"
    log.write_bytes(b"")
    proc = subprocess.run(  # noqa: S603 - fixed argv, fake esbuild, always terminates
        [node_exe(), str(root / "esbuild.config.mjs"), *argv],
        cwd=str(root),
        env=dict(os.environ, LS_STUB_LOG=str(log)),
        capture_output=True,
        text=True,
        timeout=120,  # safety net only — never an assertion
        check=False,
    )
    entries = [
        json.loads(line)
        for line in log.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    options = next((e["options"] for e in entries if e["event"] == "context"), {})
    return proc.returncode, [e["event"] for e in entries], options


@pytest.fixture()
def root(tmp_path: Path) -> Path:
    return harness_root(tmp_path)


@pytest.mark.parametrize("token", NEAR_MISSES)
def test_a_near_miss_token_never_produces_a_terminating_build(
    root: Path, token: str
) -> None:
    code, events, options = trace(root, token)
    assert code == 0
    assert "watch" in events, f"argv[2]={token!r} must fall through to watch mode"
    assert "rebuild" not in events, f"argv[2]={token!r} started a one-shot build"
    # beforeExit present ⇒ the loop drained; the branch did not call process.exit().
    assert "beforeExit" in events
    assert options["define"]["__LS_E2E__"] == "true"
    assert options["sourcemap"] == "inline"


def test_only_the_exact_pinned_token_selects_the_one_shot_e2e_build(root: Path) -> None:
    code, events, options = trace(root, constants.E2E_BUILD_ARGV)
    assert code == 0
    assert "rebuild" in events
    assert "watch" not in events
    assert "beforeExit" not in events
    assert options["define"]["__LS_E2E__"] == "true"


def test_production_is_still_the_only_other_terminating_token(root: Path) -> None:
    _, events, options = trace(root, "production")
    assert "rebuild" in events
    assert "watch" not in events
    assert "beforeExit" not in events
    assert options["define"]["__LS_E2E__"] == "false"


def test_extra_trailing_arguments_do_not_change_the_selected_mode(root: Path) -> None:
    """argv[3+] is not part of the contract and must not be read as one."""
    _, e2e_events, e2e_opts = trace(root, constants.E2E_BUILD_ARGV, "--verbose", "x")
    assert "rebuild" in e2e_events and "watch" not in e2e_events
    assert e2e_opts["define"]["__LS_E2E__"] == "true"

    _, watch_events, _ = trace(root, "banana", constants.E2E_BUILD_ARGV)
    assert "watch" in watch_events and "rebuild" not in watch_events
