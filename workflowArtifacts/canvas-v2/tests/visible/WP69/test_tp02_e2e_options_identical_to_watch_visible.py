# WP69 / AC1 — the e2e mode's build options are identical IN EVERY FIELD to the
# existing default (watch) branch. The only difference between the two is one-shot
# versus watch.
#
# This is the half of AC1 that a "read the file and eyeball it" review misses: a
# third branch that quietly drops `sourcemap: "inline"`, or that folds
# `__LS_E2E__` to "false", produces a bundle that installs cleanly and can never
# host the control server — which is exactly the state the pre-flight measured and
# this WP exists to leave behind.
#
# The oracle is the option object the config actually passes to `esbuild.context()`,
# captured by an injected fake esbuild. Not the file's text.
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


def options_for(root: Path, *argv: str) -> dict:
    log = root / f"log-{uuid.uuid4().hex}.jsonl"
    log.write_bytes(b"")
    env = dict(os.environ, LS_STUB_LOG=str(log))
    subprocess.run(  # noqa: S603 - fixed argv, fake esbuild, always terminates
        [node_exe(), str(root / "esbuild.config.mjs"), *argv],
        cwd=str(root),
        env=env,
        capture_output=True,
        text=True,
        timeout=120,  # safety net only — never an assertion
        check=False,
    )
    calls = [
        json.loads(line)
        for line in log.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    contexts = [c for c in calls if c["event"] == "context"]
    assert len(contexts) == 1, (
        f"expected exactly one esbuild.context() call for argv={argv!r}, "
        f"got {len(contexts)}"
    )
    return contexts[0]["options"]


@pytest.fixture()
def harness(tmp_path: Path) -> Path:
    return make_harness(tmp_path)


def test_e2e_options_equal_the_watch_branch_options_field_for_field(
    harness: Path,
) -> None:
    e2e = options_for(harness, constants.E2E_BUILD_ARGV)
    watch = options_for(harness)
    assert e2e == watch, (
        "the e2e mode must differ from the default watch branch ONLY in one-shot vs "
        f"watch; option deltas: { {k: (e2e.get(k), watch.get(k)) for k in set(e2e) | set(watch) if e2e.get(k) != watch.get(k)} }"
    )


def test_e2e_keeps_the_instrumentation_flag_true(harness: Path) -> None:
    e2e = options_for(harness, constants.E2E_BUILD_ARGV)
    assert e2e["define"]["__LS_E2E__"] == "true"


def test_e2e_keeps_the_inline_sourcemap(harness: Path) -> None:
    e2e = options_for(harness, constants.E2E_BUILD_ARGV)
    assert e2e["sourcemap"] == "inline"


def test_production_differs_from_e2e_in_exactly_two_fields(harness: Path) -> None:
    e2e = options_for(harness, constants.E2E_BUILD_ARGV)
    prod = options_for(harness, "production")
    differing = {k for k in set(e2e) | set(prod) if e2e.get(k) != prod.get(k)}
    assert differing == {"sourcemap", "define"}
    assert prod["sourcemap"] is False
    assert prod["define"]["__LS_E2E__"] == "false"


def test_the_shared_fields_are_genuinely_load_bearing(harness: Path) -> None:
    """The equality above must not pass because the option object is nearly empty."""
    e2e = options_for(harness, constants.E2E_BUILD_ARGV)
    for key in (
        "entryPoints",
        "bundle",
        "external",
        "format",
        "target",
        "treeShaking",
        "outfile",
        "platform",
    ):
        assert key in e2e, f"{key} missing from the e2e build options"
    assert e2e["bundle"] is True
    assert e2e["treeShaking"] is True
    assert e2e["outfile"] == "main.js"
    assert e2e["entryPoints"] == ["src/main.ts"]
